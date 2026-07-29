import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

/**
 * Redis 缓存服务
 * 提供会话历史储存（滑动窗口 8 轮）和检索结果缓存（30 分钟 TTL）
 */
@Injectable()
export class RedisService implements OnModuleInit {
  /** ioredis 客户端实例 */
  public client!: Redis;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: Number(this.config.get('REDIS_PORT', '6379')),
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 3000), // 最长 3s 退避重连
    });
  }

  /** 保存会话历史（最多保留 8 轮 = 16 条消息） */
  async setSessionHistory(
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    ttl: number = 1800,
  ) {
    await this.client.setex(
      `session:${sessionId}:history`,
      ttl,
      JSON.stringify(messages.slice(-16)),
    );
  }

  /** 获取会话历史 */
  async getSessionHistory(
    sessionId: string,
  ): Promise<Array<{ role: string; content: string }>> {
    const raw = await this.client.get(`session:${sessionId}:history`);
    return raw ? JSON.parse(raw) : [];
  }

  /** 缓存检索结果 */
  async cacheSearchResult(
    queryHash: string,
    results: any[],
    ttl: number = 1800,
  ) {
    await this.client.setex(
      `cache:search:${queryHash}`,
      ttl,
      JSON.stringify(results),
    );
  }

  /** 获取缓存检索结果 */
  async getCachedSearch(queryHash: string) {
    const raw = await this.client.get(`cache:search:${queryHash}`);
    return raw ? JSON.parse(raw) : null;
  }
}
