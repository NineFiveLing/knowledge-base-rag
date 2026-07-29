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
import { SearchModule } from './modules/search/search.module';
import { MemoryModule } from './modules/memory/memory.module';
import { RAGModule } from './modules/rag/rag.module';
import { ChatModule } from './modules/chat/chat.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SeedModule } from './database/seeds/seed.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { PermissionGuard } from './common/guards/permission.guard';

/** 应用根模块 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PostgresModule, MongoDBModule, ElasticsearchModule,
    Neo4jModule, RedisModule, RustFSModule,
    SeedModule,
    AuthModule, UserModule, DocumentModule, SearchModule, MemoryModule,
    RAGModule, ChatModule, RbacModule, AnalyticsModule, ObservabilityModule,
  ],
  providers: [
    { provide: 'APP_GUARD', useClass: PermissionGuard },
  ],
})
export class AppModule {}
