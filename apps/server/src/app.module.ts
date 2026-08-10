import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PostgresModule } from './database/postgres/postgres.module';
import { MongoDBModule } from './database/mongodb/mongodb.module';
import { ElasticsearchModule } from './database/elasticsearch/es.module';
import { Neo4jModule } from './database/neo4j/neo4j.module';
import { RedisModule } from './database/redis/redis.module';
import { RustFSModule } from './database/rustfs/rustfs.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { DocumentModule } from './modules/document/document.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/kb.module';
import { SearchModule } from './modules/search/search.module';
import { MemoryModule } from './modules/memory/memory.module';
import { RAGModule } from './modules/rag/rag.module';
import { ChatModule } from './modules/chat/chat.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { EvalModule } from './modules/eval/eval.module';
import { SeedModule } from './database/seeds/seed.module';
import { PermissionGuard } from './common/guards/permission.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

/** 应用根模块 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(__dirname, '..', '..', '..', '.env') }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PostgresModule, MongoDBModule, ElasticsearchModule,
    Neo4jModule, RedisModule, RustFSModule,
    SeedModule,
    AuthModule, UserModule, DocumentModule, KnowledgeBaseModule,
    SearchModule, MemoryModule,
    RAGModule, ChatModule, RbacModule, AnalyticsModule,
    EvalModule,  // 导入 EvalModule 以启用 CLI 命令
  ],
  providers: [
    { provide: 'APP_GUARD', useClass: PermissionGuard },
  ],
})
export class AppModule {}
