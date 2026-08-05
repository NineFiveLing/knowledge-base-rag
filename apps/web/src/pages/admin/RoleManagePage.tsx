import { useState, useEffect, useRef, useMemo } from "react";
import {
  List,
  Button,
  Modal,
  Form,
  Input,
  Checkbox,
  Tag,
  Spin,
  message,
  Space,
  Typography,
  Empty,
  Dropdown,
  App,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  SaveOutlined,
  ExclamationCircleOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import Can from "../../components/common/Can";
import { useAuthStore } from "../../stores/auth.store";

const { Text, Title } = Typography;

interface Role {
  id: string;
  name: string;
  code: string;
  type: "admin" | "dept_admin" | "custom";
  description?: string;
  is_system: boolean;
  user_count: number;
  created_at: string;
  permissions?: Array<{
    id: string;
    code: string;
    resource: string;
    action: string;
    name: string;
    description?: string;
  }>;
}

interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
  name: string;
  description?: string;
}

export default function RoleManagePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editedPermCodes, setEditedPermCodes] = useState<string[]>([]);
  const [form] = Form.useForm();
  const { message, modal } = App.useApp();
  const mountedRef = useRef(true);

  // 未登录重定向
  useEffect(() => {
    if (!user) {
      message.warning("请先登录");
      navigate("/login");
    }
  }, [user, navigate, message]);

  useEffect(() => {
    if (!user) return;
    mountedRef.current = true;
    loadData();
    return () => {
      mountedRef.current = false;
    };
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: rolesData }, { data: permsData }] = await Promise.all([
        api.get("/rbac/roles"),
        api.get("/rbac/permissions"),
      ]);
      if (mountedRef.current) {
        setRoles(rolesData);
        setPermissions(permsData);
        // 默认选中第一个角色
        if (rolesData.length > 0 && !selectedRoleId) {
          setSelectedRoleId(rolesData[0].id);
        }
      }
    } catch {
      if (mountedRef.current) {
        message.error("加载数据失败，请确认您拥有管理员权限");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  // 获取选中角色的权限
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const selectedRolePermissions = selectedRole?.permissions || [];

  // 初始化编辑权限列表（当选中角色变化时）
  useEffect(() => {
    if (selectedRole) {
      setEditedPermCodes(selectedRolePermissions.map((p) => p.code));
    }
  }, [selectedRoleId]); // 只依赖 selectedRoleId，避免权限更新时重置编辑状态

  // 检测权限是否有变更
  const hasPermissionChanged = useMemo(() => {
    if (!selectedRole) return false;
    const currentCodes = selectedRolePermissions.map((p) => p.code).sort();
    const editedCodes = [...editedPermCodes].sort();
    return JSON.stringify(currentCodes) !== JSON.stringify(editedCodes);
  }, [selectedRole, selectedRolePermissions, editedPermCodes]);

  function openCreate() {
    setEditingRole(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(role: Role) {
    setEditingRole(role);
    form.setFieldsValue({
      name: role.name,
      description: role.description || "",
    });
    setModalOpen(true);
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingRole) {
        // 只更新名称和描述，权限在外层单独编辑
        await api.patch(`/rbac/roles/${editingRole.id}`, {
          name: values.name,
          description: values.description || "",
        });
        message.success("更新成功");
      } else {
        // 新建角色：带上当前选中的权限列表
        await api.post("/rbac/roles", {
          ...values,
          permissionCodes: editedPermCodes,
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

  async function handleDelete(role: Role) {
    // 系统角色不允许删除
    if (role.is_system) {
      message.error("系统角色不能删除");
      return;
    }

    setSaving(true);
    try {
      await api.delete(`/rbac/roles/${role.id}`);
      message.success("删除成功");
      if (selectedRoleId === role.id) {
        setSelectedRoleId(
          roles.length > 1
            ? roles.find((r) => r.id !== role.id)?.id || null
            : null,
        );
      }
      await loadData();
    } catch (err: any) {
      message.error(err.response?.data?.message || "删除失败");
    } finally {
      setSaving(false);
    }
  }

  // 处理权限勾选变更
  function handlePermissionChange(code: string, checked: boolean) {
    if (checked) {
      setEditedPermCodes([...editedPermCodes, code]);
    } else {
      setEditedPermCodes(editedPermCodes.filter((c) => c !== code));
    }
  }

  // 保存角色权限
  async function handleSavePermissions(role: Role) {
    // 检查是否有实际变更
    if (!hasPermissionChanged) {
      message.info("权限未发生变化，无需保存");
      return;
    }

    // 二次确认对话框
    modal.confirm({
      title: "确认保存权限",
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            保存后将立即生效，<strong>相关用户的登录状态会被清除</strong>
            ，需要重新登录才能获取最新权限。
          </p>
          <p style={{ color: "#ff4d4f", marginTop: 8 }}>
            请确认其他管理员没有未保存的数据后再继续。
          </p>
        </div>
      ),
      okText: "确定保存",
      cancelText: "取消",
      okType: "primary",
      onOk: async () => {
        try {
          setSaving(true);
          await api.patch(`/rbac/roles/${role.id}`, {
            permissionCodes: editedPermCodes,
          });
          message.success("权限保存成功");

          // 只刷新当前角色的权限（listRoles 不返回 permissions，需单独获取）
          const { data: updatedRole } = await api.get(`/rbac/roles/${role.id}`);
          setRoles((prev) =>
            prev.map((r) => (r.id === role.id ? updatedRole : r)),
          );

          // 提示用户重新登录
          Modal.info({
            title: "权限已更新",
            content: "权限配置已变更，请相关用户重新登录以获取最新权限。",
            okText: "知道了",
          });
        } catch (err: any) {
          message.error(err.response?.data?.message || "保存失败");
        } finally {
          setSaving(false);
        }
      },
    });
  }

  // 获取角色类型标签
  function getRoleTypeTag(type: string) {
    switch (type) {
      case "admin":
        return <Tag color="red">管理员</Tag>;
      case "dept_admin":
        return <Tag color="orange">部门管理员</Tag>;
      default:
        return <Tag>自定义</Tag>;
    }
  }

  // 按权限资源分组并排序（权限管理在前，文档管理在后）
  const groupedPermissions = useMemo(() => {
    const groups = permissions.reduce(
      (acc, perm) => {
        if (!acc[perm.resource]) {
          acc[perm.resource] = [];
        }
        acc[perm.resource].push(perm);
        return acc;
      },
      {} as Record<string, Permission[]>,
    );

    // 自定义排序：rbac（权限管理）在前，document（文档管理）在后
    const sortedEntries = Object.entries(groups).sort(([a], [b]) => {
      const order = { rbac: 0, document: 1 };
      return (
        (order[a as keyof typeof order] ?? 99) -
        (order[b as keyof typeof order] ?? 99)
      );
    });

    return Object.fromEntries(sortedEntries);
  }, [permissions]);

  if (loading)
    return <Spin style={{ display: "block", margin: "40px auto" }} />;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          🔑 角色管理
        </Title>
        <Can permission="rbac:write">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建角色
          </Button>
        </Can>
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, overflow: "hidden" }}>
        {/* 左侧角色列表 */}
        <div
          style={{
            width: 240,
            background: "#fff",
            borderRadius: 8,
            overflow: "auto",
          }}
        >
          <List
            dataSource={roles}
            renderItem={(role) => (
              <List.Item
                key={role.id}
                style={{
                  cursor: "pointer",
                  padding: "12px 16px",
                  background:
                    selectedRoleId === role.id ? "#e6f7ff" : "transparent",
                  borderBottom: "1px solid #f0f0f0",
                  transition: "all 0.2s",
                }}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  <Text strong>{role.name}</Text>
                  <Can permission="rbac:write">
                    <Dropdown
                      menu={{
                        items: [
                          {
                            key: "edit",
                            icon: <EditOutlined />,
                            label: "编辑角色",
                          },
                          ...(role.is_system
                            ? []
                            : [
                                {
                                  key: "delete",
                                  icon: <DeleteOutlined />,
                                  label: "删除角色",
                                  danger: true,
                                },
                              ]),
                        ],
                        onClick: ({ key }) => {
                          if (key === "edit") {
                            openEdit(role);
                          } else if (key === "delete") {
                            modal.confirm({
                              title: "确定要删除该角色吗？",
                              content: "关联的用户角色分配也将被移除。",
                              okText: "确定",
                              cancelText: "取消",
                              okType: "danger",
                              onOk: () => handleDelete(role),
                            });
                          }
                        },
                      }}
                      trigger={["click"]}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<MoreOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  </Can>
                </div>
              </List.Item>
            )}
          />
        </div>

        {/* 右侧权限详情 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            background: "#fff",
            borderRadius: 8,
            height: "100%",
          }}
        >
          {selectedRole ? (
            <>
              {/* 标题栏：角色名称 + 保存按钮 */}
              <div
                style={{
                  display: "flex",
                  padding: 24,
                  paddingBottom: 12,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    权限配置
                  </Title>
                  <Text type="secondary">
                    {selectedRole.description || "暂无描述"}
                  </Text>
                </div>
                {selectedRole.type !== "admin" && (
                  <Can permission="rbac:write">
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={() => handleSavePermissions(selectedRole)}
                      disabled={!hasPermissionChanged}
                    >
                      保存权限
                    </Button>
                  </Can>
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: 24,
                  paddingRight: 12,
                }}
              >
                {Object.keys(groupedPermissions).length === 0 ? (
                  <Empty description="暂无权限数据" />
                ) : (
                  <>
                    {Object.entries(groupedPermissions).map(
                      ([resource, perms]) => (
                        <div key={resource} style={{ marginBottom: 32 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 16,
                            }}
                          >
                            <Title
                              level={5}
                              style={{ margin: 0, color: "#1890ff" }}
                            >
                              {resource === "document"
                                ? "📄 文档管理"
                                : "🔐 权限管理"}
                            </Title>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 12,
                            }}
                          >
                            {perms.map((perm) => {
                              // 管理员角色默认显示全部权限选中
                              const isChecked =
                                selectedRole.type === "admin"
                                  ? true
                                  : editedPermCodes.includes(perm.code);
                              return (
                                <div
                                  key={perm.id}
                                  style={{
                                    padding: "12px 16px",
                                    border: `1px solid ${isChecked ? "#1890ff" : "#d9d9d9"}`,
                                    borderRadius: 8,
                                    background: isChecked
                                      ? "#e6f7ff"
                                      : "#fafafa",
                                    width: 240,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    if (selectedRole.type !== "admin") {
                                      handlePermissionChange(
                                        perm.code,
                                        !isChecked,
                                      );
                                    }
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      marginBottom: 4,
                                      alignItems: "center",
                                    }}
                                  >
                                    <Checkbox
                                      checked={isChecked}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) =>
                                        handlePermissionChange(
                                          perm.code,
                                          e.target.checked,
                                        )
                                      }
                                      disabled={selectedRole.type === "admin"}
                                    ></Checkbox>
                                    <Text strong style={{ marginLeft: 8 }}>
                                      {perm.name}
                                    </Text>
                                  </div>
                                  {perm.description && (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: "#666",
                                        marginTop: 4,
                                      }}
                                    >
                                      {perm.description}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ),
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <Empty description="请选择一个角色查看权限" />
          )}
        </div>
      </div>

      {/* 编辑/新建角色弹窗 */}
      <Modal
        title={editingRole ? "编辑角色" : "新建角色"}
        open={modalOpen}
        onCancel={() => !saving && setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: "请输入角色名称" }]}
          >
            <Input placeholder="角色名称" disabled={saving} />
          </Form.Item>
          <Form.Item name="description" label="角色描述">
            <Input.TextArea
              placeholder="角色描述（可选）"
              rows={3}
              disabled={saving}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
