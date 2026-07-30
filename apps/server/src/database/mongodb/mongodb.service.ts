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

  /** 按文档 ID 删除 Markdown 正文 */
  async deleteByDocId(postgresDocId: string): Promise<void> {
    await this.docMdModel.deleteOne({ postgres_doc_id: postgresDocId });
  }

  /** 回填 postgres_doc_id 并更新正文（阶段一完成后使用） */
  async updateMarkdown(
    postgresDocId: string,
    markdown: string,
  ) {
    // 找到 pending 状态的文档并更新其 postgres_doc_id 和 markdown_content 为实际值
    await this.docMdModel.updateOne(
      { postgres_doc_id: 'pending' },
      { postgres_doc_id: postgresDocId, markdown_content: markdown },
    );
  }

  /** 清理所有 pending 状态（未完成上传）的残留文档 */
  async cleanPending(): Promise<void> {
    await this.docMdModel.deleteMany({ postgres_doc_id: 'pending' });
  }
}
