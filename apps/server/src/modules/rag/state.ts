import { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

/**
 * Agent 状态定义
 * LangGraph 1.x Annotation API: 每个字段需要 value (reducer/binaryOp)
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  intent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  userId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  sessionId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  retrievedChunks: Annotation<Array<{
    chunk_text: string;
    score: number;
    chunk_id?: string;
    postgres_doc_id?: string;
  }>>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  /** 检索降级标记：当所有结果均低于阈值时为 true */
  searchDegraded: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  /** 降级时的用户友好提示语 */
  searchFallbackMessage: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  /** 检索来源列表，用于前端展示 */
  sources: Annotation<Array<{
    index: number;
    docId: string;
    chunkId: string;
    docName: string;
    docType: string;
    docSize: number;
  }>>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  finalAnswer: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  /** LangFuse trace ID（字符串，可安全序列化），未配置 LangFuse 时为空 */
  langfuseTraceId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  toolCallsRemaining: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 5,
  }),
  /** 提示词上下文（供前端调试展示增强后的提示词信息） */
  promptContext: Annotation<{
    hasSummary: boolean;
    summaryLength: number;
    hasSystemContext: boolean;
    systemContextLength: number;
    hasHistory: boolean;
    historyLength: number;
    retrievedChunks: number;
    systemPrompt: string;
  } | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
