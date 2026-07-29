import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DocMarkdown,
  DocMarkdownDocument,
} from './schemas/doc-markdown.schema';

/**
 * MongoDB 文档正文服务
 * 提供 Markdown 正文的读写操作，通过 postgres_doc_id 关联
 */
@Injectable()
export class MongoDBService {
  constructor(
    @InjectModel(DocMarkdown.name)
    private docMdModel: Model<DocMarkdownDocument>,
  ) {}

  /** 保存 Markdown 正文（阶段一解析完成后调用） */
  async saveMarkdown(
    postgresDocId: string,
    markdown: string,
    rawMetadata?: Record<string, any>,
  ) {
    return this.docMdModel.create({
      postgres_doc_id: postgresDocId,
      markdown_content: markdown,
      raw_metadata: rawMetadata,
    });
  }

  /** 根据 Postgres 文档 ID 获取 Markdown 正文 */
  async getMarkdown(postgresDocId: string) {
    return this.docMdModel
      .findOne({ postgres_doc_id: postgresDocId })
      .exec();
  }

  /** 更新 Markdown 正文（阶段一回填 postgres_doc_id 时使用） */
  async updateMarkdown(
    postgresDocId: string,
    markdown: string,
  ) {
    await this.docMdModel.updateOne(
      { postgres_doc_id: postgresDocId },
      { markdown_content: markdown },
    );
  }
}
