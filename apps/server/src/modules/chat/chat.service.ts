import { Injectable } from '@nestjs/common';
import { RAGService } from '../rag/rag.service';
import { MemoryService } from '../memory/memory.service';

/** 聊天服务：SSE 流式 + 记忆管理 + "记住xxx"处理 */
@Injectable()
export class ChatService {
  constructor(
    private rag: RAGService,
    public memory: MemoryService,
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
    const stream = await this.rag.streamQuery(message, userId, sessionId);
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

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        if (typeof token !== 'string') continue;

        // 检测来源标记（含跨 token 缓冲区）
        if (!sourcesSent && token.includes('<!-- SOURCES:')) {
          const { sources, cleanText } = extractSources(token);
          if (sources) {
            yield { type: 'sources', sources };
            sourcesSent = true;
          }
          if (cleanText) {
            fullAnswer += cleanText;
            yield { type: 'text', content: cleanText };
          }
        } else {
          fullAnswer += token;
          yield { type: 'text', content: token };
        }
      }

      if (event.data?.chunk?.finalAnswer) {
        const answer = String(event.data.chunk.finalAnswer);
        if (!sourcesSent && answer.includes('<!-- SOURCES:')) {
          const { sources } = extractSources(answer);
          if (sources) {
            yield { type: 'sources', sources };
            sourcesSent = true;
          }
        }
        const clean = answer.replace(/<!-- SOURCES:.*?-->/, '');
        // 仅在 token 流未覆盖时回退使用 finalAnswer
        if (clean && (!fullAnswer || clean.length > fullAnswer.length)) {
          fullAnswer = clean;
        }
        yield { type: 'text', content: clean };
      }
    }

    // 记录助手回答到 Redis
    if (fullAnswer) {
      await this.memory.onMessage(sessionId, userId, 'assistant', fullAnswer);
    }
  }
}
