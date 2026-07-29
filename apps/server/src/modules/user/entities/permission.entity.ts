import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** 权限实体 */
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  resource!: string;

  @Column()
  action!: string;
}
