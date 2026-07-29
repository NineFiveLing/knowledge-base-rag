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
import { SeedModule } from './database/seeds/seed.module';

/**
 * 应用根模块
 */
@Module({
  imports: [
    // 全局环境变量配置
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // 数据库连接层（六大数据存储）
    PostgresModule, ElasticsearchModule, Neo4jModule, RedisModule,
    MongoDBModule, RustFSModule,
    // 种子数据（首次启动自动初始化角色/权限/部门）
    SeedModule,
    // 业务模块
    AuthModule, UserModule, DocumentModule,
  ],
})
export class AppModule {}
