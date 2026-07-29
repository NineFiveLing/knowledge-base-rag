import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';
import { ConfigService } from '@nestjs/config';

/**
 * Neo4j 图数据库服务
 * 支持文档节点、分块关系、实体关系的创建与查询
 * 实体关系精确到 chunk 级别
 */
@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver!: Driver;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get('NEO4J_HOST', 'localhost');
    const port = Number(this.config.get('NEO4J_BOLT_PORT', '7687'));
    const user = this.config.get('NEO4J_USER', 'neo4j');
    const pass = this.config.get('NEO4J_PASSWORD', 'neo4j123456');
    this.driver = neo4j.driver(
      `bolt://${host}:${port}`,
      neo4j.auth.basic(user, pass),
    );
  }

  async onModuleDestroy() {
    await this.driver.close();
  }

  /** 执行 Cypher 语句 */
  async run(cypher: string, params?: Record<string, any>) {
    const session = this.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  /** 创建文档节点 */
  async createDocumentNode(postgresDocId: string, docName: string) {
    await this.run(
      `MERGE (d:Document {postgres_doc_id: $id}) SET d.name = $name`,
      { id: postgresDocId, name: docName },
    );
  }

  /** 创建文档与分块的关系 */
  async createChunkRelation(postgresDocId: string, chunkId: string) {
    await this.run(
      `MATCH (d:Document {postgres_doc_id: $docId})
       MERGE (c:Chunk {chunk_id: $chunkId, postgres_doc_id: $docId})
       MERGE (d)-[:HAS_CHUNK]->(c)`,
      { docId: postgresDocId, chunkId },
    );
  }

  /** 创建实体 → 分块的关系（chunk 级精准定位） */
  async createEntityRelation(
    entityName: string,
    entityType: string,
    chunkId: string,
  ) {
    await this.run(
      `MATCH (c:Chunk {chunk_id: $chunkId})
       MERGE (e:Entity {name: $name, type: $type})
       MERGE (e)-[:MENTIONED_IN]->(c)`,
      { chunkId, name: entityName, type: entityType },
    );
  }

  /** 查询实体及其关联的分块 */
  async queryEntities(query: string, maxHops: number = 2) {
    const result = await this.run(
      `MATCH (e:Entity)-[:MENTIONED_IN]->(c:Chunk)
       WHERE toLower(e.name) CONTAINS toLower($query)
       RETURN e.name AS entity, e.type AS type,
              c.chunk_id AS chunkId, c.postgres_doc_id AS docId
       LIMIT 10`,
      { query },
    );
    return result.records.map((r) => ({
      entity: r.get('entity'),
      type: r.get('type'),
      chunkId: r.get('chunkId'),
      docId: r.get('docId'),
    }));
  }
}
