import { useState, useEffect, useRef } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Popconfirm,
  Tag,
  Space,
  Spin,
  message,
  Typography,
  App,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  KeyOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import Can from "../../components/common/Can";
import { useAuthStore } from "../../stores/auth.store";

const { Title } = Typography;

interface User {
  id: string;
  username: string;
  real_name: string;
  email?: string;
  phone?: string;
  dept_id?: string;
  department?: { id: string; name: string };
  roles: Array<{ id: string; name: string; code: string; type: string }>;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  code: string;
  type: string;
}

export default function UserManagePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  // 角色分配弹窗
  const [roleAssignModalOpen, setRoleAssignModalOpen] = useState(false);
  const [assigningUser, setAssigningUser] = useState<User | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [form] = Form.useForm();
  const { message, modal } = App.useApp();
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!user) {
      message.warning("请先登录");
      navigate("/login");
      return;
    }
    mountedRef.current = true;
    loadData();
    return () => {
      mountedRef.current = false;
    };
  }, [user, navigate, message]);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: usersData }, { data: deptsData }, { data: rolesData }] =
        await Promise.all([
          api.get("/users"),
          api.get("/departments"),
          api.get("/rbac/roles"),
        ]);
      if (mountedRef.current) {
        setUsers(usersData);
        setDepartments(deptsData);
        setRoles(rolesData);
      }
    } catch {
      if (mountedRef.current) {
        message.error("加载数据失败");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  function openCreate() {
    setEditingUser(null);
    form.resetFields();
    // 默认选中"普通员工"角色
    const defaultRole = roles.find((r) => r.code === "user");
    form.setFieldsValue({ roleIds: defaultRole ? [defaultRole.id] : [] });
    setModalOpen(true);
  }

  function openEdit(u: User) {
    setEditingUser(u);
    form.setFieldsValue({
      username: u.username,
      real_name: u.real_name,
      email: u.email,
      phone: u.phone,
      dept_id: u.dept_id,
    });
    setModalOpen(true);
  }

  // 打开角色分配弹窗
  function openAssignRoles(u: User) {
    setAssigningUser(u);
    const ids = u.roles.map((r) => r.id);
    setRoleAssignModalOpen(true);
    // 回选当前角色
    form.setFieldsValue({ roleIds: ids });
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingUser) {
        // 仅更新用户基本信息（不含角色）
        await api.patch(`/users/${editingUser.id}`, {
          username: values.username,
          real_name: values.real_name,
          email: values.email,
          phone: values.phone,
          dept_id: values.dept_id,
        });
        message.success("更新成功");
        // 如果修改的是当前用户，同步更新 auth store
        if (user && editingUser.id === user.id) {
          const { data: updated } = await api.get(`/users/${user.id}`);
          if (updated) {
            useAuthStore.getState().updateUser(updated);
          }
        }
      } else {
        // 新建用户（含角色选择）
        const { data: newUser } = await api.post("/users", {
          username: values.username,
          password: values.password,
          real_name: values.real_name,
          email: values.email,
          phone: values.phone,
          dept_id: values.dept_id,
          roleIds: values.roleIds || [],
        });
        message.success("创建成功");
      }
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  }

  // 分配角色（独立操作，含二次确认）
  async function handleAssignRoles() {
    if (!assigningUser) return;
    // 二次确认
    modal.confirm({
      title: "确认分配角色",
      content: `即将为用户「${assigningUser.username}」分配角色，请确认该用户是否已保存所有未提交的数据。`,
      okText: "确认分配",
      cancelText: "取消",
      onOk: async () => {
        setAssignSaving(true);
        try {
          // 从 form 读取最新选中的角色（而非 state，state 可能未同步）
          const values = await form.validateFields();
          const roleIds = values.roleIds || [];
          await api.patch(`/users/${assigningUser.id}/roles`, { roleIds });
          message.success("角色分配成功");
          setRoleAssignModalOpen(false);
          await loadData();
          // 如果分配的是当前用户，更新本地 store 并提示重新登录
          if (user && assigningUser.id === user.id) {
            const { data: updated } = await api.get(`/users/${user.id}`);
            if (updated) {
              useAuthStore.getState().updateUser(updated);
            }
            setTimeout(() => {
              modal.confirm({
                title: "角色已变更",
                content:
                  "您的角色已发生变更，部分功能可能不可用。建议重新登录以获取最新权限。",
                okText: "重新登录",
                centered: true,
                cancelButtonProps: { style: { display: 'none' } },
                onOk: () => {
                  useAuthStore.getState().logout();
                },
              });
            }, 300);
          }
        } catch (err: any) {
          message.error(err.response?.data?.message || "角色分配失败");
        } finally {
          setAssignSaving(false);
        }
      },
    });
  }

  function openResetPassword(user: User) {
    setResettingUser(user);
    setPasswordModalOpen(true);
  }

  async function handleResetPassword() {
    if (!resettingUser) return;
    // 二次确认
    modal.confirm({
      title: "确认重置密码",
      content: `即将重置用户「${resettingUser.username}」的密码，重置后密码将变为 123456。该用户将无法使用旧密码登录。`,
      okText: "确认重置",
      cancelText: "取消",
      onOk: async () => {
        setSaving(true);
        try {
          await api.patch(`/users/${resettingUser.id}/password`, {
            newPassword: "123456",
          });
          setPasswordModalOpen(false);
          // 显示重置后的密码
          modal.info({
            title: "密码重置成功",
            content: (
              <div>
                <p>
                  用户 <strong>{resettingUser.username}</strong> 的密码已重置
                </p>
                <p style={{ marginTop: 8 }}>
                  新密码：
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      color: "#1677ff",
                      userSelect: "all",
                    }}
                  >
                    123456
                  </span>
                </p>
                <p style={{ color: "#999", fontSize: 12 }}>
                  请告知用户新密码，登录后建议立即修改
                </p>
              </div>
            ),
            okText: "知道了",
            centered: true,
          });
        } catch (err: any) {
          message.error(err.response?.data?.message || "重置失败");
        } finally {
          setSaving(false);
        }
      },
    });
  }

  async function handleDelete(user: User) {
    if (user.roles.some((r) => r.code === "admin")) {
      message.error("系统管理员账号不能删除");
      return;
    }

    setSaving(true);
    try {
      await api.delete(`/users/${user.id}`);
      message.success("删除成功");
      await loadData();
    } catch (err: any) {
      message.error(err.response?.data?.message || "删除失败");
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
      render: (username: string) => (
        <Space>
          <UserOutlined />
          <strong>{username}</strong>
        </Space>
      ),
    },
    {
      title: "真实姓名",
      dataIndex: "real_name",
      key: "real_name",
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      render: (email: string) => email || "-",
    },
    {
      title: "所属部门",
      key: "department",
      render: (_: unknown, record: User) => record.department?.name || "-",
    },
    {
      title: "角色",
      dataIndex: "roles",
      key: "roles",
      render: (roles: Role[]) => (
        <Space size={[0, 4]} wrap>
          {roles.map((role) => (
            <Tag
              key={role.id}
              color={
                role.type === "admin"
                  ? "red"
                  : role.type === "dept_admin"
                    ? "orange"
                    : "blue"
              }
            >
              {role.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (date: string) => new Date(date).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: User) => (
        <Space>
          <Can permission="rbac:write">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          </Can>
          <Can permission="rbac:write">
            <Button
              size="small"
              icon={<TeamOutlined />}
              onClick={() => openAssignRoles(record)}
            >
              分配角色
            </Button>
          </Can>
          {!record.roles.some((r) => r.code === "admin") && (
            <Can permission="rbac:write">
              <Popconfirm
                title="确定要删除该用户吗？"
                onConfirm={() => handleDelete(record)}
                okText="确定"
                cancelText="取消"
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Can>
          )}
          <Can permission="rbac:write">
            <Button
              size="small"
              icon={<KeyOutlined />}
              onClick={() => openResetPassword(record)}
            >
              重置密码
            </Button>
          </Can>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          👥 用户管理
        </Title>
        <Can permission="rbac:write">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建用户
          </Button>
        </Can>
      </div>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
      />

      {/* 编辑/新建用户弹窗（含角色分配） */}
      <Modal
        title={editingUser ? "编辑用户" : "新建用户"}
        open={modalOpen}
        onCancel={() => !saving && setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input placeholder="用户名" disabled={saving || !!editingUser} />
          </Form.Item>
          {!editingUser && (
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password placeholder="密码" disabled={saving} />
            </Form.Item>
          )}
          <Form.Item
            name="real_name"
            label="真实姓名"
            rules={[{ required: true, message: "请输入真实姓名" }]}
          >
            <Input placeholder="真实姓名" disabled={saving} />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ type: "email", message: "邮箱格式不正确" }]}
          >
            <Input placeholder="邮箱（可选）" disabled={saving} />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="手机号（可选）" disabled={saving} />
          </Form.Item>
          <Form.Item
            name="dept_id"
            label="所属部门"
            rules={[{ required: true, message: "请选择所属部门" }]}
          >
            <Select placeholder="请选择部门" disabled={saving}>
              {departments.map((dept) => (
                <Select.Option key={dept.id} value={dept.id}>
                  {dept.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {!editingUser && (
            <Form.Item name="roleIds" label="角色" rules={[{ required: true, message: '请至少选择一个角色' }]}>
              <Select
                mode="multiple"
                placeholder="请选择角色"
                disabled={saving}
                optionLabelProp="label"
                allowClear
              >
                {roles.map((role) => (
                  <Select.Option key={role.id} value={role.id} label={role.name}>
                    <Space>
                      <span>{role.name}</span>
                      <Tag color={
                        role.type === 'admin' ? 'red' :
                        role.type === 'dept_admin' ? 'orange' : 'blue'
                      }>
                        {role.type === 'admin' ? '管理员' :
                         role.type === 'dept_admin' ? '部门管理员' : '自定义'}
                      </Tag>
                    </Space>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 角色分配弹窗 */}
      <Modal
        title="分配角色"
        open={roleAssignModalOpen}
        onCancel={() => setRoleAssignModalOpen(false)}
        onOk={handleAssignRoles}
        confirmLoading={assignSaving}
        okText="确认分配"
        cancelText="取消"
        destroyOnHidden
        width={400}
      >
        <div style={{ marginBottom: 16, color: "#666" }}>
          正在为用户 <strong>{assigningUser?.username}</strong> 分配角色
        </div>
        <Form form={form} layout="vertical">
          <Form.Item
            name="roleIds"
            label="角色"
            rules={[{ required: true, message: "请至少选择一个角色" }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择角色"
              disabled={assignSaving}
              optionLabelProp="label"
              allowClear
            >
              {roles.map((role) => (
                <Select.Option key={role.id} value={role.id} label={role.name}>
                  <Space>
                    <span>{role.name}</span>
                    <Tag
                      color={
                        role.type === "admin"
                          ? "red"
                          : role.type === "dept_admin"
                            ? "orange"
                            : "blue"
                      }
                    >
                      {role.type === "admin"
                        ? "管理员"
                        : role.type === "dept_admin"
                          ? "部门管理员"
                          : "自定义"}
                    </Tag>
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal
        title="重置用户密码"
        open={passwordModalOpen}
        onCancel={() => setPasswordModalOpen(false)}
        onOk={handleResetPassword}
        okText="确认重置"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
      >
        <div style={{ marginBottom: 16, color: "#666" }}>
          即将重置用户 <strong>{resettingUser?.username}</strong> 的密码
        </div>
        <div
          style={{
            padding: "12px 16px",
            background: "#fff7e6",
            border: "1px solid #ffd591",
            borderRadius: 6,
            color: "#d46b08",
          }}
        >
          重置后密码将变为：<span style={{ fontWeight: 600, fontSize: 16 }}>123456</span>
        </div>
        <div style={{ marginTop: 12, color: "#999", fontSize: 12 }}>
          请告知用户新密码，登录后建议立即修改
        </div>
      </Modal>
    </div>
  );
}
