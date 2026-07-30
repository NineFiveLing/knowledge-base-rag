import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { MemoryService } from '../../memory/memory.service';
import { LangfuseService } from '../../../common/observability/langfuse.service';

const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
- 准确、简洁，涉及流程的用步骤式说明
- 如果知识库内容不足，诚实说明
- 用户明确记忆的信息优先使用`;

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
export function createGenerateNode(llm: ChatOpenAI, memory: MemoryService, langfuse?: LangfuseService) {
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

    const contextParts = [ctx.systemContext];
    if (deduped.length > 0) {
      contextParts.push(`## 检索结果\n${deduped.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')}`);
    }

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

    // 构建来源列表
    const sources = deduped.map((c, i) => ({
      index: i + 1,
      docId: c.postgres_doc_id || '',
      chunkId: c.chunk_id || '',
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
