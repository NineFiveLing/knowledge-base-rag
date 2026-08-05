import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** 权限实体 */
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  code!: string;

  @Column()
  resource!: string;

  @Column()
  action!: string;

  @Column({ nullable: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}
