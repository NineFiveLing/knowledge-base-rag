import { Injectable } from '@nestjs/common';
import Memory from 'mem0ai';
import { ConfigService } from '@nestjs/config';

/** Mem0 长期记忆适配器：用户画像 + 重要事实 + 会话摘要 + 明确记忆 */
@Injectable()
export class Mem0Adapter {
  private memory!: Memory;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const key = this.config.get('MEM0_API_KEY');
    if (!key) return;
    try {
      this.memory = new Memory({ apiKey: key } as any);
    } catch {
      // Mem0 初始化失败时静默降级
    }
  }

  /** 获取用户上下文 */
  async getUserContext(userId: string): Promise<string> {
    if (!this.memory) return '';
    try {
      const result = await this.memory.search(`user memories for ${userId}`);
      const items = (result as any).results || result || [];
      return Array.isArray(items) ? items.map((m: any) => m.memory || m).join('\n') : '';
    } catch {
      return '';
    }
  }

  /** 记住一条信息 */
  async rememberFact(userId: string, fact: string, source: 'auto' | 'explicit' = 'auto'): Promise<void> {
    if (!this.memory) return;
    try {
      await this.memory.add([{ role: 'user', content: `[${source}] ${fact}` }], { user_id: userId });
    } catch {
      // 静默降级
    }
  }

  /** 保存会话摘要 */
  async saveSessionSummary(userId: string, sessionId: string, summary: string): Promise<void> {
    if (!this.memory) return;
    try {
      await this.memory.add(
        [{ role: 'user', content: `[会话摘要 ${sessionId}] ${summary}` }],
        { user_id: userId },
      );
    } catch {
      // 静默降级
    }
  }
}
