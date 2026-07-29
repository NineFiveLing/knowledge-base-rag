import { Module, Global } from '@nestjs/common';
import { Neo4jService } from './neo4j.service';

/**
 * Neo4j 图数据库模块
 * 全局可用，存储文档实体关系知识图谱
 */
@Global()
@Module({
  providers: [Neo4jService],
  exports: [Neo4jService],
})
export class Neo4jModule {}
