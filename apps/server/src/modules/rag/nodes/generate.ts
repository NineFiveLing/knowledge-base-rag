import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Repository, In } from 'typeorm';
import { AgentStateType } from '../state';
import { MemoryService } from '../../memory/memory.service';
import { LangfuseService } from '../../../common/observability/langfuse.service';
import { Document } from '../../document/entities/document.entity';
import { Logger } from '@nestjs/common';

const logger = new Logger('RAG:Generate');

const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
- 准确、简洁，涉及流程的用步骤式说明
- 如果知识库内容不足，诚实说明
- 用户明确记忆的信息优先使用
- 不要在回答中使用引用编号、来源标记或 [citation:N] 格式，直接输出答案内容`;

/** 文本双字符 bigram（兼容中文） */
function bigrams(text: string): Set<string> {
  const bgs = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) bgs.add(text.slice(i, i + 2));
  return bgs;
}

/** 基于 character-level bigram 的 Jaccard 相似度 */
function bigramJaccard(a: string, b: string): number {
  if (a === b) return 1;
  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / Math.max(union.size, 1);
}

/** 对检索结果去重：第一轮 chunk_id 精确去重，第二轮内容 bigram 模糊去重 */
function dedupChunks(
  chunks: Array<{ chunk_text: string; score: number; chunk_id?: string; postgres_doc_id?: string }>,
) {
  // 第一轮：按 chunk_id 精确去重，保留 score 最高的
  const byId = new Map<string, (typeof chunks)[number]>();
  for (const c of chunks) {
    const key = c.chunk_id || c.chunk_text;
    const existing = byId.get(key);
    if (!existing || c.score > existing.score) byId.set(key, c);
  }

  // 第二轮：按 bigram Jaccard 模糊去重（阈值 0.85）
  const seen: (typeof chunks)[number][] = [];
  for (const c of byId.values()) {
    const isDup = seen.some((s) => bigramJaccard(s.chunk_text, c.chunk_text) >= 0.85);
    if (!isDup) seen.push(c);
  }
  return seen;
}

/** 创建答案生成节点 */
export function createGenerateNode(llm: ChatOpenAI, memory: MemoryService, langfuse?: LangfuseService, docRepo?: Repository<Document>) {
  return async function generateAnswer(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const startTime = Date.now();

    // 降级检查：检索无命中时直接返回人性化提示，不调用 LLM
    if (state.searchDegraded) {
      return {
        finalAnswer: state.searchFallbackMessage || '抱歉，未找到相关信息。',
        sources: [],
      };
    }

    const deduped = dedupChunks(state.retrievedChunks);

    const ctx = await memory.buildPromptContext(state.sessionId, state.userId);

    // 组装上下文：增量摘要 + 长期记忆 + 检索结果 + 近期对话
    const contextParts = [ctx.summary, ctx.systemContext].filter(Boolean);
    if (deduped.length > 0) {
      contextParts.push(`## 检索结果\n${deduped.map((c) => `---\n${c.chunk_text}`).join('\n\n')}`);
    }
    if (ctx.history) {
      contextParts.push(`## 近期对话\n${ctx.history}`);
    }

    // ── 调试输出：生成阶段的上下文情况 ──
    logger.debug(
      `📌 [generate_answer] 进入 | ` +
      `检索chunks=${state.retrievedChunks.length}条 去重后=${deduped.length}条 ` +
      `降级=${state.searchDegraded} | ` +
      `摘要: ${ctx.summary.length}字符 | ` +
      `近期历史: ${ctx.history.length}字符 | ` +
      `长期记忆: ${ctx.systemContext.length}字符`,
    );

    const system = `${ANSWER_PROMPT}\n\n${contextParts.filter(Boolean).join('\n')}`;
    const userMsg = state.messages.filter((m) => m.getType() === 'human').slice(-1)[0];
    const query = typeof userMsg.content === 'string' ? userMsg.content : '';

    const res = await llm.invoke([new SystemMessage(system), userMsg]);

    // 记录 LLM generation
    if (langfuse?.isEnabled() && state.langfuseTraceId) {
      langfuse.recordGeneration(state.langfuseTraceId, {
        name: 'answer_generation',
        input: { query, chunksCount: state.retrievedChunks.length },
        output: { answer: String(res.content) },
        model: 'deepseek-chat',
      });
    }

    // 构建来源列表，附带文档名称
    const uniqueDocIds = [...new Set(deduped.map((c) => c.postgres_doc_id).filter(Boolean))] as string[];
    const docNameMap = new Map<string, string>();
    const docTypeMap = new Map<string, string>();
    const docSizeMap = new Map<string, number>();
    if (docRepo && uniqueDocIds.length > 0) {
      try {
        const docs = await docRepo.find({ where: { id: In(uniqueDocIds) } });
        for (const d of docs) {
          docNameMap.set(d.id, d.name);
          docTypeMap.set(d.id, d.type);
          docSizeMap.set(d.id, Number(d.size) || 0);
        }
      } catch {
        // 查询文档元信息失败不影响主流程
      }
    }
    // 计算每个文档的最高检索分数（用于排序）
    const docScoreMap = new Map<string, number>();
    for (const c of deduped) {
      const id = c.postgres_doc_id || '';
      if (!id) continue;
      const best = docScoreMap.get(id) || 0;
      if (c.score > best) docScoreMap.set(id, c.score);
    }

    const seen = new Set<string>();
    const sources = deduped
      .filter((c) => {
        const id = c.postgres_doc_id || '';
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((c) => ({
        docId: c.postgres_doc_id || '',
        chunkId: c.chunk_id || '',
        docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
        docType: docTypeMap.get(c.postgres_doc_id || '') || 'text',
        docSize: docSizeMap.get(c.postgres_doc_id || '') || 0,
        _score: docScoreMap.get(c.postgres_doc_id || '') || 0,
      }))
      .sort((a, b) => b._score - a._score)
      .map((s, i) => ({
        index: i + 1,
        docId: s.docId,
        chunkId: s.chunkId,
        docName: s.docName,
        docType: s.docType,
        docSize: s.docSize,
      }));

    // 将来源 JSON 嵌入答案末尾，前端/SSE 层解析后剥离
    const sourcesTag = `\n<!-- SOURCES:${JSON.stringify(sources)} -->`;
    return {
      finalAnswer: String(res.content) + sourcesTag,
      messages: [res],
      sources,
    };
  };
}
