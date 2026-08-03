import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TtsProvider, TtsSession, TtsCallbacks } from './tts/tts-provider.interface';
import { createTtsProvider } from './tts/tts-provider.factory';

/**
 * TTS 编排服务
 *
 * 管理多会话 TTS 生命周期，通过 Provider 模式支持阿里云 NLS 流式合成。
 * 会话以 sessionId 为 key（与 chat session 对应）。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly provider: TtsProvider;
  private readonly sessions = new Map<string, TtsSession>();

  constructor(private readonly config: ConfigService) {
    this.provider = createTtsProvider(config);
  }

  /** 开始合成会话 */
  async startSession(sessionId: string, callbacks: TtsCallbacks): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`TTS 会话 ${sessionId} 已存在，先结束旧会话`);
      this.cancelSession(sessionId);
    }

    try {
      const session = await this.provider.start(callbacks);
      this.sessions.set(sessionId, session);
      this.logger.log(`TTS 会话开始: ${sessionId}`);
    } catch (err) {
      this.logger.error(`TTS 会话启动失败: ${sessionId} — ${(err as Error).message}`);
      throw err;
    }
  }

  /** 送入文本（流式 feed） */
  feedText(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.feedText(text);
  }

  /** 结束合成 */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.end();
    this.sessions.delete(sessionId);
    this.logger.log(`TTS 会话结束: ${sessionId}`);
  }

  /** 取消合成（暂停用，不触发 onEnd） */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.cancel();
    this.sessions.delete(sessionId);
    this.logger.log(`TTS 会话取消: ${sessionId}`);
  }
}
