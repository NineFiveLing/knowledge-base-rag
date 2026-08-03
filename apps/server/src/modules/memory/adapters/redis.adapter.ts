import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis/redis.service';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Redis 短期记忆适配器：会话滑动窗口（最近 8 轮）+ 增量摘要压缩 + 检索缓存 */
@Injectable()
export class RedisMemoryAdapter {
  /** 最大保留消息数（16 条 = 8 轮对话） */
  private readonly MAX_MESSAGES = 16;
  /** 触发增量压缩前的最小消息数 */
  private readonly COMPRESS_THRESHOLD = 12;

  constructor(private redis: RedisService) {}

  /** 获取会话聊天历史 */
  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const raw = await this.redis.getSessionHistory(sessionId);
    return (raw || []) as ChatMessage[];
  }

  /** 获取运行中增量摘要 */
  async getSummary(sessionId: string): Promise<string> {
    return this.redis.getSessionSummary(sessionId);
  }

  /** 设置运行中增量摘要 */
  async setSummary(sessionId: string, summary: string): Promise<void> {
    await this.redis.setSessionSummary(sessionId, summary);
  }

  /**
   * 追加消息到滑动窗口
   * @returns 需要压缩的溢出消息，没有溢出时返回 null
   */
  async appendMessage(sessionId: string, message: ChatMessage): Promise<ChatMessage[] | null> {
    const history = await this.getHistory(sessionId);
    history.push(message);

    if (history.length > this.MAX_MESSAGES) {
      // 取最旧的溢出消息进行压缩，保留最新的 MAX_MESSAGES 条
      const overflow = history.slice(0, history.length - this.MAX_MESSAGES);
      const trimmed = history.slice(-this.MAX_MESSAGES);
      await this.redis.setSessionHistory(sessionId, trimmed);
      return overflow; // 调用方应当异步压缩这些消息
    }

    await this.redis.setSessionHistory(sessionId, history);
    return null;
  }

  /** 清空会话历史 */
  async clearHistory(sessionId: string): Promise<void> {
    await this.redis.clearSessionHistory(sessionId);
  }

  /** 清空会话摘要 */
  async clearSummary(sessionId: string): Promise<void> {
    await this.redis.clearSessionSummary(sessionId);
  }

  /** 获取缓存检索结果 */
  async getCachedSearch(sessionId: string, query: string): Promise<any> {
    const hash = this.simpleHash(query);
    return this.redis.getCachedSearch(`${sessionId}:${hash}`);
  }

  /** 缓存检索结果 */
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
