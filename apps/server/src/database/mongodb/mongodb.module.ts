import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import {
  DocMarkdown,
  DocMarkdownSchema,
} from './schemas/doc-markdown.schema';
import { MongoDBService } from './mongodb.service';

/**
 * MongoDB 数据库连接模块
 * 存储文档解析后的 Markdown 正文原文
 * 通过 postgres_doc_id 外键关联 Postgres 文档元信息
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get('MONGO_HOST', 'localhost');
        const port = config.get('MONGO_PORT', '27017');
        const user = config.get('MONGO_USER', 'admin');
        const pass = config.get('MONGO_PASSWORD', 'admin123');
        const db = config.get('MONGO_DB', 'knowledge_base');
        return {
          uri: `mongodb://${user}:${pass}@${host}:${port}/${db}?authSource=admin`,
        };
      },
    }),
    // 注册 DocMarkdown Schema
    MongooseModule.forFeature([
      { name: DocMarkdown.name, schema: DocMarkdownSchema },
    ]),
  ],
  providers: [MongoDBService],
  exports: [MongoDBService, MongooseModule],
})
export class MongoDBModule {}
