import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Folder } from '../../knowledge-base/entities/folder.entity';

/** 文档处理状态枚举 */
export enum DocumentStatus {
  UPLOADING = 'uploading',   // 上传中
  PARSING = 'parsing',       // 解析中
  PARSED = 'parsed',         // 解析完成（阶段一成功）
  INDEXING = 'indexing',     // 索引中（阶段二执行中）
  INDEXED = 'indexed',       // 索引完成
  FAILED = 'failed',         // 失败
  CANCELLED = 'cancelled',   // 用户主动取消上传
}

/** 文档可见性枚举 */
export enum DocumentVisibility {
  PUBLIC = 'public',         // 全公司可见
  DEPT = 'dept',             // 仅本部门可见
  PRIVATE = 'private',       // 仅创建者可见
}

/**
 * 文档元信息实体 —— 存储在 Postgres
 * 主键 id 作为全局唯一文档 ID，所有其他存储（MongoDB/ES/PGVector/Neo4j）
 * 通过 postgres_doc_id 外键关联到此表
 */
@Entity('documents')
@Index(['visibility', 'dept_id', 'uploader_id'])
@Index(['status'])
@Index(['created_at'])
@Index(['name'], { unique: false })  // ILIKE 关键词搜索，需配合 pg_trgm GIN 索引
export class Document {
  /** 全局唯一文档 ID（UUID），所有其他存储通过此 ID 关联 */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 原始文件名 */
  @Column()
  name!: string;

  /** 文件类型：pdf / word / excel / ppt / markdown / text / image / audio / video */
  @Column()
  type!: string;

  /** 文件大小（字节） */
  @Column({ type: 'bigint' })
  size!: number;

  /** 上传者 user.id */
  @Column()
  uploader_id!: string;

  /** 所属部门 departments.id */
  @Column({ nullable: true })
  dept_id!: string;

  /** 可见性级别 */
  @Column({ type: 'enum', enum: DocumentVisibility, default: DocumentVisibility.DEPT })
  visibility!: DocumentVisibility;

  /** MongoDB 中文档正文的 _id（字符串形式），用于回源取 Markdown */
  @Column()
  mongo_doc_id!: string;

  /** 原始文件在 RustFS 中的访问 URL */
  @Column()
  rustfs_file_url!: string;

  /** 处理状态 */
  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.UPLOADING })
  status!: DocumentStatus;

  /** 版本号，每次替换文件自增 */
  @Column({ type: 'int', default: 1 })
  version!: number;

  /** 所属文件夹 folders.id，可为 NULL（兼容旧数据），父文件夹删除时 SET NULL */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  folder_id!: string | null;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'folder_id' })
  folder!: Folder | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
