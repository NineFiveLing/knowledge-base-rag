import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/guards/permission.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacService } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto/role.dto';

/** RBAC 管理控制器：角色 CRUD + 用户角色分配 */
@Controller('rbac')
@UseGuards(JwtAuthGuard)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermission('rbac:read')
  async listRoles() {
    return this.rbacService.listRoles();
  }

  @Get('roles/:id')
  @RequirePermission('rbac:read')
  async getRole(@Param('id') id: string) {
    return this.rbacService.getRole(id);
  }

  @Post('roles')
  @RequirePermission('rbac:write')
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermission('rbac:write')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermission('rbac:write')
  async deleteRole(@Param('id') id: string) {
    return this.rbacService.deleteRole(id);
  }

  @Get('users/:id/roles')
  @RequirePermission('rbac:read')
  async getUserRoles(@Param('id') id: string) {
    return this.rbacService.getUserRoles(id);
  }

  @Post('users/:id/roles')
  @RequirePermission('rbac:write')
  async assignUserRoles(@Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.rbacService.assignUserRoles(id, dto.roleIds);
  }

  @Get('permissions')
  @RequirePermission('rbac:read')
  async listPermissions() {
    return this.rbacService.listPermissions();
  }
}
