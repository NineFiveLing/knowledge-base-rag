import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangfuseAPIClient } from '@langfuse/core';
import { CallbackHandler } from '@langfuse/langchain';

/** LangFuse 可观测性服务：管理 Client 生命周期，提供带标签的 CallbackHandler */
@Injectable()
export class LangfuseService implements OnModuleInit {
  private readonly logger = new Logger(LangfuseService.name);
  private langfuseClient: LangfuseAPIClient | null = null;
  private initialized = false;

  constructor(private config: ConfigService) {
    this.initClient();
  }

  onModuleInit() {
    // 双重保障：生产环境生命周期钩子
    this.initClient();
  }

  private initClient() {
    const publicKey = this.config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.config.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl = this.config.get<string>('LANGFUSE_BASE_URL');

    if (!publicKey || publicKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_PUBLIC_KEY is empty. Tracing disabled.');
      return;
    }

    if (!secretKey || secretKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_SECRET_KEY is empty. Tracing disabled.');
      return;
    }

    try {
      this.langfuseClient = new LangfuseAPIClient({
        environment: () => process.env.NODE_ENV || 'development',
        baseUrl: baseUrl ? () => baseUrl : undefined,
        username: () => publicKey,
        password: () => secretKey,
      });
      this.initialized = true;
      this.logger.log(`LangFuse initialized: baseUrl=${baseUrl || 'https://cloud.langfuse.com'}`);
    } catch (error) {
      this.logger.error(`LangFuse initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * 获取带用户标签的 CallbackHandler
   * @param opts 用户上下文信息
   * @returns CallbackHandler 实例，未初始化时返回 null
   */
  getCallbackHandler(opts: {
    userId: string;
    sessionId: string;
    conversationId?: string;
  }): CallbackHandler | null {
    if (!this.initialized) {
      return null;
    }

    const tags: string[] = [
      `userId:${opts.userId}`,
      `sessionId:${opts.sessionId}`,
    ];

    if (opts.conversationId) {
      tags.push(`conversationId:${opts.conversationId}`);
    }

    const metadata: Record<string, unknown> = {
      userId: opts.userId,
      sessionId: opts.sessionId,
    };
    if (opts.conversationId) {
      metadata.conversationId = opts.conversationId;
    }

    return new CallbackHandler({
      userId: opts.userId,
      sessionId: opts.sessionId,
      tags,
      traceMetadata: metadata,
    });
  }

  /**
   * 获取 LangFuse Client 实例（用于评测等高级用法）
   * @returns LangFuse 客户端实例，未初始化时返回 null
   */
  getClient(): LangfuseAPIClient | null {
    return this.langfuseClient;
  }

  /**
   * 优雅关闭（v5 CallbackHandler 自行管理连接，此处为生命周期占位）
   */
  async shutdown() {
    this.logger.log('LangFuse shutdown requested (v5 CallbackHandler manages connections lazily)');
  }
}
