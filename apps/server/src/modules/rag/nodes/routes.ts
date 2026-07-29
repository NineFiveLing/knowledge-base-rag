import { AIMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

/** 根据意图分类结果路由 */
export function routeByIntent(state: AgentStateType): string {
  return state.intent || 'simple';
}

/** Agent 循环中的下一步决策：继续调工具 or 生成答案 */
export function decideNext(state: AgentStateType): string {
  const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMsg?.tool_calls && lastMsg.tool_calls.length > 0 && state.toolCallsRemaining > 0) {
    return 'tools';
  }
  return 'answer';
}
