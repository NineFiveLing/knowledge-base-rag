import { Injectable, UnauthorizedException, NotFoundException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../user/entities/user.entity';
import { Role } from '../user/entities/role.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** 认证服务：注册、登录、JWT 签发 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    private jwtService: JwtService,
    private dataSource: DataSource,
  ) {}

  /** 用户注册：默认分配 user 角色 */
  async register(dto: RegisterDto) {
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
    await this.userRepo.save(user);
    return { id: user.id, username: user.username };
  }

  /** 登录：验证用户名密码，返回 JWT + 用户信息（含角色和权限） */
  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
      relations: { roles: true, department: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('密码不正确');

    const userRoles = user.roles.map((r) => r.name || r.code);
    const permissions = await this.getUserPermissions(user.id);
    this.logger.log(`🔑 登录: ${user.username} rawRolesCount=${user.roles.length} roles=${JSON.stringify(userRoles)} permissionsCount=${permissions.length}`);

    const payload = {
      sub: user.id,
      username: user.username,
      dept_id: user.dept_id,
      roles: userRoles,
      permissions,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        email: user.email,
        phone: user.phone,
        dept_id: user.dept_id,
        department: user.department ? { id: user.department.id, name: user.department.name } : null,
        roles: userRoles,
        permissions,
        tts_auto_play: user.tts_auto_play ?? true,
      },
    };
  }

  /** 用户自行修改密码 */
  async changePassword(userId: string, dto: { oldPassword: string; newPassword: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('用户不存在');
    }

    // 校验旧密码
    const valid = await bcrypt.compare(dto.oldPassword, user.password_hash);
    if (!valid) {
      throw new Error('密码不正确');
    }

    // 新旧密码不能相同
    const same = await bcrypt.compare(dto.newPassword, user.password_hash);
    if (same) {
      throw new Error('新密码不能与原密码相同');
    }

    user.password_hash = await bcrypt.hash(dto.newPassword, 10);
    user.password_changed_at = new Date();
    await this.userRepo.save(user);

    return { success: true };
  }

  /** 更新当前用户个人设置（TTS 自动播放等） */
  async updateProfile(userId: string, dto: { tts_auto_play?: boolean }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('用户不存在');
    }
    if (dto.tts_auto_play !== undefined) {
      user.tts_auto_play = dto.tts_auto_play;
    }
    await this.userRepo.save(user);
    return { success: true, tts_auto_play: user.tts_auto_play };
  }

  /** 查询用户所有角色聚合的权限码列表 */
  private async getUserPermissions(userId: string): Promise<string[]> {
    const result = await this.dataSource.query(`
      SELECT DISTINCT CONCAT(p.resource, ':', p.action) AS code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp."permissionsId"
      JOIN user_roles ur ON rp."rolesId" = ur."rolesId"
      WHERE ur."usersId" = $1
    `, [userId]);
    return result.map((r: any) => r.code);
  }
}
