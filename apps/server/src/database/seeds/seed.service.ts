import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../../modules/user/entities/role.entity';
import { Permission } from '../../modules/user/entities/permission.entity';
import { Department } from '../../modules/user/entities/department.entity';
import { User } from '../../modules/user/entities/user.entity';

/** 数据库种子服务：应用启动时自动初始化角色/权限/部门/管理员 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
    @InjectRepository(Department) private deptRepo: Repository<Department>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async onApplicationBootstrap() {
    await this.seed();
  }

  async seed() {
    // 1. 权限定义
    const perms = await this.permRepo.save([
      { resource: 'document', action: 'read' },
      { resource: 'document', action: 'create' },
      { resource: 'document', action: 'delete' },
      { resource: 'admin', action: 'manage' },
    ]);

    // 2. 角色定义
    const [adminRole, deptAdminRole, userRole] = await Promise.all([
      this.roleRepo.save({ name: '管理员', code: 'admin', permissions: perms }),
      this.roleRepo.save({ name: '部门管理员', code: 'dept_admin', permissions: perms.filter((p) => p.resource === 'document') }),
      this.roleRepo.save({ name: '普通员工', code: 'user', permissions: perms.filter((p) => p.action === 'read') }),
    ]);

    // 3. 部门定义
    const depts = await this.deptRepo.save([
      { name: '总经办' },
      { name: '研发部' },
      { name: '财务部' },
      { name: '人事部' },
    ]);

    // 4. 默认管理员（仅首次）
    const existing = await this.userRepo.findOne({ where: { username: 'admin' } });
    if (!existing) {
      await this.userRepo.save({
        username: 'admin',
        password_hash: await bcrypt.hash('admin123', 10),
        real_name: '系统管理员',
        dept_id: depts[0].id,
        roles: [adminRole],
      });
      console.log('✅ 种子数据已初始化：管理员账号 admin/admin123');
    }
  }
}
