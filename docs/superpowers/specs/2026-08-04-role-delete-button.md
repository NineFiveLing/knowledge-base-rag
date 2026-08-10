# 角色删除按钮问题说明

**问题时间**：2026-08-04
**问题描述**：角色列表没有显示删除按钮

---

## 🔍 问题原因

### 当前角色数据

| 角色名称 | code | is_system | 删除按钮 |
|---------|------|-----------|---------|
| 管理员 | admin | true | ❌ 不显示 |
| 部门管理员 | dept_admin | true | ❌ 不显示 |
| 普通员工 | user | true | ❌ 不显示 |

### 代码逻辑

```tsx
{!role.is_system && (  // ← 只有非系统角色才显示
  <Can permission="rbac:write" key="delete">
    <Popconfirm>
      <Button icon={<DeleteOutlined />} />
    </Popconfirm>
  </Can>
)}
```

**结论**：✅ **代码逻辑正确**，因为所有角色都是系统角色（`is_system=true`），所以没有删除按钮是**符合预期的行为**。

---

## ✅ 解决方案

### 方案 1：创建自定义角色（推荐）

已在数据库创建测试角色：

```sql
INSERT INTO roles (name, code, type, is_system)
VALUES ('测试角色', 'test_role', 'custom', false);
```

**效果**：
- ✅ "测试角色"会显示删除按钮
- ✅ 系统角色仍然没有删除按钮

---

### 方案 2：修改"普通员工"为非系统角色

如果期望"普通员工"可以被删除：

```sql
UPDATE roles SET is_system = false WHERE code = 'user';
```

**影响**：
- ⚠️ "普通员工"会显示删除按钮
- ⚠️ 用户可以删除"普通员工"角色
- ⚠️ 可能导致系统功能异常（如果其他地方依赖此角色）

**建议**：仅用于测试，生产环境不建议

---

## 📊 角色删除规则

### 预期行为

| 角色类型 | is_system | 删除按钮 | 是否可删除 |
|---------|-----------|---------|-----------|
| 管理员 | true | ❌ 隐藏 | ❌ 不可删除 |
| 部门管理员 | true | ❌ 隐藏 | ❌ 不可删除 |
| 普通员工 | true | ❌ 隐藏 | ❌ 不可删除 |
| 自定义角色 | false | ✅ 显示 | ✅ 可删除 |

### 代码实现

**前端保护（UI 层）**：
```tsx
// 1. 删除按钮显示逻辑
{!role.is_system && (
  <Can permission="rbac:write" key="delete">
    <Popconfirm>
      <Button icon={<DeleteOutlined />} />
    </Popconfirm>
  </Can>
)}

// 2. 删除函数再次检查
async function handleDelete(role: Role) {
  if (role.is_system) {
    message.error('系统角色不能删除');
    return;
  }
  // ...删除逻辑
}
```

**建议补充（后端 API 层）**：
```typescript
// rbac.service.ts
async deleteRole(id: string) {
  const [role] = await mgr.query(
    'SELECT id, is_system FROM roles WHERE id = $1',
    [id]
  );
  if (!role) throw new NotFoundException('角色不存在');

  // 系统角色保护
  if (role.is_system) {
    throw new BadRequestException('系统角色不能删除');
  }

  // ...删除逻辑
}
```

---

## 🧪 验证步骤

### 1. 刷新角色管理页面

```bash
# 如果前端服务正在运行，刷新浏览器即可
# 否则启动服务
npm run dev:web
```

### 2. 查看角色列表

**预期看到**：
- ✅ 管理员（无删除按钮）
- ✅ 部门管理员（无删除按钮）
- ✅ 普通员工（无删除按钮）
- ✅ **测试角色**（**有删除按钮**）

### 3. 测试删除功能

1. 点击"测试角色"的删除按钮
2. 确认删除对话框
3. 验证角色被删除
4. 验证列表刷新

---

## 📋 问题总结

| 项目 | 状态 |
|------|------|
| **问题原因** | 所有角色都是系统角色（is_system=true） |
| **代码逻辑** | ✅ 正确（按设计实现） |
| **预期行为** | ✅ 符合预期（系统角色无删除按钮） |
| **测试方案** | ✅ 已创建自定义角色用于测试 |
| **后端保护** | ⚠️ 建议补充（防止直接调用 API） |

---

## 🚀 建议

1. **立即**：刷新前端页面，查看"测试角色"的删除按钮
2. **测试**：验证删除功能正常工作
3. **长期**：补充后端 API 保护，防止绕过前端直接删除系统角色

---

**问题已解决 ✅ | 删除按钮逻辑正确 ✅ | 测试角色已创建 ✅**
