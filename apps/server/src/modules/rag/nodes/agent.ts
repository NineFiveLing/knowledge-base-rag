import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { MemoryService } from '../../memory/memory.service';

const AGENT_SYSTEM = `你是企业知识库智能助手，可以使用工具查找信息。

可用工具:
1. vector_search —— 语义搜索文档内容
2. keyword_search —— 关键字全文搜索
3. knowledge_graph_query —— 查询实体关系图谱

规则：
- 先理解问题再选工具；一次可并行调用多个工具
- 检索不充分时换关键词或用不同工具重试
- 信息充分后基于检索结果回答；用户说"记住xxx"直接确认`;

/** 创建 Agent ReAct 节点 */
export function createAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService) {
  const llmTools = llm.bindTools(tools);

  return async function agentReAct(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // 加载记忆上下文
    const ctx = await memory.buildPromptContext(state.sessionId, state.userId);

    const messages = [
      new SystemMessage(`${AGENT_SYSTEM}\n${ctx.systemContext}`),
      ...state.messages,
    ];

    const res = await llmTools.invoke(messages);
    return { messages: [res] };
  };
}
