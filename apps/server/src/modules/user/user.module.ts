import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { Department } from './entities/department.entity';
import { DepartmentsController } from './departments.controller';

/** 用户与权限实体模块 */
@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Permission, Department])],
  controllers: [DepartmentsController],
  exports: [TypeOrmModule],
})
export class UserModule {}
