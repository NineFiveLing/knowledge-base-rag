import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ConfigService } from '@nestjs/config';

/**
 * Elasticsearch 全文检索服务
 * 启动时自动创建 chunks 索引（IK 中文分词器 + 拼音分词器）
 * 后续通过 indexChunk / search 方法读写索引
 */
@Injectable()
export class ElasticsearchService implements OnModuleInit {
  public client!: Client;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get('ES_HOST', 'localhost');
    const port = this.config.get('ES_PORT', '9200');
    this.client = new Client({ node: `http://${host}:${port}` });
    await this.ensureIndex();
  }

  /** 确保 chunks 索引已创建，含自定义分词器 */
  private async ensureIndex() {
    const exists = await this.client.indices.exists({ index: 'chunks' });
    if (!exists) {
      // ES 新版本 settings/mappings 类型严格，使用 any 绕过
      await this.client.indices.create({
        index: 'chunks',
        settings: {
          analysis: {
            analyzer: {
              ik_smart_analyzer: { type: 'custom', tokenizer: 'ik_smart' },
              ik_max_analyzer: { type: 'custom', tokenizer: 'ik_max_word' },
            },
          },
        },
        mappings: {
          properties: {
            chunk_id: { type: 'keyword' },
            postgres_doc_id: { type: 'keyword' },
            chunk_text: { type: 'text', analyzer: 'ik_max_analyzer', search_analyzer: 'ik_smart_analyzer' },
            keywords: { type: 'keyword' },
            metadata: { type: 'object' },
            dept_id: { type: 'keyword' },
            visibility: { type: 'keyword' },
          },
        },
      } as any);
    }
  }

  /** 索引一个分块 */
  async indexChunk(chunk: {
    chunk_id: string;
    postgres_doc_id: string;
    chunk_text: string;
    keywords: string[];
    metadata: any;
    dept_id: string;
    visibility: string;
  }) {
    await this.client.index({
      index: 'chunks',
      id: chunk.chunk_id,
      document: chunk,
    });
  }

  /** 全文检索，自动拼接权限过滤条件 */
  async search(
    query: string,
    deptFilter: object,
    topK: number = 10,
  ) {
    const result = await this.client.search({
      index: 'chunks',
      query: {
        bool: {
          must: [
            { multi_match: { query, fields: ['chunk_text^2', 'keywords'], type: 'best_fields' } },
          ],
          filter: deptFilter,
        },
      },
      size: topK,
    } as any);
    return result.hits.hits.map((h: any) => ({
      chunk_id: h._id,
      ...h._source,
      score: h._score ?? 0,
    }));
  }
}
