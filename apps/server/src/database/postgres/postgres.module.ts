import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

/**
 * PostgreSQL 数据库连接模块
 * 使用 pgvector/pgvector:pg16 镜像，内置向量扩展
 * 全局可用，通过 TypeORM 的 autoLoadEntities 自动注册实体
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: Number(config.get('POSTGRES_PORT', '5432')),
        username: config.get('POSTGRES_USER', 'postgres'),
        password: config.get('POSTGRES_PASSWORD', 'password'),
        database: config.get('POSTGRES_DB', 'ai_agent'),
        autoLoadEntities: true,   // 自动加载各模块注册的 @Entity
        synchronize: true,        // MVP 开发阶段自动同步表结构，生产环境改为 migration
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class PostgresModule {}
