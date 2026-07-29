import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document as MongoDoc } from 'mongoose';

/** Mongoose 文档类型 */
export type DocMarkdownDocument = DocMarkdown & MongoDoc;

/**
 * 文档 Markdown 正文存储 Schema
 * 存储在 MongoDB 中，通过 postgres_doc_id 关联回 Postgres
 */
@Schema({ timestamps: true })
export class DocMarkdown {
  /** 关联回 Postgres documents.id */
  @Prop({ required: true, index: true })
  postgres_doc_id!: string;

  /** 解析后的 Markdown 正文（含 RustFS 图片引用） */
  @Prop({ required: true, type: String })
  markdown_content!: string;

  /** 解析阶段提取的元数据（页码、作者等） */
  @Prop({ type: Object })
  raw_metadata!: Record<string, any>;
}

export const DocMarkdownSchema = SchemaFactory.createForClass(DocMarkdown);
