import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Checkbox, Popconfirm, Tag, Spin, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
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

export default function RoleManagePage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: rolesData }, { data: permsData }] = await Promise.all([
        api.get('/rbac/roles'),
        api.get('/rbac/permissions'),
      ]);
      setRoles(rolesData);
      setPermissions(permsData);
    } catch {
      message.error('加载数据失败，请确认您拥有管理员权限');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingRole(null);
    form.resetFields();
    form.setFieldsValue({ permissionCodes: [] });
    setModalOpen(true);
  }

  async function openEdit(role: Role) {
    setEditingRole(role);
    form.setFieldsValue({ name: role.name, description: role.description || '' });
    setModalOpen(true);
    setSaving(true);
    try {
      const { data } = await api.get(`/rbac/roles/${role.id}`);
      form.setFieldsValue({ permissionCodes: data.permissions || [] });
    } catch {
      form.setFieldsValue({ permissionCodes: [] });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingRole) {
        await api.patch(`/rbac/roles/${editingRole.id}`, values);
      } else {
        await api.post('/rbac/roles', values);
      }
      message.success(editingRole ? '更新成功' : '创建成功');
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: Role) {
    setSaving(true);
    try {
      await api.delete(`/rbac/roles/${role.id}`);
      message.success('删除成功');
      await loadData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    {
      title: '角色名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Role) => (
        <>
          <strong>{name}</strong>
          <br />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{record.code}</span>
        </>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (d: string | undefined) => d || '-',
    },
    { title: '用户数', dataIndex: 'user_count', key: 'user_count' },
    {
      title: '类型',
      dataIndex: 'is_system',
      key: 'is_system',
      render: (v: boolean) =>
        v ? <Tag color="gold">系统</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => new Date(d).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Role) => (
        <>
          <Can permission="rbac:write">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ marginRight: 8 }}>
              编辑
            </Button>
          </Can>
          {!record.is_system && (
            <Can permission="rbac:write">
              <Popconfirm title="确定要删除该角色吗？关联的用户角色分配也将被移除。" onConfirm={() => handleDelete(record)} okText="确定" cancelText="取消">
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Can>
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0, fontSize: 20 }}>🔑 角色管理</h2>
        <Can permission="rbac:write">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建角色</Button>
        </Can>
      </div>

      <Table columns={columns} dataSource={roles} rowKey="id" />

      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onCancel={() => !saving && setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="角色名称" disabled={saving} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="角色描述（可选）" disabled={saving} />
          </Form.Item>
          <Form.Item name="permissionCodes" label="权限">
            <Checkbox.Group style={{ width: '100%' }}>
              {permissions.map((perm) => (
                <div key={perm.id} style={{ marginBottom: 4 }}>
                  <Checkbox value={perm.code} disabled={saving}>
                    <code style={{ fontSize: 12 }}>{perm.code}</code>
                    <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 8 }}>
                      ({perm.resource}:{perm.action})
                    </span>
                  </Checkbox>
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
