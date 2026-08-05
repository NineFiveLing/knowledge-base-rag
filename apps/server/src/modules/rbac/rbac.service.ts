import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/** RBAC 服务：角色 CRUD + 用户角色分配 */
@Injectable()
export class RbacService {
  constructor(private readonly dataSource: DataSource) {}

  /** 列出所有角色（含用户数统计 + 权限列表） */
  async listRoles() {
    return this.dataSource.query(`
      SELECT r.*, COUNT(ur."usersId")::int as user_count,
             COALESCE(json_agg(
               json_build_object(
                 'id', p.id,
                 'code', CONCAT(p.resource, ':', p.action),
                 'resource', p.resource,
                 'action', p.action,
                 'name', p.name,
                 'description', p.description
               )
             ) FILTER (WHERE p.id IS NOT NULL), '[]') as permissions
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur."rolesId"
      LEFT JOIN role_permissions rp ON r.id = rp."rolesId"
      LEFT JOIN permissions p ON rp."permissionsId" = p.id
      GROUP BY r.id
      ORDER BY
        CASE r.type
          WHEN 'admin' THEN 1
          WHEN 'dept_admin' THEN 2
          ELSE 3
        END,
        r.created_at ASC
    `);
  }

  /** 获取角色详情（含权限列表） */
  async getRole(id: string) {
    const [role] = await this.dataSource.query(
      `SELECT r.*,
              COALESCE(json_agg(
                json_build_object(
                  'id', p.id,
                  'code', CONCAT(p.resource, ':', p.action),
                  'resource', p.resource,
                  'action', p.action,
                  'name', p.name,
                  'description', p.description
                )
              ) FILTER (WHERE p.id IS NOT NULL), '[]') as permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON r.id = rp."rolesId"
       LEFT JOIN permissions p ON rp."permissionsId" = p.id
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

    const roleType = this.determineRoleType(code);

    const [role] = await this.dataSource.query(
      `INSERT INTO roles (name, code, type, description) VALUES ($1, $2, $3, $4) RETURNING *`,
      [dto.name, code, roleType, dto.description || ''],
    );

    if (dto.permissionCodes.length > 0) {
      await this.dataSource.query(
        `INSERT INTO role_permissions ("rolesId", "permissionsId")
         SELECT $1, id FROM permissions WHERE CONCAT(resource, ':', action) = ANY($2)`,
        [role.id, dto.permissionCodes],
      );
    }

    return this.getRole(role.id);
  }

  /** 根据角色码判断角色类型 */
  private determineRoleType(code: string): 'admin' | 'dept_admin' | 'custom' {
    if (code === 'admin') return 'admin';
    if (code === 'dept_admin') return 'dept_admin';
    return 'custom';
  }

  /** 更新角色（名称 + 权限全量替换，事务保护） */
  async updateRole(id: string, dto: UpdateRoleDto) {
    return this.dataSource.transaction(async (mgr) => {
      const [existing] = await mgr.query(
        'SELECT id, code, name, type FROM roles WHERE id = $1', [id],
      );
      if (!existing) throw new NotFoundException('角色不存在');

      if (dto.name || dto.description) {
        const code = dto.name
          ? dto.name.toLowerCase().replace(/\s+/g, '_')
          : existing.code;
        const roleType = existing.type;
        await mgr.query(
          'UPDATE roles SET name = $1, code = $2, type = $3, description = $4 WHERE id = $5',
          [dto.name ?? existing.name, code, roleType, dto.description ?? '', id],
        );
      }

      if (dto.permissionCodes) {
        await mgr.query('DELETE FROM role_permissions WHERE "rolesId" = $1', [id]);
        if (dto.permissionCodes.length > 0) {
          await mgr.query(
            `INSERT INTO role_permissions ("rolesId", "permissionsId")
             SELECT $1, id FROM permissions WHERE CONCAT(resource, ':', action) = ANY($2)`,
            [id, dto.permissionCodes],
          );
        }
      }
    });

    return this.getRole(id);
  }

  /** 删除角色 */
  async deleteRole(id: string) {
    return this.dataSource.transaction(async (mgr) => {
      const [role] = await mgr.query(
        'SELECT id FROM roles WHERE id = $1', [id],
      );
      if (!role) throw new NotFoundException('角色不存在');

      await mgr.query('DELETE FROM user_roles WHERE "rolesId" = $1', [id]);
      await mgr.query('DELETE FROM role_permissions WHERE "rolesId" = $1', [id]);
      await mgr.query('DELETE FROM roles WHERE id = $1', [id]);
    });
    return { success: true };
  }

  /** 为用户分配角色（全量替换，含存在性校验） */
  async assignUserRoles(userId: string, roleIds: string[]) {
    const [user] = await this.dataSource.query(
      'SELECT id FROM users WHERE id = $1', [userId],
    );
    if (!user) throw new NotFoundException('用户不存在');

    return this.dataSource.transaction(async (mgr) => {
      if (roleIds.length > 0) {
        const existingRoles = await mgr.query(
          'SELECT id FROM roles WHERE id = ANY($1)', [roleIds],
        );
        if (existingRoles.length !== roleIds.length) {
          throw new BadRequestException('部分角色不存在');
        }
      }

      await mgr.query('DELETE FROM user_roles WHERE "usersId" = $1', [userId]);
      if (roleIds.length > 0) {
        await mgr.query(
          `INSERT INTO user_roles ("usersId", "rolesId")
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [userId, roleIds],
        );
      }
    }).then(() => this.getUserRoles(userId));
  }

  /** 获取用户的角色列表 */
  async getUserRoles(userId: string) {
    return this.dataSource.query(
      `SELECT r.id, r.name FROM roles r
       JOIN user_roles ur ON r.id = ur."rolesId"
       WHERE ur."usersId" = $1`, [userId],
    );
  }

  /** 列出所有可用权限 */
  async listPermissions() {
    return this.dataSource.query(
      'SELECT id, CONCAT(resource, \':\', action) AS code, resource, action, name, description FROM permissions ORDER BY resource, action',
    );
  }
}
