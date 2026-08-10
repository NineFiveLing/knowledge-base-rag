import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { Logger } from '@nestjs/common';

const logger = new Logger('RAG:Retrieval');

/** 创建检索执行节点：根据 LLM 选中的工具并行执行检索 */
export function createRetrievalNode(
  vectorSearchFn: (q: string) => Promise<string>,
  esSearchFn: (q: string) => Promise<string>,
  neo4jQueryFn: (q: string) => Promise<string>,
) {
  const toolMap: Record<string, (q: string) => Promise<string>> = {
    vector_search: vectorSearchFn,
    keyword_search: esSearchFn,
    knowledge_graph_query: neo4jQueryFn,
  };

  return async function executeRetrievalTools(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
    const toolMsgs: ToolMessage[] = [];
    // 累积所有检索轮次的 chunk，确保 agent 路径也能填充 retrievedChunks
    const aggregatedChunks = [...state.retrievedChunks];

    const toolNames = lastMsg.tool_calls?.map((tc) => tc.name) || [];
    logger.debug(
      `📌 [retrieval_tools] 进入 | 执行工具=[${toolNames.join(', ')}] 剩余轮次=${state.toolCallsRemaining}`,
    );

    if (lastMsg.tool_calls) {
      for (const call of lastMsg.tool_calls) {
        const fn = toolMap[call.name];
        if (fn) {
          const args = call.args as { query?: string; entity?: string };
          const q = args.query || args.entity || '';
          const toolStart = Date.now();

          const result = await fn(q);
          // 解析 tool 返回的 JSON 结果，提取 chunk 数据填充 retrievedChunks
          try {
            const items = JSON.parse(result);
            if (Array.isArray(items)) {
              for (const item of items) {
                aggregatedChunks.push({
                  chunk_text: item.chunk_text || '',
                  score: item.rerankScore ?? item.score ?? 0,
                  chunk_id: item.chunk_id,
                  postgres_doc_id: item.postgres_doc_id,
                });
              }
            }
            logger.debug(
              `  🔧 ${call.name}("${q.slice(0, 50)}") → ${items.length}条结果 | latency=${Date.now() - toolStart}ms`,
            );
          } catch { /* JSON 解析失败不影响主流程 */ }
          toolMsgs.push(new ToolMessage({ content: result, tool_call_id: call.id! }));
        }
      }
    }

    logger.debug(
      `📌 [retrieval_tools] 完成 | 累积chunks=${aggregatedChunks.length} 剩余轮次→${state.toolCallsRemaining - 1}`,
    );

    return {
      messages: toolMsgs,
      retrievedChunks: aggregatedChunks,
      toolCallsRemaining: state.toolCallsRemaining - 1,
    };
  };
}
