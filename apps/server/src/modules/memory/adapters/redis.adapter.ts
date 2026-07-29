import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis/redis.service';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Redis 短期记忆适配器：会话滑动窗口（最近 8 轮）+ 检索缓存 */
@Injectable()
export class RedisMemoryAdapter {
  private readonly MAX_ROUNDS = 8;

  constructor(private redis: RedisService) {}

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const raw = await this.redis.getSessionHistory(sessionId);
    return (raw || []) as ChatMessage[];
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const history = await this.getHistory(sessionId);
    history.push(message);
    const trimmed = history.slice(-this.MAX_ROUNDS * 2);
    await this.redis.setSessionHistory(sessionId, trimmed);
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.redis.client.del(`session:${sessionId}:history`);
  }

  async getCachedSearch(sessionId: string, query: string): Promise<any> {
    const hash = this.simpleHash(query);
    return this.redis.getCachedSearch(`${sessionId}:${hash}`);
  }

  async cacheSearch(sessionId: string, query: string, results: any): Promise<void> {
    const hash = this.simpleHash(query);
    await this.redis.cacheSearchResult(`${sessionId}:${hash}`, results);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }
}
