import { Injectable } from '@nestjs/common';
import { RedisMemoryAdapter } from './adapters/redis.adapter';
import { Mem0Adapter } from './adapters/mem0.adapter';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';

/** 统一记忆服务：协调 Redis 短期记忆 + Mem0 长期记忆 */
@Injectable()
export class MemoryService {
  private llm: ChatOpenAI;

  constructor(
    private redis: RedisMemoryAdapter,
    private mem0: Mem0Adapter,
    private config: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      model: 'deepseek-chat',
      apiKey: config.get('DEEPSEEK_API_KEY'),
      configuration: { baseURL: config.get('DEEPSEEK_BASE_URL') },
    });
  }

  /** 构建 Prompt 上下文：并行加载 Redis 历史 + Mem0 用户画像 */
  async buildPromptContext(sessionId: string, userId: string) {
    const [history, userContext] = await Promise.all([
      this.redis.getHistory(sessionId),
      this.mem0.getUserContext(userId),
    ]);

    const historyStr = history.map((m) => `${m.role}: ${m.content}`).join('\n');
    const systemContext = userContext ? `\n## 用户背景\n${userContext}\n` : '';

    return {
      history: historyStr.slice(-4096),
      systemContext: systemContext.slice(-2048),
    };
  }

  /** 记录消息到 Redis 滑动窗口 */
  async onMessage(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    await this.redis.appendMessage(sessionId, { role, content });
  }

  /** 会话结束：LLM 生成摘要 → 写入 Mem0 + 清理 Redis */
  async onSessionEnd(sessionId: string, userId: string) {
    const history = await this.redis.getHistory(sessionId);
    if (history.length === 0) return;

    try {
      const res = await this.llm.invoke(
        `总结以下对话要点（200字以内）：\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`,
      );
      await this.mem0.saveSessionSummary(userId, sessionId, String(res.content));
    } catch {
      // 静默降级
    }
    await this.redis.clearHistory(sessionId);
  }
}
