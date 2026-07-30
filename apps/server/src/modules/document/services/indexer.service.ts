import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ConfigService } from "@nestjs/config";
import { Document, DocumentStatus } from "../entities/document.entity";
import { ChunkerService, Chunk } from "./chunker.service";
import { ElasticsearchService } from "../../../database/elasticsearch/es.service";
import { Neo4jService } from "../../../database/neo4j/neo4j.service";
import { MongoDBService } from "../../../database/mongodb/mongodb.service";
import { VectorService } from "../../../database/postgres/vector.service";
import { withLLMRetry } from "../../../common/utils/retry.util";

/**
 * 三路索引服务（阶段二：异步分块 & 索引）
 * 从 MongoDB 取正文 → 分块 → 并行写入 PGVector/ES/Neo4j
 */
@Injectable()
export class IndexerService {
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private chunker: ChunkerService,
    private es: ElasticsearchService,
    private neo4j: Neo4jService,
    private mongo: MongoDBService,
    private config: ConfigService,
    private vectorService: VectorService,
  ) {
    this.llm = new ChatOpenAI({
      model: config.get("MODEL_NAME"),
      apiKey: config.get("ALIYUN_API_KEY"),
      configuration: { baseURL: config.get("ALIYUN_BASE_URL") },
    });
    this.embeddings = new OpenAIEmbeddings({
      modelName: this.config.get("EMBEDDING_MODEL", "text-embedding-v2"),
      openAIApiKey: this.config.get("ALIYUN_API_KEY"),
      configuration: { baseURL: this.config.get("ALIYUN_BASE_URL") },
    });
  }

  /** 执行阶段二索引 */
  async indexDocument(postgresDocId: string) {
    const doc = await this.docRepo.findOne({ where: { id: postgresDocId } });
    // 允许 PARSED 或 INDEXING（崩溃恢复）状态执行索引
    if (!doc || (doc.status !== DocumentStatus.PARSED && doc.status !== DocumentStatus.INDEXING)) return;

    doc.status = DocumentStatus.INDEXING;
    await this.docRepo.save(doc);

    try {
      // 1. 取 Markdown 正文
      const mongoDoc = await this.mongo.getMarkdown(postgresDocId);
      if (!mongoDoc) throw new Error("MongoDB 中未找到文档正文");

      // 2. 分块
      const chunks = await this.chunker.chunk(
        mongoDoc.markdown_content,
        postgresDocId,
      );

      // 3. 三路并行写入
      await Promise.all(chunks.map((chunk) => this.indexChunk(chunk, doc)));

      // 4. 更新状态
      doc.status = DocumentStatus.INDEXED;
      await this.docRepo.save(doc);
    } catch (error) {
      // 重置为 PARSED 以允许 BullMQ 重试
      doc.status = DocumentStatus.PARSED;
      await this.docRepo.save(doc);
      throw error;
    }
  }

  /** 单个分块的三路写入 */
  private async indexChunk(chunk: Chunk, doc: Document) {
    // 多模态增强：若 chunk 包含图片，生成 AI 图片描述并追加到 chunk_text
    // 描述文本将自动被后续的关键词提取、ES 索引和 embedding 向量化覆盖
    if (chunk.has_image) {
      try {
        const imageDesc = await this.generateImageDescription(chunk.chunk_text);
        if (imageDesc) {
          chunk.chunk_text = `${chunk.chunk_text}\n[图片描述: ${imageDesc}]`;
        }
      } catch (err) {
        // 降级：图片描述生成失败不影响正常索引流程
        console.warn(
          `图片描述生成失败: ${doc.id}/${chunk.chunk_id}`,
          (err as Error).message,
        );
      }
    }

    // Neo4j：创建 chunk 节点 + 关系
    await this.neo4j.createChunkRelation(chunk.postgres_doc_id, chunk.chunk_id);

    // 关键词提取（LLM）
    const keywords = await this.extractKeywords(chunk.chunk_text);

    // ES：全文索引
    await this.es.indexChunk({
      chunk_id: chunk.chunk_id,
      postgres_doc_id: chunk.postgres_doc_id,
      chunk_text: chunk.chunk_text,
      keywords,
      metadata: {
        title_level: chunk.title_level,
        has_image: chunk.has_image,
        has_table: chunk.has_table,
        chunk_index: chunk.chunk_index,
      },
      dept_id: doc.dept_id,
      visibility: doc.visibility,
    });

    // 实体关系提取（LLM + Neo4j）
    const entities = await this.extractEntities(chunk.chunk_text);
    for (const entity of entities) {
      await this.neo4j.createEntityRelation(
        entity.name,
        entity.type,
        chunk.chunk_id,
      );
    }
    // PGVector 向量写入：通过阿里云百炼 text-embedding-v2 生成 embedding
    const [embedding] = await this.embeddings.embedDocuments([
      chunk.chunk_text,
    ]);
    await this.vectorService.insertChunk(
      chunk.chunk_id,
      chunk.postgres_doc_id,
      chunk.chunk_text,
      embedding,
      {
        title_level: chunk.title_level,
        has_image: chunk.has_image,
        has_table: chunk.has_table,
        chunk_index: chunk.chunk_index,
      },
    );
  }

  /** LLM 提取关键词 */
  private async extractKeywords(text: string): Promise<string[]> {
    const res = await this.llm.invoke(
      `从以下文本中提取 5 个关键词，用逗号分隔：\n${text.slice(0, 500)}`,
    );
    return String(res.content)
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter(Boolean);
  }

  /** LLM 提取命名实体 */
  private async extractEntities(
    text: string,
  ): Promise<Array<{ name: string; type: string }>> {
    const res = await this.llm.invoke(
      `提取命名实体（name, type），type 为 person/organization/process/document/rule 之一。JSON 数组格式：\n${text.slice(0, 800)}`,
    );
    try {
      return JSON.parse(String(res.content));
    } catch {
      return [];
    }
  }

  /** 多模态：提取 Markdown 中的图片 URL，调用多模态 LLM 生成中文图片描述 */
  private async generateImageDescription(
    markdownText: string,
  ): Promise<string> {
    const imageUrls = [
      ...markdownText.matchAll(/!\[.*?\]\((https?:\/\/[^)]+)\)/g),
    ].map((m) => m[1]);

    if (imageUrls.length === 0) return "";

    const messages: any[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请用简洁中文描述以下图片的内容，一句话即可。",
          },
          ...imageUrls.slice(0, 3).map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ],
      },
    ];

    const response = await withLLMRetry(() => this.llm.invoke(messages));
    return typeof response.content === "string" ? response.content : "";
  }
}
