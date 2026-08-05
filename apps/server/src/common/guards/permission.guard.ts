import { CanActivate, ExecutionContext, Injectable, SetMetadata, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** 权限元数据 key */
export const PERMISSION_KEY = 'requiredPermission';

/** 权限装饰器：标注端点需要的权限码，如 @RequirePermission('rbac:write') */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

/** 权限守卫：检查 JWT payload 中的 permissions 字段 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string>(PERMISSION_KEY, context.getHandler());
    if (!required) return true; // 无权限要求 → 放行

    const { user } = context.switchToHttp().getRequest();
    this.logger.log(`🔐 权限检查: required=${required} userKeys=${user ? Object.keys(user).join(',') : 'null'} roles=${JSON.stringify(user?.roles)}`);
    if (!user) return true; // 未认证，交给 JwtAuthGuard 处理
    if (user?.roles?.includes('admin')) return true;
    return user?.permissions?.includes(required) ?? false;
  }
}
