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

  /** 当前 SSE 流所属的会话 ID（用于 SSE 回调的前后台路由判断） */
  currentSSESessionConvId: string | null = null;

  /** 每对话的流式 TTS messageId 映射（用于前后台切换时匹配音频） */
  streamMessageIdMap = new Map<string, string>();

  setStreamMessageId(convId: string, messageId: string) {
    this.streamMessageIdMap.set(convId, messageId);
  }

  getStreamMessageId(convId: string): string | undefined {
    return this.streamMessageIdMap.get(convId);
  }

  /** 应用层会话 ID —— 仅生成一次，跨路由切换保持不变。
   *  TTS voice socket 注册和 SSE 流必须使用同一个 sessionId，否则后端 getVoiceSocket 找不到。 */
  readonly sessionId: string = `sess-${Date.now()}`;

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
}

export const chatStore = new ChatStore();
