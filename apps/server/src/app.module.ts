import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgresModule } from './database/postgres/postgres.module';
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
    // PostgreSQL 数据库连接（pgvector），全局可用
    PostgresModule,
    // 文档管理模块（注册 Document 实体）
    DocumentModule,
  ],
})
export class AppModule {}
