import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, JoinTable, CreateDateColumn } from 'typeorm';
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

  @ManyToOne(() => Department, { nullable: true })
  department!: Department;

  @Column({ nullable: true })
  dept_id!: string;

  @ManyToMany(() => Role)
  @JoinTable({ name: 'user_roles' })
  roles!: Role[];

  @CreateDateColumn()
  created_at!: Date;
}
