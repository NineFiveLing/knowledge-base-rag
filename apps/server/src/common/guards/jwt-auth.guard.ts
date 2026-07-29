import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** JWT 认证守卫：验证请求是否携带有效 Token */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
