import { Injectable } from '@nestjs/common';
import { VectorService } from '../../database/postgres/vector.service';
import { ElasticsearchService } from '../../database/elasticsearch/es.service';
import { Neo4jService } from '../../database/neo4j/neo4j.service';
import { reciprocalRankFusion, ScoredResult } from './fusion/rrf';
import { rerank } from './fusion/reranker';

/** 混合检索选项 */
interface SearchOptions {
  useES?: boolean;
  useNeo4j?: boolean;
}

/** 检索返回结果 */
interface SearchResult {
  hit: boolean;
  message?: string;
  results: Array<{
    chunk_id: string;
    postgres_doc_id: string;
    chunk_text: string;
    score: number;
  }>;
}

/**
 * 混合检索服务
 * 支持单路/双路/三路并行检索，RRF 融合 + Rerank 精排 + 阈值降级
 */
@Injectable()
export class SearchService {
  constructor(
    private vector: VectorService,
    private es: ElasticsearchService,
    private neo4j: Neo4jService,
  ) {}

  /** 多路混合检索 */
  async hybridSearch(
    query: string,
    queryEmbedding: number[],
    deptFilter: any,
    options: SearchOptions = {},
  ): Promise<ScoredResult[]> {
    const { useES = true, useNeo4j = true } = options;

    const fetchers: Promise<ScoredResult[]>[] = [
      // PGVector：始终启用
      this.vector
        .similaritySearch(queryEmbedding, 10, deptFilter)
        .then((rows) =>
          rows.map((r: any) => ({
            chunk_id: r.chunk_id,
            postgres_doc_id: r.postgres_doc_id,
            chunk_text: r.chunk_text,
            score: r.score,
            source: 'pgvector' as const,
          })),
        ),
    ];

    // ES：全文检索
    if (useES) {
      fetchers.push(
        this.es
          .search(query, deptFilter, 10)
          .then((hits) =>
            hits.map((h) => ({
              chunk_id: h.chunk_id,
              postgres_doc_id: h.postgres_doc_id,
              chunk_text: h.chunk_text,
              score: h.score,
              source: 'es' as const,
            })),
          ),
      );
    }

    // Neo4j：图谱查询
    if (useNeo4j) {
      fetchers.push(
        this.neo4j.queryEntities(query, 2).then((rows) =>
          rows.map((r) => ({
            chunk_id: r.chunkId,
            postgres_doc_id: r.docId,
            chunk_text: '',
            score: 0.5,
            source: 'neo4j' as const,
          })),
        ),
      );
    }

    const results = await Promise.all(fetchers);
    return reciprocalRankFusion(results);
  }

  /** 带阈值检查的完整检索流程 */
  async searchWithThreshold(
    query: string,
    embedding: number[],
    deptFilter: any,
  ): Promise<SearchResult> {
    const fused = await this.hybridSearch(query, embedding, deptFilter);
    const reranked = await rerank(query, fused, 5);

    const MIN_SCORE = 0.5;
    const validResults = reranked.filter((r) => r.rerankScore >= MIN_SCORE);

    if (validResults.length === 0) {
      return {
        hit: false,
        message: '抱歉，未找到与该问题相关的文档。请尝试更换关键词或联系相关部门获取帮助。',
        results: [],
      };
    }

    return {
      hit: true,
      results: validResults.map(({ rerankScore: _, ...rest }) => rest),
    };
  }
}
