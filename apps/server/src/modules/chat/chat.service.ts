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

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        fullAnswer += token;
        yield { type: 'text', content: token };
      }

      if (event.data?.chunk?.finalAnswer) {
        fullAnswer = event.data.chunk.finalAnswer;
        yield { type: 'text', content: fullAnswer };
      }
    }

    // 记录助手回答到 Redis
    if (fullAnswer) {
      await this.memory.onMessage(sessionId, userId, 'assistant', fullAnswer);
    }
  }
}
