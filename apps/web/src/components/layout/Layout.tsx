import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Space,
  Modal,
  Form,
  Input,
  Tag,
  message,
  Select,
  App,
} from "antd";
import {
  FolderOutlined,
  MessageOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  TeamOutlined,
  EditOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import { useAuthStore } from "../../stores/auth.store";
import api from "../../services/api";

const { Sider, Header, Content } = Layout;

const baseMenuItems = [
  { key: "/knowledge", icon: <FolderOutlined />, label: "知识库" },
  { key: "/chat", icon: <MessageOutlined />, label: "AI 问答" },
  { key: "/documents/manage", icon: <FileTextOutlined />, label: "文档管理" },
  { key: "/analytics", icon: <BarChartOutlined />, label: "数据统计" },
];

export default function AppLayout() {
  const { user, logout, updateUser } = useAuthStore();
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [departments, setDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const pathname = location.pathname;

  // 获取部门列表
  useEffect(() => {
    api
      .get("/departments")
      .then((res) => setDepartments(res.data || []))
      .catch(() => {});
  }, []);

  // 角色 code → 中文名 + 颜色映射
  const roleMeta: Record<string, { name: string; color: string }> = {
    admin: { name: "管理员", color: "red" },
    dept_admin: { name: "部门管理员", color: "orange" },
    user: { name: "普通员工", color: "blue" },
    super_admin: { name: "超级管理员", color: "red" },
    超级管理员: { name: "超级管理员", color: "red" },
  };
  // 根据 code/name 智能推断角色类型（兼容未在映射中的自定义角色）
  const inferRoleType = (code: string): "admin" | "dept_admin" | "custom" => {
    if (
      code === "admin" ||
      code === "super_admin" ||
      code === "超级管理员" ||
      code.includes("超级") ||
      code.includes("super")
    )
      return "admin";
    if (code === "dept_admin" || code.includes("部门")) return "dept_admin";
    return "custom";
  };
  const getRoleCode = (r: string | { code?: string }) =>
    typeof r === "string" ? r : r?.code || "";
  const getRoleLabel = (r: string | { code?: string; name?: string }) => {
    const code = getRoleCode(r);
    return (
      roleMeta[code]?.name || (typeof r === "string" ? r : r?.name || code)
    );
  };
  const getRoleColor = (r: string | { code?: string }) => {
    const code = getRoleCode(r);
    if (roleMeta[code]) return roleMeta[code].color;
    // 未在映射中的角色，按类型推断颜色
    const type = inferRoleType(code);
    return type === "admin" ? "red" : type === "dept_admin" ? "orange" : "blue";
  };

  // 判断是否有管理员权限
  const isAdmin =
    user?.roles?.some((r) => getRoleCode(r) === "admin") ||
    user?.permissions?.includes("rbac:read");

  const menuItems = [
    ...baseMenuItems,
    ...(isAdmin
      ? [
          { key: "/admin/roles", icon: <SettingOutlined />, label: "角色管理" },
          { key: "/admin/users", icon: <TeamOutlined />, label: "用户管理" },
        ]
      : []),
  ];

  // 菜单选中逻辑：支持精确匹配和前缀匹配
  const selectedKey = pathname.startsWith("/documents")
    ? "/documents/manage"
    : menuItems.find(
        (item) => pathname === item.key || pathname.startsWith(item.key + "/"),
      )?.key || pathname;

  const userMenuItems = [
    {
      key: "info",
      label: (
        <div>
          <div style={{ fontWeight: 600 }}>
            {user?.real_name || user?.username}
          </div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
            {user?.department?.name || "未设置部门"}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#bbb",
              marginTop: 2,
              lineHeight: "18px",
            }}
          >
            {user?.roles?.map((r) => (
              <Tag
                key={getRoleCode(r)}
                color={getRoleColor(r)}
                style={{
                  marginRight: 4,
                  fontSize: 11,
                  whiteSpace: "normal",
                  lineHeight: "18px",
                }}
              >
                {getRoleLabel(r)}
              </Tag>
            ))}
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" as const },
    {
      key: "edit",
      icon: <EditOutlined />,
      label: "编辑个人信息",
    },
    {
      key: "changePassword",
      icon: <KeyOutlined />,
      label: "修改密码",
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      danger: true,
    },
  ];

  const handleUserMenu = async ({ key }: { key: string }) => {
    if (key === "logout") {
      logout();
    } else if (key === "roles") {
      navigate("/admin/roles");
    } else if (key === "edit") {
      // 打开编辑个人信息弹窗
      form.setFieldsValue({
        real_name: user?.real_name,
        email: user?.email,
        phone: user?.phone,
        dept_id: user?.dept_id || undefined,
      });
      setEditModalOpen(true);
    } else if (key === "changePassword") {
      passwordForm.resetFields();
      setPasswordModalOpen(true);
    }
  };

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields();
      await api.patch(`/users/${user?.id}`, values);
      message.success("个人信息更新成功");
      setEditModalOpen(false);
      // 重新获取最新用户信息（确保拿到最新的 department 和 roles）
      const { data: updated } = await api.get(`/users/${user?.id}`);
      if (updated) {
        updateUser(updated);
      }
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || "更新失败");
      }
    }
  };

  const handleChangePassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      await api.patch("/auth/password", {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      setPasswordModalOpen(false);
      passwordForm.resetFields();
      // 等密码弹窗完全关闭后，再显示跳转确认
      setTimeout(() => {
        modal.confirm({
          title: "密码修改成功",
          content: "请使用新密码重新登录",
          okText: "去登录",
          centered: true,
          cancelButtonProps: { style: { display: 'none' } },
          onOk: () => {
            useAuthStore.getState().logout();
          },
        });
      }, 300);
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || "修改失败");
      }
    }
  };

  return (
    <Layout style={{ height: "100%" }}>
      <Sider width={220} theme="dark">
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            paddingLeft: 20,
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          📚 企业知识库
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 20px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Dropdown
            menu={{ items: userMenuItems, onClick: handleUserMenu }}
            popupRender={(menu) => (
              <div style={{ minWidth: 240, width: "auto" }}>{menu}</div>
            )}
          >
            <Space style={{ cursor: "pointer" }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.real_name || user?.username}</span>
              {user?.department?.name && (
                <Tag color="blue" style={{ margin: 0 }}>
                  {user.department.name}
                </Tag>
              )}
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 20, overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>

      {/* 编辑个人信息弹窗 */}
      <Modal
        title="编辑个人信息"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditSubmit}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="real_name"
            label="真实姓名"
            rules={[{ required: true, message: "请输入真实姓名" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ type: "email", message: "邮箱格式不正确" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input />
          </Form.Item>
          <Form.Item name="dept_id" label="所属部门">
            <Select
              placeholder="请选择部门"
              allowClear
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal
        title="修改密码"
        open={passwordModalOpen}
        onCancel={() => {
          setPasswordModalOpen(false);
          passwordForm.resetFields();
        }}
        onOk={handleChangePassword}
        okText="确认修改"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={passwordForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="oldPassword"
            label="原密码"
            rules={[{ required: true, message: "请输入原密码" }]}
          >
            <Input.Password placeholder="请输入原密码" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 6, message: "密码至少6位" },
            ]}
          >
            <Input.Password placeholder="请输入新密码（至少6位）" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
