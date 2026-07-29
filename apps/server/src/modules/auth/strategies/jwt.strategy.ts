import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/** JWT 策略：验证请求头中的 Bearer Token */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'default-secret'),
    });
  }

  async validate(payload: { sub: string; username: string; dept_id: string; roles?: string[]; permissions?: string[] }) {
    return {
      id: payload.sub,
      username: payload.username,
      dept_id: payload.dept_id,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }
}
