import { Injectable } from '@nestjs/common';
import { RAGService } from '../rag/rag.service';
import { MemoryService } from '../memory/memory.service';
import { LangfuseService } from '../../common/observability/langfuse.service';

/** 聊天服务：SSE 流式 + 记忆管理 + "记住xxx"处理 */
@Injectable()
export class ChatService {
  constructor(
    private rag: RAGService,
    public memory: MemoryService,
    private langfuse: LangfuseService,
  ) {}

  async *streamAnswer(message: string, userId: string, sessionId: string) {
    // 检测"记住xxx"模式 → 写入 Mem0 明确记忆
    if (/^(记住|请记住|帮我记住)/.test(message)) {
      const fact = message.replace(/^(记住|请记住|帮我记住)[，,：:\s]*/, '');
      const mem0Adapter = (this.memory as any).mem0;
      if (mem0Adapter) await mem0Adapter.rememberFact(userId, fact, 'explicit');
      yield { type: 'text', content: `已记住：${fact}` };
      return;
    }

    // 记录用户消息到 Redis
    await this.memory.onMessage(sessionId, userId, 'user', message);

    // 流式 RAG 回答
    const traceId = this.langfuse.createTrace('chat', { query: message }, userId, sessionId);
    const stream = await this.rag.streamQuery(message, userId, sessionId, traceId || undefined);
    let fullAnswer = '';
    let sourcesSent = false;

    /** 从文本中提取 SOURCES 标记，返回 { sources, cleanText } */
    const extractSources = (text: string): { sources?: any[]; cleanText: string } => {
      const match = text.match(/<!-- SOURCES:(.*?)-->/);
      if (!match) return { cleanText: text };
      try {
        return { sources: JSON.parse(match[1]), cleanText: text.replace(/<!-- SOURCES:.*?-->/, '') };
      } catch {
        return { cleanText: text };
      }
    };

    // 跨 token 缓冲区：SOURCES 标记可能被 LangGraph 流分割到多个 chunk 中
    let pendingBuffer = '';
    const SOURCES_PREFIX = '<!-- SOURCES:';
    const SOURCES_SUFFIX = '-->';

    /** 处理缓冲区：检测完整 SOURCES 标记并剥离，yield 纯文本 */
    const flushBuffer = function* (): Generator<{ type: string; content?: string; sources?: any[] }> {
      if (!pendingBuffer || sourcesSent) {
        // 直接输出
        if (pendingBuffer) {
          fullAnswer += pendingBuffer;
          yield { type: 'text', content: pendingBuffer };
          pendingBuffer = '';
        }
        return;
      }

      const { sources, cleanText } = extractSources(pendingBuffer);
      if (sources) {
        yield { type: 'sources', sources };
        sourcesSent = true;
      }

      if (cleanText) {
        fullAnswer += cleanText;
        yield { type: 'text', content: cleanText };
      }
      pendingBuffer = '';
    };

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        if (typeof token !== 'string') continue;

        if (sourcesSent) {
          // 来源已发送，直接输出
          fullAnswer += token;
          yield { type: 'text', content: token };
        } else if (token.includes(SOURCES_PREFIX) || pendingBuffer.includes(SOURCES_PREFIX)) {
          // 可能包含 SOURCES 标记（含跨 token 情况）
          pendingBuffer += token;
          // 如果缓冲区包含完整标记（有前缀和闭合后缀），则处理
          if (pendingBuffer.includes(SOURCES_PREFIX) && pendingBuffer.includes(SOURCES_SUFFIX)) {
            yield* flushBuffer();
          }
          // 否则继续累积等待下一个 token（标记被截断）
        } else {
          // 普通 token，先 flush 缓冲区再输出
          if (pendingBuffer) yield* flushBuffer();
          fullAnswer += token;
          yield { type: 'text', content: token };
        }
      }

      if (event.data?.chunk?.finalAnswer) {
        const answer = String(event.data.chunk.finalAnswer);
        // 先清理可能残留的缓冲区
        if (pendingBuffer) {
          pendingBuffer += answer;
          yield* flushBuffer();
        } else if (!sourcesSent && answer.includes(SOURCES_PREFIX)) {
          const { sources, cleanText } = extractSources(answer);
          if (sources) {
            yield { type: 'sources', sources };
            sourcesSent = true;
          }
          if (cleanText) {
            fullAnswer = cleanText;
            yield { type: 'text', content: cleanText };
          }
        } else {
          const clean = answer.replace(/<!-- SOURCES:.*?-->/, '');
          if (clean && (!fullAnswer || clean.length > fullAnswer.length)) {
            fullAnswer = clean;
          }
          yield { type: 'text', content: clean };
        }
      }
    }

    // 流结束后 flush 残留缓冲区
    if (pendingBuffer) {
      const clean = pendingBuffer.replace(/<!-- SOURCES:.*?-->/, '');
      if (clean) {
        fullAnswer += clean;
        yield { type: 'text', content: clean };
      }
    }

    // 记录助手回答到 Redis
    if (fullAnswer) {
      await this.memory.onMessage(sessionId, userId, 'assistant', fullAnswer);
    }

    // flush LangFuse 上报
    if (traceId) {
      await this.langfuse.flush();
    }
  }
}
