import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, JoinTable, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Department } from './department.entity';
import { Role } from './role.entity';

/** 用户实体 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column()
  password_hash!: string;

  @Column()
  real_name!: string;

  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ unique: true, nullable: true })
  phone?: string;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dept_id' })
  department!: Department;

  @Column({ type: 'uuid', nullable: true })
  dept_id!: string;

  @ManyToMany(() => Role)
  @JoinTable({ name: 'user_roles' })
  roles!: Role[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  /** 密码最后变更时间（用于强制已登录用户重新登录） */
  @Column({ type: 'timestamp', nullable: true })
  password_changed_at?: Date;

  /** TTS 自动播放偏好 */
  @Column({ type: 'boolean', default: true })
  tts_auto_play!: boolean;
}
