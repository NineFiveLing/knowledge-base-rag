/** TTS 合成结果回调 */
export interface TtsCallbacks {
  /** 音频分片（PCM 16kHz 16bit 单声道） */
  onAudioChunk: (buffer: Buffer) => void;
  /** 全部合成完成 */
  onEnd: () => void;
  /** 合成过程中的错误 */
  onError: (error: Error) => void;
}

/** 单个 TTS 合成会话 */
export interface TtsSession {
  /** 送入文本（可多次调用实现流式输入） */
  feedText(text: string): void;
  /** 结束文本输入，服务端合成剩余缓存后触发 onEnd */
  end(): void;
  /** 立即取消（暂停用，不触发 onEnd） */
  cancel(): void;
}

/** TTS 提供商抽象接口 */
export interface TtsProvider {
  /** 创建合成会话，连接 TTS 服务端 WebSocket */
  start(callbacks: TtsCallbacks): Promise<TtsSession>;
}
