import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';

/** JWT 策略：验证请求头中的 Bearer Token */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'default-secret'),
    });
  }

  async validate(payload: { sub: string; username: string; dept_id: string; roles?: string[]; permissions?: string[]; iat?: number }) {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: { roles: true, department: true },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    // 密码在 token 签发后被重置过 → 强制重新登录
    if (payload.iat && user.password_changed_at) {
      const tokenIssuedAt = new Date(payload.iat * 1000);
      if (tokenIssuedAt < user.password_changed_at) {
        throw new UnauthorizedException('密码已变更，请重新登录');
      }
    }

    const userRoles = user.roles.map((r) => r.name || r.code);
    const permissions = await this.getUserPermissions(user.id);

    this.logger.log(`🔑 JWT validate: username=${user.username} roles=${JSON.stringify(userRoles)}`);

    return {
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
    };
  }

  private async getUserPermissions(userId: string): Promise<string[]> {
    const result = await this.userRepo.manager.query(`
      SELECT DISTINCT CONCAT(p.resource, ':', p.action) AS code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp."permissionsId"
      JOIN user_roles ur ON rp."rolesId" = ur."rolesId"
      WHERE ur."usersId" = $1
    `, [userId]);
    return result.map((r: any) => r.code);
  }
}
