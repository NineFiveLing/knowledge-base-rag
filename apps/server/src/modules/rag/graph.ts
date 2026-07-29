import { StateGraph, END } from '@langchain/langgraph';
import { AgentState } from './state';

/**
 * 创建 RAG 状态图
 * 工作流：意图分类 → 路由分发 → (直接回答/简单检索/Agent 循环) → 生成答案
 */
export function createRAGGraph(
  classifyIntent: any,
  directAnswer: any,
  simpleRetrieval: any,
  agentReAct: any,
  agentFollowUpNode: any,
  executeTools: any,
  generateAnswer: any,
  routeByIntent: any,
  decideNext: any,
) {
  return new StateGraph(AgentState)
    .addNode('intent_classifier', classifyIntent)
    .addNode('direct_answer', directAnswer)
    .addNode('simple_retrieval', simpleRetrieval)
    .addNode('agent', agentReAct)
    .addNode('agent_followup', agentFollowUpNode)
    .addNode('retrieval_tools', executeTools)
    .addNode('generate_answer', generateAnswer)

    // 修复：确保意图分类被执行
    .addEdge('__start__', 'intent_classifier')
    .addConditionalEdges('intent_classifier', routeByIntent, {
      chat: 'direct_answer',
      simple: 'simple_retrieval',
      complex: 'agent',
      followup: 'agent_followup',
    })

    .addEdge('direct_answer', END)
    .addEdge('simple_retrieval', 'generate_answer')

    .addConditionalEdges('agent', decideNext, {
      tools: 'retrieval_tools',
      answer: 'generate_answer',
    })
    .addConditionalEdges('agent_followup', decideNext, {
      tools: 'retrieval_tools',
      answer: 'generate_answer',
    })
    .addEdge('retrieval_tools', 'agent')
    .addEdge('generate_answer', END)

    .compile();
}
