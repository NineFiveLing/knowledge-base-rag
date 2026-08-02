import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RAGService } from '../rag/rag.service';
import { MemoryService } from '../memory/memory.service';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

/** 聊天服务：SSE 流式 + 记忆管理 + "记住xxx"处理 + 对话 CRUD */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private rag: RAGService,
    public memory: MemoryService,
    private langfuse: LangfuseService,
    @InjectRepository(Conversation) private convRepo: Repository<Conversation>,
    @InjectRepository(Message) private msgRepo: Repository<Message>,
  ) {}

  async *streamAnswer(message: string, userId: string, sessionId: string, conversationId?: string) {
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

    // 自动创建对话（若未提供）并立即返回 ID，避免后续消息归属到错误对话
    let resolvedConvId = conversationId;
    let isNewConv = false;
    if (!resolvedConvId) {
      const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
      const conv = await this.createConversation(userId, title);
      resolvedConvId = conv.id;
      isNewConv = true;
    }

    // 在发送 SSE 事件前持久化用户消息，确保前端切换会话后 fetch 能立即获取
    if (resolvedConvId) {
      await this.saveMessage(resolvedConvId, 'user', message).catch((err) => {
        this.logger.warn('持久化用户消息失败', (err as Error)?.message);
      });
    }

    // 先发送对话 ID 事件，前端据此绑定消息归属
    yield { type: 'conversation', conversationId: resolvedConvId, isNew: isNewConv };

    // 流式 RAG 回答
    const traceId = this.langfuse.createTrace('chat', { query: message }, userId, sessionId);
    const stream = await this.rag.streamQuery(message, userId, sessionId, traceId || undefined);
    let fullAnswer = '';
    let sourcesSent = false;

    try {
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

    // 仅 yield 最终答案节点的流式 token，避免 Agent ReAct 中间推理泄露
    const ANSWER_NODES = new Set(['generate_answer', 'direct_answer']);
    let currentNode: string | null = null;

    for await (const event of stream) {
      const eventName = event.event;
      const eventName2 = (event as any).name;

      // ── 追踪当前 graph 节点 ──
      if (eventName === 'on_chain_start' && eventName2) {
        const graphNodes = new Set(['intent_classifier', 'direct_answer', 'simple_retrieval', 'agent', 'agent_followup', 'retrieval_tools', 'generate_answer']);
        if (graphNodes.has(eventName2)) {
          currentNode = eventName2;
          if (ANSWER_NODES.has(eventName2)) {
            fullAnswer = '';
            pendingBuffer = '';
          }
        }
      }

      // ── 流式 token：仅 yield 来自最终答案节点的 token ──
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        if (typeof token !== 'string') continue;

        // 非最终答案节点 → 丢弃 token
        if (!currentNode || !ANSWER_NODES.has(currentNode)) continue;

        if (sourcesSent) {
          fullAnswer += token;
          yield { type: 'text', content: token };
        } else if (token.includes(SOURCES_PREFIX) || pendingBuffer.includes(SOURCES_PREFIX)) {
          pendingBuffer += token;
          if (pendingBuffer.includes(SOURCES_PREFIX) && pendingBuffer.includes(SOURCES_SUFFIX)) {
            yield* flushBuffer();
          }
        } else {
          if (pendingBuffer) yield* flushBuffer();
          fullAnswer += token;
          yield { type: 'text', content: token };
        }
      }

      // ── 节点输出：仅提取 SOURCES 和兜底 fullAnswer ──
      const output = (event.data as any)?.output;
      if (output?.finalAnswer && typeof output.finalAnswer === 'string') {
        const answer = output.finalAnswer;
        if (!sourcesSent && answer.includes(SOURCES_PREFIX)) {
          const { sources } = extractSources(answer);
          if (sources) {
            yield { type: 'sources', sources };
            sourcesSent = true;
          }
        }
        if (fullAnswer.length === 0) {
          if (pendingBuffer) {
            pendingBuffer += answer;
            yield* flushBuffer();
          } else {
            const clean = answer.replace(/<!-- SOURCES:.*?-->/, '');
            if (clean) {
              fullAnswer = clean;
              yield { type: 'text', content: clean };
            }
          }
        }
        pendingBuffer = '';
      }

      // ── 非流式 LLM 兜底：仅最终答案节点 ──
      if (event.event === 'on_chat_model_end' && event.data?.output?.content) {
        const text = String(event.data.output.content);
        if (text && ANSWER_NODES.has(currentNode || '') && fullAnswer.length === 0) {
          const clean = text.replace(/<!-- SOURCES:.*?-->/, '');
          if (clean) {
            fullAnswer = clean;
            yield { type: 'text', content: clean };
          }
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

    // 流结束后持久化 assistant 消息到 Postgres（user 消息已在流开始前持久化）
    if (resolvedConvId && fullAnswer) {
      await this.saveMessage(resolvedConvId, 'assistant', fullAnswer).catch((err) => {
        this.logger.warn('持久化助手消息失败', (err as Error)?.message);
      });
    }

    } finally {
      // flush LangFuse 上报（异常退出时也确保 flush）
      if (traceId) {
        await this.langfuse.flush();
      }
    }
  }

  /** 新建对话 */
  async createConversation(userId: string, title?: string) {
    const conv = this.convRepo.create({ user_id: userId, title: title || '新对话' });
    return this.convRepo.save(conv);
  }

  /** 当前用户的对话列表 */
  async listConversations(userId: string, page = 1, pageSize = 20) {
    const [items, total] = await this.convRepo.findAndCount({
      where: { user_id: userId },
      order: { updated_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /** 获取对话消息列表 */
  async getMessages(conversationId: string, userId: string) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
    if (!conv) throw new Error('对话不存在');
    const messages = await this.msgRepo.find({
      where: { conversation_id: conversationId },
      order: { created_at: 'ASC' },
    });
    return { conversation: conv, messages };
  }

  /** 删除对话（级联删除关联消息） */
  async deleteConversation(conversationId: string, userId: string) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
    if (!conv) throw new Error('对话不存在');
    await this.convRepo.remove(conv);
    return { success: true };
  }

  /** 编辑对话标题 */
  async updateConversation(conversationId: string, userId: string, title: string) {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
    if (!conv) throw new Error('对话不存在');
    conv.title = title;
    return this.convRepo.save(conv);
  }

  /** 持久化一条消息 */
  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    sources?: Array<{ index: number; docId: string; chunkId: string; docName: string }>,
  ) {
    const msg = this.msgRepo.create({ conversation_id: conversationId, role, content, sources });
    // 更新对话的 updated_at
    await this.convRepo.update(conversationId, { updated_at: new Date() });
    return this.msgRepo.save(msg);
  }
}
