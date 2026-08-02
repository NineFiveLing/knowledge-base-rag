import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AsrSession, AsrCallbacks, AsrProvider } from './asr/asr-provider.interface';
import { createAsrProvider } from './asr/asr-provider.factory';

/**
 * 语音识别编排服务
 *
 * 管理多会话 ASR 生命周期，通过 Provider 模式支持阿里云/腾讯云可切换。
 * 会话以 Socket.IO client.id 为 key。
 */
@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);
  private readonly provider: AsrProvider;
  private readonly sessions = new Map<string, AsrSession>();

  constructor(private readonly config: ConfigService) {
    this.provider = createAsrProvider(config);
    this.logger.log(`ASR 提供商已初始化: ${config.get('DEFAULT_ASR_PROVIDER') || 'aliyun'}`);
  }

  /** 开始识别会话 */
  async startSession(sessionId: string, callbacks: AsrCallbacks): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`会话 ${sessionId} 已存在，先结束旧会话`);
      await this.endSession(sessionId).catch(() => {});
    }

    try {
      const session = await this.provider.start(sessionId, callbacks);
      this.sessions.set(sessionId, session);
      this.logger.log(`ASR 会话开始: ${sessionId}`);
    } catch (err) {
      this.logger.error(`ASR 会话启动失败: ${sessionId} — ${(err as Error).message}`);
      callbacks.onError(err as Error);
      throw err;
    }
  }

  /** 送入音频数据 */
  async feedAudio(sessionId: string, buffer: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`feedAudio 无活动会话: ${sessionId}`);
      return;
    }
    await session.feedAudio(buffer);
  }

  /** 结束识别会话，返回最终完整文本 */
  async endSession(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`endSession 无活动会话: ${sessionId}`);
      return '';
    }

    try {
      const remaining = await session.end();
      this.sessions.delete(sessionId);
      this.logger.log(`ASR 会话结束: ${sessionId}, 文本长度: ${remaining.length}`);
      return remaining;
    } catch (err) {
      this.logger.error(`ASR 会话结束异常: ${sessionId} — ${(err as Error).message}`);
      this.sessions.delete(sessionId);
      return '';
    }
  }
}
