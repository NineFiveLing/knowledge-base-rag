import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { Document, DocumentStatus } from '../entities/document.entity';
import { ChunkerService, Chunk } from './chunker.service';
import { ElasticsearchService } from '../../../database/elasticsearch/es.service';
import { Neo4jService } from '../../../database/neo4j/neo4j.service';
import { MongoDBService } from '../../../database/mongodb/mongodb.service';

/**
 * 三路索引服务（阶段二：异步分块 & 索引）
 * 从 MongoDB 取正文 → 分块 → 并行写入 PGVector/ES/Neo4j
 */
@Injectable()
export class IndexerService {
  private llm: ChatOpenAI;

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private chunker: ChunkerService,
    private es: ElasticsearchService,
    private neo4j: Neo4jService,
    private mongo: MongoDBService,
    private config: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      model: 'deepseek-chat',
      apiKey: config.get('DEEPSEEK_API_KEY'),
      configuration: { baseURL: config.get('DEEPSEEK_BASE_URL') },
    });
  }

  /** 执行阶段二索引 */
  async indexDocument(postgresDocId: string) {
    const doc = await this.docRepo.findOne({ where: { id: postgresDocId } });
    if (!doc || doc.status !== DocumentStatus.PARSED) return;

    doc.status = DocumentStatus.INDEXING;
    await this.docRepo.save(doc);

    try {
      // 1. 取 Markdown 正文
      const mongoDoc = await this.mongo.getMarkdown(postgresDocId);
      if (!mongoDoc) throw new Error('MongoDB 中未找到文档正文');

      // 2. 分块
      const chunks = await this.chunker.chunk(mongoDoc.markdown_content, postgresDocId);

      // 3. 三路并行写入
      await Promise.all(chunks.map((chunk) => this.indexChunk(chunk, doc)));

      // 4. 更新状态
      doc.status = DocumentStatus.INDEXED;
      await this.docRepo.save(doc);
    } catch (error) {
      doc.status = DocumentStatus.FAILED;
      await this.docRepo.save(doc);
      throw error;
    }
  }

  /** 单个分块的三路写入 */
  private async indexChunk(chunk: Chunk, doc: Document) {
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
      await this.neo4j.createEntityRelation(entity.name, entity.type, chunk.chunk_id);
    }
    // PGVector 向量写入在 Task 19 中集成
  }

  /** LLM 提取关键词 */
  private async extractKeywords(text: string): Promise<string[]> {
    const res = await this.llm.invoke(
      `从以下文本中提取 5 个关键词，用逗号分隔：\n${text.slice(0, 500)}`,
    );
    return String(res.content).split(/[,，]/).map((k) => k.trim()).filter(Boolean);
  }

  /** LLM 提取命名实体 */
  private async extractEntities(text: string): Promise<Array<{ name: string; type: string }>> {
    const res = await this.llm.invoke(
      `提取命名实体（name, type），type 为 person/organization/process/document/rule 之一。JSON 数组格式：\n${text.slice(0, 800)}`,
    );
    try {
      return JSON.parse(String(res.content));
    } catch {
      return [];
    }
  }
}
