import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** 角色装饰器：标记接口所需角色，配合 RolesGuard 使用 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
