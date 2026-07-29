import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgresModule } from './database/postgres/postgres.module';
import { MongoDBModule } from './database/mongodb/mongodb.module';
import { ElasticsearchModule } from './database/elasticsearch/es.module';
import { Neo4jModule } from './database/neo4j/neo4j.module';
import { RedisModule } from './database/redis/redis.module';
import { RustFSModule } from './database/rustfs/rustfs.module';
import { DocumentModule } from './modules/document/document.module';

/**
 * 应用根模块
 * 负责全局配置导入，后续各业务模块在此注册
 */
@Module({
  imports: [
    // 全局环境变量配置：.env 文件自动加载，全模块可用
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // 数据库连接层（六大数据存储）
    PostgresModule,        // PostgreSQL（元信息 + pgvector 向量）
    MongoDBModule,        // MongoDB（Markdown 正文原文）
    ElasticsearchModule,  // Elasticsearch（全文检索 + IK 分词）
    Neo4jModule,          // Neo4j（知识图谱 + 实体关系）
    RedisModule,         // Redis（会话短期记忆 + 检索缓存）
    RustFSModule,        // RustFS（对象存储：原文件 + 图片/附件）
    // 业务模块
    DocumentModule,      // 文档管理（注册 Document 实体）
  ],
})
export class AppModule {}
