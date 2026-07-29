import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';

/** 部门实体（支持层级） */
@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ nullable: true })
  parent_id!: string;

  @ManyToOne(() => Department, { nullable: true })
  parent!: Department;

  @OneToMany(() => Department, (d) => d.parent)
  children!: Department[];
}
