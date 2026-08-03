import { Injectable, Logger } from "@nestjs/common";
import { RedisMemoryAdapter } from "./adapters/redis.adapter";
import { Mem0Adapter } from "./adapters/mem0.adapter";
import { ChatOpenAI } from "@langchain/openai";
import { ConfigService } from "@nestjs/config";

/** 统一记忆服务：协调 Redis 短期记忆（滑动窗口+增量摘要压缩） + Mem0 长期记忆 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger("MemoryService");
  private llm: ChatOpenAI;

  constructor(
    private redis: RedisMemoryAdapter,
    private mem0: Mem0Adapter,
    private config: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      model: config.get("MODEL_NAME"),
      apiKey: config.get("ALIYUN_API_KEY"),
      configuration: { baseURL: config.get("ALIYUN_BASE_URL") },
    });
  }

  /**
   * 构建 Prompt 上下文：并行加载三层记忆
   * - 运行中增量摘要（压缩的旧消息）
   * - Redis 滑动窗口（近期对话历史）
   * - Mem0 用户画像（长期记忆）
   */
  async buildPromptContext(sessionId: string, userId: string) {
    const [history, summary, userContext] = await Promise.all([
      this.redis.getHistory(sessionId),
      this.redis.getSummary(sessionId),
      this.mem0.getUserContext(userId),
    ]);

    const historyStr = history.map((m) => `${m.role}: ${m.content}`).join("\n");
    const summaryStr = summary ? `## 历史对话摘要\n${summary}` : "";
    const systemContext = userContext ? `\n## 用户背景\n${userContext}\n` : "";

    // ── 调试输出：三层记忆加载情况 ──
    this.logger.debug(
      `[buildPromptContext] session=${sessionId} userId=${userId} | ` +
      `📝增量摘要: ${summary ? summary.length + '字符' : '空'} | ` +
      `💬近期历史: ${history.length}条消息, ${historyStr.length}字符 | ` +
      `🧠长期记忆(Mem0): ${userContext ? userContext.length + '字符' : '空'}`,
    );

    return {
      history: historyStr.slice(-4096),
      summary: summaryStr.slice(-2048),
      systemContext: systemContext.slice(-2048),
    };
  }

  /**
   * 记录消息到 Redis 滑动窗口
   * 当窗口溢出时，自动触发增量摘要压缩（异步、不阻塞当前请求）
   */
  async onMessage(
    sessionId: string,
    userId: string,
    role: "user" | "assistant",
    content: string,
  ) {
    const preview = content.slice(0, 80).replace(/\n/g, " ");
    this.logger.debug(
      `[onMessage] session=${sessionId} role=${role} content="${preview}${content.length > 80 ? '...' : ''}"`,
    );

    const overflow = await this.redis.appendMessage(sessionId, { role, content });

    if (overflow && overflow.length > 0) {
      this.logger.debug(
        `[onMessage] ⚡ 窗口溢出${overflow.length}条消息，触发增量压缩（fire-and-forget）`,
      );
      // 异步压缩，不阻塞当前请求
      this.compressOverflow(sessionId, overflow).catch((err) => {
        this.logger.warn(`[compressOverflow] 增量压缩失败: ${(err as Error)?.message}`);
      });
    }

    this.logger.debug(`[onMessage] ✅ 已写入Redis滑动窗口`);
  }

  /**
   * 增量压缩：将溢出消息与已有摘要合并为新的运行中摘要
   * 仅在 appendMessage 返回溢出时由 onMessage 触发
   */
  private async compressOverflow(
    sessionId: string,
    overflow: Array<{ role: string; content: string }>,
  ) {
    const existingSummary = await this.redis.getSummary(sessionId);
    const msgs = overflow.map((m) => `${m.role}: ${m.content}`).join("\n");

    const prompt = existingSummary
      ? `现有摘要：${existingSummary}\n\n新对话：${msgs}\n\n请合并为一段简洁的对话摘要（200字以内），保留关键信息：`
      : `总结以下对话要点（200字以内）：\n${msgs}`;

    const res = await this.llm.invoke(prompt);
    const newSummary = String(res.content);

    await this.redis.setSummary(sessionId, newSummary);
    this.logger.debug(
      `[compressOverflow] ✅ 增量摘要已更新 (${newSummary.length}字符): "${newSummary.slice(0, 100)}..."`,
    );
  }

  /**
   * 会话结束：合并运行中摘要 + 近期历史 → LLM 生成最终摘要 → 写入 Mem0 + 清理 Redis
   */
  async onSessionEnd(sessionId: string, userId: string) {
    const [history, summary] = await Promise.all([
      this.redis.getHistory(sessionId),
      this.redis.getSummary(sessionId),
    ]);

    if (history.length === 0 && !summary) {
      this.logger.debug(`[onSessionEnd] session=${sessionId} 无历史无摘要，跳过`);
      return;
    }

    this.logger.debug(
      `[onSessionEnd] session=${sessionId} | ` +
      `近期消息=${history.length}条 运行中摘要=${summary ? summary.length + '字符' : '无'} → Mem0长期记忆`,
    );

    try {
      const parts: string[] = [];
      if (summary) parts.push(`历史摘要：${summary}`);
      if (history.length > 0) {
        parts.push(`近期对话：\n${history.map((m) => `${m.role}: ${m.content}`).join("\n")}`);
      }
      const res = await this.llm.invoke(
        `总结以下对话要点（200字以内）：\n${parts.join("\n\n")}`,
      );
      const finalSummary = String(res.content);
      this.logger.debug(
        `[onSessionEnd] 📝 最终摘要(${finalSummary.length}字符): "${finalSummary.slice(0, 120)}..."`,
      );
      await this.mem0.saveSessionSummary(userId, sessionId, finalSummary);
      this.logger.debug(`[onSessionEnd] ✅ 已写入Mem0长期记忆`);
    } catch (err) {
      this.logger.warn(`[onSessionEnd] ⚠️ LLM摘要失败，静默降级: ${(err as Error)?.message}`);
    }

    await this.redis.clearHistory(sessionId);
    await this.redis.clearSummary(sessionId);
    this.logger.debug(`[onSessionEnd] 🧹 Redis短期记忆+摘要已清理`);
  }
}
