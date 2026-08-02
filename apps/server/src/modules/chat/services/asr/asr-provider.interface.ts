/** ASR 识别结果回调 */
export interface AsrCallbacks {
  /** 中间识别结果（VAD 未断句，实时展示用） */
  onPartialResult: (text: string) => void;
  /** 最终识别结果（VAD 判定断句后确认的文本） */
  onFinalResult: (text: string) => void;
  /** 识别过程中的错误 */
  onError: (error: Error) => void;
}

/** 单个 ASR 识别会话 */
export interface AsrSession {
  /** 送入 PCM 16kHz 16bit 单声道音频 */
  feedAudio(buffer: Buffer): Promise<void>;
  /** 结束识别会话，返回服务端未 flush 的剩余文本 */
  end(): Promise<string>;
}

/** ASR 提供商抽象接口 */
export interface AsrProvider {
  /** 创建识别会话，连接 ASR 服务端 WebSocket */
  start(sessionId: string, callbacks: AsrCallbacks): Promise<AsrSession>;
}
