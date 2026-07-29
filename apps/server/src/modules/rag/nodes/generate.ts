import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { MemoryService } from '../../memory/memory.service';

const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
- 准确、简洁，涉及流程的用步骤式说明
- 如果知识库内容不足，诚实说明
- 用户明确记忆的信息优先使用`;

/** 创建答案生成节点 */
export function createGenerateNode(llm: ChatOpenAI, memory: MemoryService) {
  return async function generateAnswer(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // 降级检查：检索无命中时直接返回人性化提示，不调用 LLM
    if (state.searchDegraded) {
      return {
        finalAnswer: state.searchFallbackMessage || '抱歉，未找到相关信息。',
        sources: [],
      };
    }

    const ctx = await memory.buildPromptContext(state.sessionId, state.userId);

    const contextParts = [ctx.systemContext];
    if (state.retrievedChunks.length > 0) {
      contextParts.push(`## 检索结果\n${state.retrievedChunks.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')}`);
    }

    const system = `${ANSWER_PROMPT}\n\n${contextParts.filter(Boolean).join('\n')}`;
    const userMsg = state.messages.filter((m) => m.getType() === 'human').slice(-1)[0];

    const res = await llm.invoke([new SystemMessage(system), userMsg]);

    // 构建来源列表
    const sources = state.retrievedChunks.map((c, i) => ({
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
