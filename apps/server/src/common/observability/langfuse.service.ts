import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Langfuse } from 'langfuse';
import { ConfigService } from '@nestjs/config';

/**
 * LangFuse 可观测性服务
 * 内部维护 activeTraces Map，允许节点通过 traceId（字符串）查找 trace 并创建 span
 */
@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private client!: Langfuse;
  /** 活跃 trace 缓存，key 为 traceId */
  private activeTraces = new Map<string, any>();

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const publicKey = this.config.get('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.config.get('LANGFUSE_SECRET_KEY');
    if (!publicKey || !secretKey) {
      console.warn('[LangFuse] 未配置密钥，可观测性功能禁用');
      return;
    }
    this.client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: this.config.get('LANGFUSE_HOST') || 'https://cloud.langfuse.com',
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.shutdownAsync();
    }
  }

  /** 判断 LangFuse 是否已配置 */
  isEnabled(): boolean {
    return !!this.client;
  }

  /** 创建顶层 trace 并返回其 ID（字符串，可安全存入 LangGraph state） */
  createTrace(name: string, input?: any, userId?: string, sessionId?: string): string | null {
    if (!this.client) return null;
    const trace = this.client.trace({ name, input, userId, sessionId });
    const traceId = trace.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.activeTraces.set(traceId, trace);
    return traceId;
  }

  /** 根据 traceId 获取 trace 对象 */
  getTrace(traceId: string): any | null {
    return this.activeTraces.get(traceId) || null;
  }

  /** 在指定 trace 下创建 span */
  createSpan(traceId: string, name: string, input?: any): any | null {
    const trace = this.getTrace(traceId);
    if (!trace) return null;
    return trace.span({ name, input: input ?? undefined });
  }

  /** 结束 span */
  endSpan(span: any, output?: any): void {
    if (!span) return;
    if (output !== undefined) {
      span.update({ output });
    }
    span.end();
  }

  /** 记录 LLM generation */
  recordGeneration(traceId: string, data: {
    name: string;
    input: any;
    output: any;
    model?: string;
    usage?: { promptTokens?: number; completionTokens?: number };
  }): void {
    if (!this.client) return;
    const trace = this.getTrace(traceId);
    if (!trace) return;
    const gen = trace.generation({
      name: data.name,
      input: data.input,
      output: data.output,
      model: data.model,
      usage: data.usage,
    });
    gen.end();
  }

  /** 手动 flush，确保数据上报，并清理已上报的 trace 防止内存泄漏 */
  async flush(): Promise<void> {
    if (this.client) {
      await this.client.flushAsync();
    }
    // 清理已上报的 trace，防止内存泄漏
    this.activeTraces.clear();
  }
}
