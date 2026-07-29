import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/** RBAC 服务：角色 CRUD + 用户角色分配 */
@Injectable()
export class RbacService {
  constructor(private readonly dataSource: DataSource) {}

  /** 列出所有角色（含用户数统计） */
  async listRoles() {
    return this.dataSource.query(`
      SELECT r.*, COUNT(ur.user_id)::int as user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);
  }

  /** 获取角色详情（含权限列表） */
  async getRole(id: string) {
    const [role] = await this.dataSource.query(
      `SELECT r.*, COALESCE(json_agg(p.code) FILTER (WHERE p.id IS NOT NULL), '[]') as permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       LEFT JOIN permissions p ON rp.permission_id = p.id
       WHERE r.id = $1
       GROUP BY r.id`, [id],
    );
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  /** 创建角色并关联权限 */
  async createRole(dto: CreateRoleDto) {
    const [existing] = await this.dataSource.query(
      'SELECT id FROM roles WHERE name = $1', [dto.name],
    );
    if (existing) throw new ConflictException('角色名称已存在');

    // 从名称自动生成角色码（小写 + 下划线）
    const code = dto.name.toLowerCase().replace(/\s+/g, '_');

    const [role] = await this.dataSource.query(
      `INSERT INTO roles (name, code, description) VALUES ($1, $2, $3) RETURNING *`,
      [dto.name, code, dto.description],
    );

    for (const permCode of dto.permissionCodes) {
      await this.dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = $2`,
        [role.id, permCode],
      );
    }

    return this.getRole(role.id);
  }

  /** 更新角色（名称 + 权限全量替换） */
  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.getRole(id); // 检查存在性

    if (dto.name) {
      const code = dto.name.toLowerCase().replace(/\s+/g, '_');
      await this.dataSource.query(
        'UPDATE roles SET name = $1, code = $2 WHERE id = $3', [dto.name, code, id],
      );
    }

    if (dto.permissionCodes) {
      await this.dataSource.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      for (const permCode of dto.permissionCodes) {
        await this.dataSource.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE code = $2`,
          [id, permCode],
        );
      }
    }

    return this.getRole(id);
  }

  /** 删除角色（系统角色不可删除） */
  async deleteRole(id: string) {
    const [role] = await this.dataSource.query(
      'SELECT is_system FROM roles WHERE id = $1', [id],
    );
    if (!role) throw new NotFoundException('角色不存在');
    if (role.is_system) throw new ConflictException('系统角色不可删除');

    await this.dataSource.query('DELETE FROM user_roles WHERE role_id = $1', [id]);
    await this.dataSource.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    await this.dataSource.query('DELETE FROM roles WHERE id = $1', [id]);
    return { success: true };
  }

  /** 为用户分配角色（全量替换） */
  async assignUserRoles(userId: string, roleIds: string[]) {
    await this.dataSource.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const roleId of roleIds) {
      await this.dataSource.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleId],
      );
    }
    return this.getUserRoles(userId);
  }

  /** 获取用户的角色列表 */
  async getUserRoles(userId: string) {
    return this.dataSource.query(
      `SELECT r.id, r.name FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1`, [userId],
    );
  }

  /** 列出所有可用权限 */
  async listPermissions() {
    return this.dataSource.query(
      'SELECT id, code, resource, action FROM permissions ORDER BY resource, action',
    );
  }
}
