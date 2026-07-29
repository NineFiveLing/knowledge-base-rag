import { Injectable } from '@nestjs/common';
import { VectorService } from '../../database/postgres/vector.service';
import { ElasticsearchService } from '../../database/elasticsearch/es.service';
import { Neo4jService } from '../../database/neo4j/neo4j.service';
import { RedisService } from '../../database/redis/redis.service';
import { reciprocalRankFusion, ScoredResult } from './fusion/rrf';
import { rerank } from './fusion/reranker';

/** 混合检索选项 */
interface SearchOptions {
  useES?: boolean;
  useNeo4j?: boolean;
}

/** 检索返回结果 */
interface SearchResult {
  /** 是否命中（rerankScore >= 阈值） */
  hit: boolean;
  /** 降级标记：true 表示启用降级回复 */
  degraded: boolean;
  /** 降级原因代码 */
  degradeReason?: string;
  /** 降级时的用户友好提示语 */
  fallbackMessage?: string;
  /** 无命中时的人性化提示 */
  message?: string;
  /** 符合条件的检索结果 */
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
    private redis: RedisService,
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

  /** 带阈值检查的完整检索流程（带 Redis 缓存） */
  async searchWithThreshold(
    query: string,
    embedding: number[],
    deptFilter: any,
    options?: SearchOptions,
  ): Promise<SearchResult> {
    // 构建缓存 key：query 哈希 + deptFilter 哈希
    const queryHash = this.simpleHash(query);
    const deptHash = this.simpleHash(JSON.stringify(deptFilter || {}));
    const cacheKey = `${queryHash}:${deptHash}`;

    // 1. 查缓存
    const cached = await this.redis.getCachedSearch(cacheKey);
    if (cached) {
      return cached as SearchResult;
    }

    // 2. 混合检索 + RRF 融合
    const fused = await this.hybridSearch(query, embedding, deptFilter, options);
    // 3. Rerank 精排
    const reranked = await rerank(query, fused, 5);

    const MIN_SCORE = 0.5;
    const validResults = reranked.filter((r) => r.rerankScore >= MIN_SCORE);

    let result: SearchResult;

    if (validResults.length === 0) {
      result = {
        hit: false,
        degraded: true,
        degradeReason: 'no_result_above_threshold',
        fallbackMessage: '抱歉，未在知识库中找到与您问题相关的文档。请尝试换个问法。',
        message: '抱歉，未找到与该问题相关的文档。请尝试更换关键词或联系相关部门获取帮助。',
        results: [],
      };
    } else {
      result = {
        hit: true,
        degraded: false,
        results: validResults.map(({ rerankScore: _, ...rest }) => rest),
      };
    }

    // 4. 写入缓存（30 分钟 TTL，降级结果不缓存）
    if (result.hit) {
      await this.redis.cacheSearchResult(cacheKey, result as any);
    }

    return result;
  }

  /** 简单字符串哈希，用于构建缓存 key */
  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // 转为 32 位整数
    }
    return Math.abs(hash).toString(36);
  }
}
