import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../../modules/user/entities/role.entity';
import { Permission } from '../../modules/user/entities/permission.entity';
import { Department } from '../../modules/user/entities/department.entity';
import { User } from '../../modules/user/entities/user.entity';
import { SeedService } from './seed.service';

/** 种子数据模块：应用启动时自动初始化 */
@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, Department, User])],
  providers: [SeedService],
})
export class SeedModule {}
