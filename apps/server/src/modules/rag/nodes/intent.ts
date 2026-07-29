import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

const INTENT_PROMPT = `你是企业知识库助手的意图分类器。分析用户问题，归类为：

- chat: 问候、闲聊、无关话题、或"记住xxx"指令
- simple: 简单事实查询，单一知识点即可回答（如"年假有几天？"）
- complex: 需要综合多份文档、多步推理、流程类问题（如"报销完整流程？"）

只回复一个词：chat / simple / complex`;

/** 创建意图分类节点 */
export function createIntentClassifier(llm: ChatOpenAI) {
  return async function classifyIntent(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const lastMsg = state.messages[state.messages.length - 1];
    const content = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);

    // 检测"记住xxx"模式
    if (/^(记住|请记住|帮我记住)/.test(content)) {
      return { intent: 'chat' };
    }

    const res = await llm.invoke([new SystemMessage(INTENT_PROMPT), new HumanMessage(content)]);
    const intent = String(res.content).trim().toLowerCase();
    return { intent: ['chat', 'simple', 'complex'].includes(intent) ? intent : 'simple' };
  };
}
