import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ConfigService } from "@nestjs/config";
import { HumanMessage } from "@langchain/core/messages";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createRAGGraph } from "./graph";
import { createIntentClassifier } from "./nodes/intent";
import { createAgentNode, createFollowUpAgentNode } from "./nodes/agent";
import { createRetrievalNode } from "./nodes/retrieval";
import { createGenerateNode } from "./nodes/generate";
import { routeByIntent, decideNext } from "./nodes/routes";
import {
  createVectorSearchTool,
  createESSearchTool,
  createNeo4jQueryTool,
} from "./tools";
import { SearchService } from "../search/search.service";
import { MemoryService } from "../memory/memory.service";
import { Document } from "../document/entities/document.entity";
import { withLLMRetry } from "../../common/utils/retry.util";
import { CallbackHandler } from "@langfuse/langchain";

/** 剥离 finalAnswer 末尾的 <!-- SOURCES:... --> 标签 */
function stripSourcesTag(text: string): string {
  const idx = text.indexOf("<!-- SOURCES:");
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

/** RAG 服务：组装完整的 LangGraph Agentic RAG 工作流 */
@Injectable()
export class RAGService implements OnModuleInit {
  private readonly logger = new Logger("RAG:Service");
  private graph: any;
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor(
    private config: ConfigService,
    private search: SearchService,
    private memory: MemoryService,
    @InjectRepository(Document) private docRepo: Repository<Document>,
  ) {
    const apiKey = config.get("ALIYUN_API_KEY");
    const baseURL = config.get("ALIYUN_BASE_URL");

    this.llm = new ChatOpenAI({
      model: config.get("MODEL_NAME"),
      apiKey,
      configuration: { baseURL },
    });

    this.embeddings = new OpenAIEmbeddings({
      modelName: config.get("EMBEDDING_MODEL") || "text-embedding-v2",
      openAIApiKey: apiKey,
      configuration: { baseURL },
    });
  }

  async onModuleInit() {
    const vectorTool = createVectorSearchTool(async (q) =>
      JSON.stringify(
        await this.search
          .hybridSearch(
            q,
            await this.embed(q),
            undefined,
            { useES: false, useNeo4j: false },
          )
          .then((r) => r.slice(0, 5)),
      ),
    );
    const esTool = createESSearchTool(async (q) =>
      JSON.stringify(
        await this.search
          .hybridSearch(q, [], undefined, { useES: true, useNeo4j: false })
          .then((r) => r.slice(0, 5)),
      ),
    );
    const neo4jTool = createNeo4jQueryTool(async (entity) =>
      JSON.stringify(
        await this.search
          .hybridSearch(entity, [], undefined, { useES: false, useNeo4j: true })
          .then((r) => r.slice(0, 5)),
      ),
    );

    const agentFollowUpNode = createFollowUpAgentNode(
      this.llm,
      [vectorTool, esTool, neo4jTool],
      this.memory,
    );

    this.graph = createRAGGraph(
      createIntentClassifier(this.llm, this.memory),
      this.directAnswer.bind(this),
      this.simpleRetrieval.bind(this),
      createAgentNode(
        this.llm,
        [vectorTool, esTool, neo4jTool],
        this.memory,
      ),
      agentFollowUpNode,
      createRetrievalNode(
        async (q) =>
          JSON.stringify(
            await this.search
              .hybridSearch(
                q,
                await this.embed(q),
                undefined,
                { useES: false, useNeo4j: false },
              )
              .then((r) => r.slice(0, 5)),
          ),
        async (q) =>
          JSON.stringify(
            await this.search
              .hybridSearch(q, [], undefined, { useES: true, useNeo4j: false })
              .then((r) => r.slice(0, 5)),
          ),
        async (q) =>
          JSON.stringify(
            await this.search
              .hybridSearch(q, [], undefined, { useES: false, useNeo4j: true })
              .then((r) => r.slice(0, 5)),
          ),
      ),
      createGenerateNode(this.llm, this.memory, this.docRepo),
      routeByIntent,
      decideNext,
    );
  }

  private async directAnswer(state: any) {
    this.logger.log(`📌 [direct_answer] 进入 | 直接LLM回答（闲聊/记忆指令）`);
    const res = await withLLMRetry(() => this.llm.invoke(state.messages));
    this.logger.log(`📌 [direct_answer] 完成 | answer="${String(res.content).slice(0, 100)}"`);
    return { finalAnswer: String(res.content), messages: [res] };
  }

  private async simpleRetrieval(state: any) {
    const userMsg = state.messages[state.messages.length - 1];
    const query = typeof userMsg.content === "string" ? userMsg.content : "";
    const startTime = Date.now();
    this.logger.log(`📌 [simple_retrieval] 进入 | query="${query.slice(0, 60)}"`);

    const emb = await this.embed(query);
    const result = await this.search.searchWithThreshold(
      query,
      emb,
      undefined,
      { useES: false, useNeo4j: false },
    );

    const latencyMs = Date.now() - startTime;

    this.logger.log(
      `📌 [simple_retrieval] 完成 | 检索结果=${result.results.length}条 degraded=${result.degraded} latency=${latencyMs}ms`,
    );

    // 将完整 SearchResult 结构写入 state，保留 degraded/fallbackMessage
    return {
      retrievedChunks: result.results.map((r: any) => ({
        chunk_text: r.chunk_text,
        score: r.score,
        chunk_id: r.chunk_id,
        postgres_doc_id: r.postgres_doc_id,
      })),
      // 降级信息通过额外字段传递
      searchDegraded: result.degraded,
      searchFallbackMessage: result.fallbackMessage,
    };
  }

  /** 同步问答 */
  async query(
    userMessage: string,
    userId: string,
    sessionId: string,
    extraCallbacks?: CallbackHandler[],
  ): Promise<{ answer: string; traceId?: string }> {
    const langfuseHandler = this.createLangfuseHandler({ userId, sessionId });

    const callbacks = [...(extraCallbacks || [])];
    if (langfuseHandler) {
      callbacks.push(langfuseHandler);
    }

    const result = await this.graph.invoke(
      { messages: [new HumanMessage(userMessage)], userId, sessionId },
      { callbacks: callbacks.length > 0 ? callbacks : [] },
    );

    // 从外部传入的 handler 中获取 traceId（用于评测实验关联）
    const traceId = extraCallbacks?.[0]?.last_trace_id || undefined;

    return { answer: result.finalAnswer, traceId };
  }

  /** 评测专用：跑一次 RAG，额外返回检索上下文（供忠实度/可信度评分），并剥离 SOURCES 标签 */
  async queryWithContext(
    userMessage: string,
    userId: string,
    sessionId: string,
    extraCallbacks?: CallbackHandler[],
  ): Promise<{ answer: string; retrievedChunks: string[]; traceId?: string }> {
    const langfuseHandler = this.createLangfuseHandler({ userId, sessionId });

    const callbacks = [...(extraCallbacks || [])];
    if (langfuseHandler) {
      callbacks.push(langfuseHandler);
    }

    const result = await this.graph.invoke(
      { messages: [new HumanMessage(userMessage)], userId, sessionId },
      { callbacks: callbacks.length > 0 ? callbacks : [] },
    );

    const traceId = extraCallbacks?.[0]?.last_trace_id || undefined;
    return {
      answer: stripSourcesTag(result.finalAnswer),
      retrievedChunks: (result.retrievedChunks || []).map((c: any) => c.chunk_text),
      traceId,
    };
  }

  /** 流式问答 */
  async streamQuery(
    userMessage: string,
    userId: string,
    sessionId: string,
    conversationId?: string,
  ) {
    const langfuseHandler = this.createLangfuseHandler({ userId, sessionId, conversationId });

    return this.graph.streamEvents(
      {
        messages: [new HumanMessage(userMessage)],
        userId,
        sessionId,
      },
      {
        version: "v2",
        callbacks: langfuseHandler ? [langfuseHandler] : [],
      },
    );
  }

  /** 根据用户/会话上下文创建带标签的 Langfuse CallbackHandler；未配置密钥时静默降级 */
  private createLangfuseHandler(opts: {
    userId: string;
    sessionId: string;
    conversationId?: string;
  }): CallbackHandler | null {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) {
      return null;
    }

    const tags = [`userId:${opts.userId}`, `sessionId:${opts.sessionId}`];
    const metadata: Record<string, unknown> = {
      userId: opts.userId,
      sessionId: opts.sessionId,
    };
    if (opts.conversationId) {
      tags.push(`conversationId:${opts.conversationId}`);
      metadata.conversationId = opts.conversationId;
    }

    return new CallbackHandler({
      userId: opts.userId,
      sessionId: opts.sessionId,
      tags,
      traceMetadata: metadata,
    });
  }

  /** 获取文本 Embedding */
  async embed(text: string): Promise<number[]> {
    const res = await withLLMRetry(() => this.embeddings.embedQuery(text));
    return res;
  }
}
