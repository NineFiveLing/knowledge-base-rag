import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../user/entities/user.entity';
import { Role } from '../user/entities/role.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** 认证服务：注册、登录、JWT 签发 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    private jwtService: JwtService,
  ) {}

  /** 用户注册：默认分配 user 角色 */
  async register(dto: RegisterDto) {
    const password_hash = await bcrypt.hash(dto.password, 10);
    const defaultRole = await this.roleRepo.findOne({ where: { code: 'user' } });
    const user = this.userRepo.create({
      username: dto.username,
      password_hash,
      real_name: dto.real_name,
      dept_id: dto.dept_id,
      roles: defaultRole ? [defaultRole] : [],
    });
    await this.userRepo.save(user);
    return { id: user.id, username: user.username };
  }

  /** 登录：验证用户名密码，返回 JWT + 用户信息 */
  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
      relations: { roles: true, department: true },
    });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('用户名或密码错误');
    const payload = { sub: user.id, username: user.username };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        dept_id: user.dept_id,
        roles: user.roles.map((r) => r.code),
      },
    };
  }
}
