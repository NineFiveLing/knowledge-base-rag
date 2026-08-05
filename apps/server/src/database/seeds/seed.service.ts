import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SeedService.name);

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
    try {
      // 0. 确保 roles 表有必要的列（兼容数据库重置场景）
      await this.roleRepo.manager.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
      `);
      await this.roleRepo.manager.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
      `);
      await this.roleRepo.manager.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'custom'
      `);
      await this.roleRepo.manager.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT
      `);
      await this.roleRepo.manager.query(`
        ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE
      `);
      // 确保 users 表有 password_changed_at 列（用于密码重置后强制重新登录）
      await this.userRepo.manager.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP
      `);
      await this.userRepo.manager.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS tts_auto_play BOOLEAN DEFAULT TRUE
      `);

      // 1. 权限定义（幂等：已存在的跳过，缺失的补充）
      const requiredPerms = [
        { resource: 'document', action: 'read', code: 'document:read', name: '查看文档', description: '可以查看文档内容' },
        { resource: 'document', action: 'create', code: 'document:create', name: '创建文档', description: '可以上传和创建文档' },
        { resource: 'document', action: 'delete', code: 'document:delete', name: '删除文档', description: '可以删除文档' },
        { resource: 'rbac', action: 'read', code: 'rbac:read', name: '查看权限', description: '可以查看角色和权限信息' },
        { resource: 'rbac', action: 'write', code: 'rbac:write', name: '管理权限', description: '可以创建、编辑、删除角色和权限' },
      ];
      const existingPerms = await this.permRepo.find();
      if (existingPerms.length === 0) {
        await this.permRepo.save(requiredPerms);
      } else {
        // 补充缺失的权限（兼容旧数据库）
        const existingCodes = new Set(existingPerms.map((p) => `${p.resource}:${p.action}`));
        const missing = requiredPerms.filter((p) => !existingCodes.has(`${p.resource}:${p.action}`));
        if (missing.length > 0) {
          await this.permRepo.save(missing);
          this.logger.log(`补充缺失权限: ${missing.map((p) => `${p.resource}:${p.action}`).join(', ')}`);
        }
      }
      const perms = await this.permRepo.find();

      // 2. 角色定义（skip if exists）
      const existingRoles = await this.roleRepo.find();
      if (existingRoles.length === 0) {
        await this.roleRepo.save([
          { name: '管理员', code: 'admin', type: 'admin', description: '系统管理员，拥有所有权限', is_system: true, permissions: perms },
          { name: '部门管理员', code: 'dept_admin', type: 'dept_admin', description: '部门文档管理员，可管理本部门文档', is_system: true, permissions: perms.filter((p) => p.resource === 'document') },
          { name: '普通员工', code: 'user', type: 'custom', description: '普通员工，只能查看文档', is_system: true, permissions: perms.filter((p) => p.action === 'read') },
        ]);
      }
      const roles = await this.roleRepo.find();
      const adminRole = roles.find((r) => r.code === 'admin');

      // 3. 部门定义（skip if exists）
      const existingDepts = await this.deptRepo.find();
      if (existingDepts.length === 0) {
        await this.deptRepo.save([
          { name: '总经办' },
          { name: '研发部' },
          { name: '财务部' },
          { name: '人事部' },
        ]);
      }
      const depts = await this.deptRepo.find();

      // 4. 默认管理员（总是确保 admin 角色存在）
      let adminUser = await this.userRepo.findOne({ where: { username: 'admin' }, relations: { roles: true } });
      if (!adminUser && adminRole && depts.length > 0) {
        adminUser = await this.userRepo.save({
          username: 'admin',
          password_hash: await bcrypt.hash('admin123', 10),
          real_name: '系统管理员',
          dept_id: depts[0].id,
          roles: [adminRole],
        });
        this.logger.log(`✅ 种子管理员已创建: admin/admin123, roles=[${adminUser.roles.map((r) => r.code).join(',')}]`);
      } else if (adminUser && adminRole) {
        const hasAdminRole = adminUser.roles.some((r) => r.code === 'admin');
        if (!hasAdminRole) {
          adminUser.roles = [...adminUser.roles, adminRole];
          await this.userRepo.save(adminUser);
          this.logger.log(`✅ 已为 admin 用户补充 admin 角色`);
        }
      }
    } catch (err) {
      this.logger.error('种子数据初始化失败', (err as Error).message);
    }
  }
}
