import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from 'typeorm';
import { Permission } from './permission.entity';

/** 角色实体 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 20, default: 'custom' })
  type!: 'admin' | 'dept_admin' | 'custom';

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ default: false })
  is_system!: boolean;

  @ManyToMany(() => Permission)
  @JoinTable({ name: 'role_permissions' })
  permissions!: Permission[];
}
