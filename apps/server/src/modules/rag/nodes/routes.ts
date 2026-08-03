import { AIMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { Logger } from '@nestjs/common';

const logger = new Logger('RAG:Router');

/** 根据意图分类结果路由 */
export function routeByIntent(state: AgentStateType): string {
  const intent = state.intent || 'simple';
  let route: string;
  switch (intent) {
    case 'chat': route = 'chat'; break;
    case 'simple': route = 'simple'; break;
    case 'complex': route = 'complex'; break;
    case 'followup': route = 'followup'; break;
    default: route = 'chat'; break;
  }
  logger.debug(`🔀 [routeByIntent] intent="${intent}" → ${route}`);
  return route;
}

/** Agent 循环中的下一步决策：继续调工具 or 生成答案 */
export function decideNext(state: AgentStateType): string {
  const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
  const hasTools = lastMsg?.tool_calls && lastMsg.tool_calls.length > 0;
  const canContinue = state.toolCallsRemaining > 0;
  const decision = (hasTools && canContinue) ? 'tools' : 'answer';
  logger.debug(
    `🔀 [decideNext] hasTools=${hasTools} remaining=${state.toolCallsRemaining} → ${decision}`,
  );
  return decision;
}
