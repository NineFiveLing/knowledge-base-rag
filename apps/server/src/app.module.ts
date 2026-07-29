import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { SeedModule } from './database/seeds/seed.module';

/** 应用根模块 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // 数据库连接层
    PostgresModule, MongoDBModule, ElasticsearchModule,
    Neo4jModule, RedisModule, RustFSModule,
    // 种子数据
    SeedModule,
    // 业务模块
    AuthModule, UserModule, DocumentModule, SearchModule,
  ],
})
export class AppModule {}
