import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

const INTENT_PROMPT = `你是企业知识库助手的意图分类器。分析用户问题，归类为：

- chat: 问候、闲聊、无关话题、或"记住xxx"指令
- simple: 简单事实查询，单一知识点即可回答（如"年假有几天？"）
- complex: 需要综合多份文档、多步推理、流程类问题（如"报销完整流程？"）

只回复一个词：chat / simple / complex`;

/** 追问模式检测（规则层，毫秒级，不调 LLM） */
function detectFollowUp(message: string, history: Array<{ role: string; content: string }>): boolean {
  if (!history || history.length === 0) return false;

  const trimmed = message.trim();

  const followUpPatterns = [
    /^(那么|这个|那个|它|这|那|上面|前面|刚才|刚刚)/,
    /^(第二个|第\d+个|还有呢|继续说|详细|展开|具体)/,
    /^(能|可以|能不能).*(详细|具体|再|展开|说|讲)/,
    /^(什么意思|为什么|然后呢|接着说|所以呢)/,
    /^[再还]?(说|讲|解释|介绍)/,
    /^(哦|嗯|啊|对|是的|对的|好的)/,
    /^(举个例子|比如|比方说)/,
  ];

  if (followUpPatterns.some(p => p.test(trimmed))) return true;

  // 短消息 + 有对话历史 → 高度怀疑是追问
  if (trimmed.length < 10) return true;

  return false;
}

/** 创建意图分类节点 */
export function createIntentClassifier(llm: ChatOpenAI) {
  return async function classifyIntent(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const lastMsg = state.messages[state.messages.length - 1];
    const content = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);

    // 追问检测（规则层，优先于 LLM 分类）
    const history = state.messages.slice(0, -1).map(m => ({
      role: m.getType?.() ?? 'unknown',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    if (detectFollowUp(content, history)) {
      return { intent: 'followup' };
    }

    // 检测"记住xxx"模式
    if (/^(记住|请记住|帮我记住)/.test(content)) {
      return { intent: 'chat' };
    }

    const res = await llm.invoke([new SystemMessage(INTENT_PROMPT), new HumanMessage(content)]);
    const intent = String(res.content).trim().toLowerCase();
    return { intent: ['chat', 'simple', 'complex'].includes(intent) ? intent : 'simple' };
  };
}
