import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Document } from './document.entity';

/**
 * 文档历史版本 —— 替换文件时归档旧版本
 * 纯存档用途，不参与检索
 */
@Entity('document_versions')
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  document_id!: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Column({ type: 'int' })
  version!: number;

  /** 当时的文件名 */
  @Column()
  name!: string;

  /** 旧文件在 RustFS 中的地址 */
  @Column()
  rustfs_file_url!: string;

  /** 文件大小（字节） */
  @Column({ type: 'bigint' })
  size!: number;

  /** 旧版 Markdown 正文在 MongoDB 中的 _id */
  @Column()
  mongo_doc_id!: string;

  @CreateDateColumn()
  created_at!: Date;
}
