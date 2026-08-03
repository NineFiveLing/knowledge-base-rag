import type { SourceRef } from '../components/chat/SourceCard';

/** 单条消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  promptContext?: {
    hasSummary: boolean;
    summaryLength: number;
    hasSystemContext: boolean;
    systemContextLength: number;
    hasHistory: boolean;
    historyLength: number;
    retrievedChunks: number;
    systemPrompt: string;
  };
}

/** 单对话的实时流式状态 */
export interface ConvLive {
  streaming: string;
  thinking: boolean;
  sources: SourceRef[];
  promptContext?: ChatMessage['promptContext'];
}

/**
 * 模块级聊天状态存储（跨路由持久化）
 *
 * React 组件卸载时 state 会丢失，但模块级变量不会。
 * 路由切换后再切回来，组件从这里恢复之前的聊天状态。
 */
class ChatStore {
  /** 每对话的流式实时状态 */
  convLiveMap = new Map<string, ConvLive>();

  /** 每对话的已加载消息缓存 */
  convMessagesMap = new Map<string, ChatMessage[]>();

  /** 当前活跃对话 ID */
  activeConvId: string | null = null;

  /** 订阅者（React setState），用于通知组件重渲染 */
  private subscribers = new Set<() => void>();

  subscribe(fn: () => void) {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  private notify() {
    this.subscribers.forEach((fn) => fn());
  }

  /** 保存当前对话的实时状态 */
  saveLiveState(convId: string, live: ConvLive) {
    this.convLiveMap.set(convId, live);
  }

  /** 获取对话的实时状态 */
  getLiveState(convId: string): ConvLive | undefined {
    return this.convLiveMap.get(convId);
  }

  /** 删除对话的实时状态 */
  deleteLiveState(convId: string) {
    this.convLiveMap.delete(convId);
  }

  /** 保存消息缓存 */
  saveMessages(convId: string, messages: ChatMessage[]) {
    this.convMessagesMap.set(convId, messages);
  }

  /** 获取消息缓存 */
  getMessages(convId: string): ChatMessage[] | undefined {
    return this.convMessagesMap.get(convId);
  }

  /** 追加消息到缓存 */
  appendMessage(convId: string, msg: ChatMessage) {
    const msgs = this.convMessagesMap.get(convId) || [];
    msgs.push(msg);
    this.convMessagesMap.set(convId, msgs);
  }

  /** 设置活跃对话 */
  setActiveConv(convId: string | null) {
    this.activeConvId = convId;
  }

  /** 触发重新渲染 */
  triggerRender() {
    this.notify();
  }
}

export const chatStore = new ChatStore();
