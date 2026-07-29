import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { createRAGGraph } from './graph';
import { createIntentClassifier } from './nodes/intent';
import { createAgentNode, createFollowUpAgentNode } from './nodes/agent';
import { createRetrievalNode } from './nodes/retrieval';
import { createGenerateNode } from './nodes/generate';
import { routeByIntent, decideNext } from './nodes/routes';
import { createVectorSearchTool, createESSearchTool, createNeo4jQueryTool } from './tools';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';
import { LangfuseService } from '../../common/observability/langfuse.service';

/** RAG 服务：组装完整的 LangGraph Agentic RAG 工作流 */
@Injectable()
export class RAGService implements OnModuleInit {
  private graph: any;
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor(
    private config: ConfigService,
    private search: SearchService,
    private memory: MemoryService,
    private langfuse: LangfuseService,
  ) {
    const baseURL = config.get('DEEPSEEK_BASE_URL');
    const apiKey = config.get('DEEPSEEK_API_KEY');

    this.llm = new ChatOpenAI({
      model: 'deepseek-chat',
      apiKey,
      configuration: { baseURL },
    });

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      configuration: { baseURL },
    });
  }

  async onModuleInit() {
    const vectorTool = createVectorSearchTool(async (q) =>
      JSON.stringify(await this.search.hybridSearch(q, await this.embed(q), {}, { useES: false, useNeo4j: false }).then((r) => r.slice(0, 5))),
    );
    const esTool = createESSearchTool(async (q) =>
      JSON.stringify(await this.search.hybridSearch(q, [], {}, { useES: true, useNeo4j: false }).then((r) => r.slice(0, 5))),
    );
    const neo4jTool = createNeo4jQueryTool(async (entity) =>
      JSON.stringify(await this.search.hybridSearch(entity, [], {}, { useES: false, useNeo4j: true }).then((r) => r.slice(0, 5))),
    );

    const agentFollowUpNode = createFollowUpAgentNode(this.llm, [vectorTool, esTool, neo4jTool], this.memory, this.langfuse);

    this.graph = createRAGGraph(
      createIntentClassifier(this.llm, this.langfuse),
      this.directAnswer.bind(this),
      this.simpleRetrieval.bind(this),
      createAgentNode(this.llm, [vectorTool, esTool, neo4jTool], this.memory, this.langfuse),
      agentFollowUpNode,
      createRetrievalNode(
        async (q) => JSON.stringify(await this.search.hybridSearch(q, await this.embed(q), {}, { useES: false, useNeo4j: false }).then((r) => r.slice(0, 5))),
        async (q) => JSON.stringify(await this.search.hybridSearch(q, [], {}, { useES: true, useNeo4j: false }).then((r) => r.slice(0, 5))),
        async (q) => JSON.stringify(await this.search.hybridSearch(q, [], {}, { useES: false, useNeo4j: true }).then((r) => r.slice(0, 5))),
        this.langfuse,
      ),
      createGenerateNode(this.llm, this.memory, this.langfuse),
      routeByIntent,
      decideNext,
    );
  }

  private async directAnswer(state: any) {
    const res = await this.llm.invoke(state.messages);
    return { finalAnswer: String(res.content), messages: [res] };
  }

  private async simpleRetrieval(state: any) {
    const userMsg = state.messages[state.messages.length - 1];
    const query = typeof userMsg.content === 'string' ? userMsg.content : '';
    const emb = await this.embed(query);
    const result = await this.search.searchWithThreshold(query, emb, {}, { useES: false, useNeo4j: false });

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
  async query(userMessage: string, userId: string, sessionId: string) {
    const result = await this.graph.invoke({
      messages: [new HumanMessage(userMessage)],
      userId,
      sessionId,
    });
    return result.finalAnswer;
  }

  /** 流式问答 */
  async streamQuery(userMessage: string, userId: string, sessionId: string, langfuseTraceId?: string) {
    return this.graph.streamEvents(
      { messages: [new HumanMessage(userMessage)], userId, sessionId, langfuseTraceId: langfuseTraceId || '' },
      { version: 'v2' },
    );
  }

  /** 获取文本 Embedding */
  async embed(text: string): Promise<number[]> {
    const res = await this.embeddings.embedQuery(text);
    return res;
  }
}
