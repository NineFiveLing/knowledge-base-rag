import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

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

    if (lastMsg.tool_calls) {
      for (const call of lastMsg.tool_calls) {
        const fn = toolMap[call.name];
        if (fn) {
          const args = call.args as { query?: string; entity?: string };
          const q = args.query || args.entity || '';
          const result = await fn(q);
          toolMsgs.push(new ToolMessage({ content: result, tool_call_id: call.id! }));
        }
      }
    }

    return {
      messages: toolMsgs,
      toolCallsRemaining: state.toolCallsRemaining - 1,
    };
  };
}
