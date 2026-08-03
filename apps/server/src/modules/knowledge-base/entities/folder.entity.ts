import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';

/** 文件夹实体 —— 支持多级嵌套（parent_id 自引用） */
@Entity('folders')
@Unique(['kb_id', 'parent_id', 'name'])
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属知识库 */
  @Column({ type: 'uuid' })
  @Index()
  kb_id!: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'kb_id' })
  knowledgeBase!: KnowledgeBase;

  /** 父文件夹 ID，NULL 表示根目录下 */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  parent_id!: string | null;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent!: Folder | null;

  @Column({ length: 200 })
  name!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
