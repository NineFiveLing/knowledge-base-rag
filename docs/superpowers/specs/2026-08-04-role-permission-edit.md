# 角色管理权限编辑功能实现报告

**完成时间**：2026-08-04
**修改文件**：`apps/web/src/pages/admin/RoleManagePage.tsx`

---

## ✅ 实现功能清单

### 1. 布局重构 ✅

**修改前**：
```
┌─────────────────────────────────────────┐
│ 权限配置                                 │
│ 角色描述                                 │
│                                         │
│ [只读权限卡片]                           │
└─────────────────────────────────────────┘
```

**修改后**：
```
┌───────────────────────────────────────────────────────────┐
│ {角色名} - 权限配置              [💾 保存权限] ← 新增      │
│ 角色描述                                                   │
├───────────────────────────────────────────────────────────┤
│ 📄 文档管理                                                 │
│ [✓] 查看文档 (document:read)   [✓] 创建文档 (document:create)│
│ [ ] 删除文档 (document:delete)                              │
│                                                             │
│ 🔐 权限管理                                                 │
│ [✓] 查看权限 (rbac:read)     [✓] 管理权限 (rbac:write)      │
└───────────────────────────────────────────────────────────┘
```

**关键改动**：
- ✅ 标题栏增加保存按钮（右侧顶部）
- ✅ 保存按钮仅在 `type !== 'admin'` 时显示
- ✅ 保存按钮在有变更时才启用（`disabled={!hasPermissionChanged}`）

---

### 2. 权限直接编辑 ✅

**交互设计**：
- ✅ 每个权限卡片集成 Checkbox 组件
- ✅ 勾选/取消直接修改 `editedPermCodes` 状态
- ✅ 管理员角色（`type === 'admin'`）权限不可编辑
- ✅ 非系统角色（`!is_system`）权限不可编辑

**视觉反馈**：
- ✅ 勾选状态：蓝色边框 + 浅蓝背景
- ✅ 未勾选状态：灰色边框 + 浅灰背景
- ✅ 右侧显示"已授权"/"未授权"文字标签
- ✅ 绿色 ✓ / 灰色 ✗ 图标辅助识别

---

### 3. 权限变更检测 ✅

**实现逻辑**：
```typescript
const hasPermissionChanged = useMemo(() => {
  if (!selectedRole) return false;
  const currentCodes = selectedRolePermissions.map(p => p.code).sort();
  const editedCodes = [...editedPermCodes].sort();
  return JSON.stringify(currentCodes) !== JSON.stringify(editedCodes);
}, [selectedRole, selectedRolePermissions, editedPermCodes]);
```

**特性**：
- ✅ 使用 `useMemo` 优化性能
- ✅ 数组排序后 JSON 对比，顺序无关
- ✅ 选中角色变化时自动重置编辑状态

---

### 4. 保存确认对话框 ✅

**触发条件**：
1. 点击"保存权限"按钮
2. 权限有实际变更（`hasPermissionChanged === true`）

**对话框内容**：
```
┌──────────────────────────────────────────┐
│ ⚠️ 确认保存权限                           │
├──────────────────────────────────────────┤
│                                          │
│ 保存后将立即生效，相关用户的登录状态       │
│ 会被清除，需要重新登录才能获取最新权限。   │
│                                          │
│ 请确认其他管理员没有未保存的数据后再继续。 │
│                                          │
│         [取消]        [确定保存]          │
└──────────────────────────────────────────┘
```

**二次确认内容**：
- ⚠️ 警告图标 + 红色标题
- 📋 说明后果（用户需重新登录）
- 🔒 提醒检查其他管理员操作

---

### 5. 保存成功提示 ✅

**成功流程**：
```
保存成功
  ↓
toast.success('权限保存成功')
  ↓
Modal.info({
  title: '权限已更新',
  content: '权限配置已变更，请相关用户重新登录以获取最新权限。',
  okText: '知道了'
})
```

**无变更流程**：
```
点击保存（无变更）
  ↓
toast.info('权限未发生变化，无需保存')
  ↓
不显示确认对话框
```

---

## 🎨 UI/UX 改进

### 权限卡片新布局

**修改前**（只读）：
```
┌────────────────────────────┐
│ ✓ 查看文档                 │  ← 仅图标
│   document:read            │
│   可以查看文档内容          │
└────────────────────────────┘
```

**修改后**（可编辑）：
```
┌────────────────────────────────────┐
│ [✓] 查看文档  已授权 ✓             │  ← Checkbox + 状态标签
│             document:read          │
│             可以查看文档内容        │
└────────────────────────────────────┘
```

### 禁用状态

**不可编辑的角色**：
- ❌ 管理员角色（`type === 'admin'`）
- ❌ 非系统角色（`!is_system`）

**视觉表现**：
- Checkbox 显示为禁用状态（灰色）
- 保存按钮仅在可编辑角色下显示

---

## 🔧 技术实现

### 新增状态

```typescript
// 编辑中的权限 code 列表
const [editedPermCodes, setEditedPermCodes] = useState<string[]>([]);

// 权限是否有变更（useMemo 优化）
const hasPermissionChanged = useMemo(() => {
  if (!selectedRole) return false;
  const currentCodes = selectedRolePermissions.map(p => p.code).sort();
  const editedCodes = [...editedPermCodes].sort();
  return JSON.stringify(currentCodes) !== JSON.stringify(editedCodes);
}, [selectedRole, selectedRolePermissions, editedPermCodes]);
```

### 新增函数

```typescript
// 处理单个权限勾选
function handlePermissionChange(code: string, checked: boolean) {
  if (checked) {
    setEditedPermCodes([...editedPermCodes, code]);
  } else {
    setEditedPermCodes(editedPermCodes.filter(c => c !== code));
  }
}

// 保存权限（含确认对话框）
async function handleSavePermissions(role: Role) {
  // 1. 检查变更
  if (!hasPermissionChanged) {
    message.info('权限未发生变化，无需保存');
    return;
  }

  // 2. 二次确认
  Modal.confirm({
    title: '确认保存权限',
    content: '保存后将立即生效，相关用户的登录状态会被清除...',
    onOk: async () => {
      // 3. 提交后端
      await api.patch(`/rbac/roles/${role.id}`, {
        permissionCodes: editedPermCodes,
      });

      // 4. 刷新数据
      await loadData();

      // 5. 提示重新登录
      Modal.info({
        title: '权限已更新',
        content: '权限配置已变更，请相关用户重新登录以获取最新权限。',
      });
    },
  });
}
```

### 依赖初始化

```typescript
// 当选中角色变化时，重置编辑状态
useEffect(() => {
  if (selectedRole) {
    setEditedPermCodes(selectedRolePermissions.map(p => p.code));
  }
}, [selectedRoleId, selectedRolePermissions]);
```

---

## 📊 对比总结

| 功能 | 修改前 | 修改后 |
|------|--------|--------|
| **权限编辑位置** | 模态框中编辑 | 详情页直接编辑 |
| **保存按钮位置** | 模态框底部 | 右侧顶部 |
| **权限展示** | 只读卡片 | 可勾选 Checkbox |
| **变更检测** | ❌ 无 | ✅ 自动检测 |
| **二次确认** | ❌ 无 | ✅ 保存前确认 |
| **重新登录提示** | ❌ 无 | ✅ 保存后提示 |
| **管理员角色保护** | ❌ 无 | ✅ 不可编辑 |

---

## 🧪 测试建议

### 手动测试场景

1. **基础编辑**
   - [ ] 进入角色管理页面，默认选中第一个角色
   - [ ] 勾选/取消权限，验证保存按钮状态变化
   - [ ] 点击保存，验证确认对话框显示

2. **二次确认**
   - [ ] 确认保存，验证权限生效
   - [ ] 取消保存，验证权限不变

3. **无变更提示**
   - [ ] 未修改权限直接点击保存，验证提示"权限未发生变化"

4. **管理员保护**
   - [ ] 选择管理员角色，验证保存按钮隐藏
   - [ ] 验证 Checkbox 禁用状态

5. **重新登录提示**
   - [ ] 保存成功后验证 Modal.info 显示
   - [ ] 验证 toast 成功提示

---

## 🚀 后续优化（可选）

1. **实时保存**：取消"保存"按钮，勾选后自动保存（需防抖）
2. **权限搜索**：权限列表过长时增加搜索过滤
3. **批量操作**：支持批量启用/禁用权限
4. **权限分组折叠**：权限分组支持折叠/展开
5. **操作审计**：记录权限变更日志（谁、何时、修改了什么）

---

**实现完成 ✅ | 构建通过 ✅ | 可进入测试阶段**
