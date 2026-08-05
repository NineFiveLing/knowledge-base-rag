import { Controller, Get, Post, Patch, Body, Param, UseGuards, Query, Delete } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { RequirePermission } from '../../common/guards/permission.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Department } from './entities/department.entity';
import { UpdateUserDto, CreateUserDto, ResetPasswordDto, ChangePasswordDto, UpdateUserRolesDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';

/** 用户管理控制器 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Department) private deptRepo: Repository<Department>,
  ) {}

  /** 获取用户列表 */
  @Get()
  @RequirePermission('rbac:read')
  async list(@Query('keyword') keyword?: string) {
    const where = keyword
      ? [
          { username: `${keyword}` },
          { real_name: `${keyword}` },
        ]
      : {};

    const users = await this.userRepo.find({
      where,
      relations: { roles: true, department: true },
      select: {
        id: true,
        username: true,
        real_name: true,
        email: true,
        phone: true,
        dept_id: true,
        created_at: true,
        updated_at: true,
        roles: { id: true, name: true, code: true, type: true },
        department: { id: true, name: true },
      },
      order: { created_at: 'DESC' },
    });

    return users.map(u => ({
      id: u.id,
      username: u.username,
      real_name: u.real_name,
      email: u.email,
      phone: u.phone,
      dept_id: u.dept_id,
      department: u.department,
      roles: u.roles,
      created_at: u.created_at,
      updated_at: u.updated_at,
    }));
  }

  /** 创建用户 */
  @Post()
  @RequirePermission('rbac:write')
  async create(@Body() dto: CreateUserDto) {
    const existing = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new Error('用户名已存在');
    }

    // 检查邮箱是否已被使用
    if (dto.email) {
      const existingEmail = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existingEmail) {
        throw new Error('该邮箱已被注册');
      }
    }

    // 检查手机号是否已被使用
    if (dto.phone) {
      const existingPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
      if (existingPhone) {
        throw new Error('该手机号已被使用');
      }
    }

    const password_hash = await bcrypt.hash(dto.password, 10);
    const defaultRole = await this.roleRepo.findOne({ where: { code: 'user' } });

    const user = this.userRepo.create({
      username: dto.username,
      password_hash,
      real_name: dto.real_name,
      email: dto.email,
      phone: dto.phone,
      dept_id: dto.dept_id,
      roles: defaultRole ? [defaultRole] : [],
    });

    const saved = await this.userRepo.save(user);

    if (dto.roleIds && dto.roleIds.length > 0) {
      const roles = await this.roleRepo.find({ where: { id: In(dto.roleIds) } });
      saved.roles = roles;
      await this.userRepo.save(saved);
    }

    return { id: saved.id, username: saved.username };
  }

  /** 获取单个用户详情 */
  @Get(':id')
  @RequirePermission('rbac:read')
  async get(@Param('id') id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { roles: true, department: true },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      real_name: user.real_name,
      email: user.email,
      phone: user.phone,
      dept_id: user.dept_id,
      department: user.department,
      roles: user.roles,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  /** 更新用户信息 */
  @Patch(':id')
  @RequirePermission('rbac:write')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new Error('用户不存在');
    }

    // 如果修改用户名，检查是否重复
    if (dto.username && dto.username !== user.username) {
      const existing = await this.userRepo.findOne({ where: { username: dto.username } });
      if (existing) {
        throw new Error('用户名已存在');
      }
      user.username = dto.username;
    }

    // 如果修改邮箱，检查是否重复
    if (dto.email && dto.email !== user.email) {
      const existingEmail = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existingEmail) {
        throw new Error('该邮箱已被其他用户使用');
      }
      user.email = dto.email;
    }

    // 如果修改手机号，检查是否重复
    if (dto.phone && dto.phone !== user.phone) {
      const existingPhone = await this.userRepo.findOne({ where: { phone: dto.phone } });
      if (existingPhone) {
        throw new Error('该手机号已被其他用户使用');
      }
      user.phone = dto.phone;
    }

    if (dto.real_name) user.real_name = dto.real_name;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.dept_id !== undefined) user.dept_id = dto.dept_id;

    await this.userRepo.save(user);

    // 重新查询以获取关联数据
    const updated = await this.userRepo.findOne({
      where: { id },
      relations: { roles: true, department: true },
    });

    if (!updated) {
      return { id: user.id, username: user.username, real_name: user.real_name };
    }

    return {
      id: updated.id,
      username: updated.username,
      real_name: updated.real_name,
      email: updated.email,
      phone: updated.phone,
      dept_id: updated.dept_id,
      department: updated.department ? { id: updated.department.id, name: updated.department.name } : null,
      roles: updated.roles.map(r => ({ id: r.id, name: r.name, code: r.code, type: r.type })),
    };
  }

  /** 管理员重置用户密码 */
  @Patch(':id/password')
  @RequirePermission('rbac:write')
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new Error('用户不存在');
    }

    user.password_hash = await bcrypt.hash(dto.newPassword, 10);
    user.password_changed_at = new Date();
    await this.userRepo.save(user);

    return { success: true };
  }

  /** 当前用户自行修改密码 */
  @Patch('auth/password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() currentUser: any, @Body() dto: ChangePasswordDto) {
    const user = await this.userRepo.findOne({ where: { id: currentUser.id } });
    if (!user) {
      throw new Error('用户不存在');
    }

    // 校验旧密码
    const valid = await bcrypt.compare(dto.oldPassword, user.password_hash);
    if (!valid) {
      throw new Error('原密码不正确');
    }

    // 新旧密码不能相同
    const same = await bcrypt.compare(dto.newPassword, user.password_hash);
    if (same) {
      throw new Error('新密码不能与原密码相同');
    }

    user.password_hash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);

    return { success: true };
  }

  /** 为用户分配角色 */
  @Patch(':id/roles')
  @RequirePermission('rbac:write')
  async assignRoles(@Param('id') id: string, @Body() dto: UpdateUserRolesDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new Error('用户不存在');
    }

    if (dto.roleIds.length > 0) {
      const roles = await this.roleRepo.find({
        where: { id: In(dto.roleIds) },
      });
      if (roles.length !== dto.roleIds.length) {
        throw new Error('部分角色不存在');
      }
      user.roles = roles;
    } else {
      user.roles = [];
    }

    await this.userRepo.save(user);

    return { success: true, roles: user.roles };
  }

  /** 获取用户的角色列表 */
  @Get(':id/roles')
  @RequirePermission('rbac:read')
  async getUserRoles(@Param('id') id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { roles: true },
    });

    if (!user) {
      return [];
    }

    return user.roles.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      type: r.type,
    }));
  }
}
