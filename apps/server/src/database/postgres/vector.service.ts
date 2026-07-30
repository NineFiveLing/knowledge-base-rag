import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

/**
 * PGVector 向量存储服务
 * 管理 chunk 向量表，提供相似度检索
 */
@Injectable()
export class VectorService implements OnModuleInit {
  constructor(@InjectEntityManager() private em: EntityManager) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  /** 确保 chunk 向量表及 HNSW 索引存在 */
  private async ensureTable() {
    await this.em.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        postgres_doc_id UUID NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(postgres_doc_id);
    `);
  }

  /** 插入/更新一个 chunk 向量 */
  async insertChunk(
    chunkId: string,
    postgresDocId: string,
    chunkText: string,
    embedding: number[],
    metadata: any,
  ) {
    await this.em.query(
      `INSERT INTO chunks (chunk_id, postgres_doc_id, chunk_text, embedding, metadata)
       VALUES ($1, $2, $3, $4::vector, $5)
       ON CONFLICT (chunk_id) DO UPDATE SET embedding = $4::vector`,
      [chunkId, postgresDocId, chunkText, `[${embedding.join(',')}]`, JSON.stringify(metadata)],
    );
  }

  /** 按文档 ID 删除所有向量 chunk */
  async deleteByDocId(postgresDocId: string): Promise<void> {
    await this.em.query(
      'DELETE FROM chunks WHERE postgres_doc_id = $1',
      [postgresDocId],
    );
  }

  /** 余弦相似度检索（带权限过滤） */
  async similaritySearch(
    embedding: number[],
    topK: number = 10,
    deptFilter?: { deptIds: string[]; includePublic: boolean },
  ) {
    // 格式化为 PGVector 兼容的向量字符串: [0.1,0.2,...]
    const vectorStr = `[${embedding.join(',')}]`;
    const params: any[] = [vectorStr];
    let query = `
      SELECT c.chunk_id, c.postgres_doc_id, c.chunk_text,
             1 - (c.embedding <=> $1::vector) AS similarity
      FROM chunks c
      JOIN documents d ON c.postgres_doc_id = d.id
    `;

    if (deptFilter) {
      const conditions: string[] = [];
      if (deptFilter.includePublic) {
        conditions.push(`d.visibility = 'public'`);
      }
      if (deptFilter.deptIds?.length > 0) {
        params.push(deptFilter.deptIds);
        conditions.push(`d.dept_id = ANY($${params.length}::text[])`);
      }
      if (conditions.length > 0) {
        query += ` WHERE (${conditions.join(' OR ')})`;
      }
    }

    params.push(topK);
    query += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length}`;

    const rows = await this.em.query(query, params);
    return rows.map((r: any) => ({
      chunk_id: r.chunk_id,
      postgres_doc_id: r.postgres_doc_id,
      chunk_text: r.chunk_text,
      score: Number(r.similarity),
      source: 'pgvector' as const,
    }));
  }
}
