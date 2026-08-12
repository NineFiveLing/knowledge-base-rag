import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangfuseAPIClient } from '@langfuse/core';

/** LangFuse 评测 REST 客户端服务（追踪改由 OTel + CallbackHandler 内联处理） */
@Injectable()
export class LangfuseService implements OnModuleInit {
  private readonly logger = new Logger(LangfuseService.name);
  private langfuseClient: LangfuseAPIClient | null = null;

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
      this.logger.warn('LangFuse not initialized: LANGFUSE_PUBLIC_KEY is empty. Eval disabled.');
      return;
    }

    if (!secretKey || secretKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_SECRET_KEY is empty. Eval disabled.');
      return;
    }

    try {
      this.langfuseClient = new LangfuseAPIClient({
        environment: () => process.env.NODE_ENV || 'development',
        baseUrl: baseUrl ? () => baseUrl : undefined,
        username: () => publicKey,
        password: () => secretKey,
      });
      this.logger.log(`LangFuse initialized: baseUrl=${baseUrl || 'https://cloud.langfuse.com'}`);
    } catch (error) {
      this.logger.error(`LangFuse initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * 获取 LangFuse REST Client 实例（用于评测 Dataset/Score API）
   * @returns LangfuseAPIClient 实例，未初始化时返回 null
   */
  getClient(): LangfuseAPIClient | null {
    return this.langfuseClient;
  }

  /**
   * 优雅关闭（v5 SDK 自行管理连接，此处为生命周期占位）
   */
  async shutdown() {
    this.logger.log('LangFuse shutdown requested (v5 SDK manages connections lazily)');
  }
}
