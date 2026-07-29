import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 当前用户装饰器：从 request.user 提取登录用户信息 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
