import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';
import { MemoryService } from '../../memory/memory.service';
import { LangfuseService } from '../../../common/observability/langfuse.service';

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
export function createAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService, langfuse?: LangfuseService) {
  const llmTools = llm.bindTools(tools);

  return async function agentReAct(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const startTime = Date.now();

    // 加载记忆上下文
    const ctx = await memory.buildPromptContext(state.sessionId, state.userId);

    const messages = [
      new SystemMessage(`${AGENT_SYSTEM}\n${ctx.systemContext}`),
      ...state.messages,
    ];

    const res = await llmTools.invoke(messages);

    // 记录 Agent LLM generation
    if (langfuse?.isEnabled() && state.langfuseTraceId) {
      const toolCalls = (res as AIMessage).tool_calls?.map((tc: any) => tc.name) || [];
      langfuse.recordGeneration(state.langfuseTraceId, {
        name: 'agent_react',
        input: { messageCount: messages.length, toolCallsRemaining: state.toolCallsRemaining },
        output: { content: String(res.content).slice(0, 200), toolCalls, latencyMs: Date.now() - startTime },
        model: 'deepseek-chat',
      });
    }

    return { messages: [res] };
  };
}

/**
 * 创建追问模式 Agent 节点：maxRounds=1（仅一轮工具调用），
 * 进入时覆盖 toolCallsRemaining，之后委托给普通 agent 循环
 */
export function createFollowUpAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService, langfuse?: LangfuseService) {
  const agentReAct = createAgentNode(llm, tools, memory, langfuse);

  return async function agentFollowUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
    // 首次进入时限制工具调用轮次为 1（追问模式轻量检索）
    const result = await agentReAct(state);
    return {
      ...result,
      toolCallsRemaining: 1, // 覆盖：追问模式下只允许 1 次工具调用
    };
  };
}
