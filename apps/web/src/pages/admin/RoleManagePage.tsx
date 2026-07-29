import { useState, useEffect } from 'react';
import api from '../../services/api';
import Can from '../../components/common/Can';

interface Role {
  id: string;
  name: string;
  description?: string;
  code: string;
  is_system: boolean;
  user_count: number;
  created_at: string;
}

interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
}

/** 角色管理页面：角色列表、创建、编辑、删除 */
export default function RoleManagePage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPerms, setFormPerms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.get('/rbac/roles'),
        api.get('/rbac/permissions'),
      ]);
      setRoles(rolesRes.data);
      setPermissions(permsRes.data);
    } catch (err) {
      setError('加载数据失败，请确认您拥有管理员权限');
      console.error('加载角色数据失败', err);
    } finally {
      setLoading(false);
    }
  }

  /** 打开创建 Modal */
  function openCreate() {
    setEditingRole(null);
    setFormName('');
    setFormDesc('');
    setFormPerms([]);
    setShowModal(true);
  }

  /** 打开编辑 Modal */
  async function openEdit(role: Role) {
    setEditingRole(role);
    setFormName(role.name);
    setFormDesc(role.description || '');
    setShowModal(true);
    setSaving(true);
    try {
      const { data } = await api.get(`/rbac/roles/${role.id}`);
      setFormPerms(data.permissions || []);
    } catch {
      setFormPerms([]);
    } finally {
      setSaving(false);
    }
  }

  /** 提交创建/更新 */
  async function handleSubmit() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editingRole) {
        await api.patch(`/rbac/roles/${editingRole.id}`, {
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          permissionCodes: formPerms,
        });
      } else {
        await api.post('/rbac/roles', {
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          permissionCodes: formPerms,
        });
      }
      setShowModal(false);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  /** 删除角色 */
  async function handleDelete(role: Role) {
    setSaving(true);
    try {
      await api.delete(`/rbac/roles/${role.id}`);
      setConfirmDelete(null);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  }

  /** 切换权限勾选 */
  function togglePerm(code: string) {
    setFormPerms((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  // 加载中骨架
  if (loading) {
    return (
      <div className="manage-page">
        <h2>🔑 角色管理</h2>
        <p style={{ color: '#94a3b8' }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="manage-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>🔑 角色管理</h2>
        <Can permission="rbac:write">
          <button onClick={openCreate} style={{ padding: '8px 20px', background: '#667eea', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
            + 新建角色
          </button>
        </Can>
      </div>

      {error && <p style={{ color: '#e74c3c', marginBottom: 12 }}>{error}</p>}

      {roles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', background: '#fff', borderRadius: 4 }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>暂无角色</p>
          <p style={{ fontSize: 13 }}>点击"新建角色"开始创建第一个角色</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>角色名称</th>
              <th>描述</th>
              <th>用户数</th>
              <th>类型</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td><strong>{role.name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{role.code}</span></td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {role.description || '-'}
                </td>
                <td>{role.user_count}</td>
                <td>{role.is_system ? <span style={{ color: '#f59e0b', fontSize: 12 }}>系统</span> : <span style={{ color: '#94a3b8', fontSize: 12 }}>自定义</span>}</td>
                <td style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(role.created_at).toLocaleDateString('zh-CN')}</td>
                <td>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Can permission="rbac:write">
                      <button onClick={() => openEdit(role)}
                        style={{ padding: '4px 12px', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                        编辑
                      </button>
                    </Can>
                    {!role.is_system && (
                      <Can permission="rbac:write">
                        <button onClick={() => setConfirmDelete(role)}
                          style={{ padding: '4px 12px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                          删除
                        </button>
                      </Can>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 创建 / 编辑 Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !saving && setShowModal(false)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 480, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>{editingRole ? '编辑角色' : '新建角色'}</h3>

            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              名称
              <input value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="角色名称" disabled={saving}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, marginTop: 4, fontSize: 14 }} />
            </label>

            <label style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
              描述
              <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
                placeholder="角色描述（可选）" disabled={saving}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, marginTop: 4, fontSize: 14 }} />
            </label>

            <fieldset style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 4, padding: 12 }}>
              <legend style={{ fontSize: 13, fontWeight: 600 }}>权限</legend>
              {permissions.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>暂无可用权限</p>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {permissions.map((perm) => (
                    <label key={perm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={formPerms.includes(perm.code)}
                        onChange={() => togglePerm(perm.code)} disabled={saving} />
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{perm.code}</span>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>({perm.resource}:{perm.action})</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowModal(false)} disabled={saving}
                style={{ padding: '8px 20px', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
              <button onClick={handleSubmit} disabled={saving || !formName.trim()}
                style={{ padding: '8px 20px', background: '#667eea', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 Modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>确认删除</h3>
            <p style={{ marginBottom: 20, fontSize: 14, color: '#666' }}>
              确定要删除角色 <strong>{confirmDelete.name}</strong> 吗？该操作不可撤销，关联的用户角色分配也将被移除。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} disabled={saving}
                style={{ padding: '8px 20px', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
                取消
              </button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={saving}
                style={{ padding: '8px 20px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
                {saving ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
