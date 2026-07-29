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
  }>>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  finalAnswer: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  toolCallsRemaining: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 5,
  }),
});

export type AgentStateType = typeof AgentState.State;
