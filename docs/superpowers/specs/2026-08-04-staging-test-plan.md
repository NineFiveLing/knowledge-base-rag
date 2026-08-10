# 暂存区变更自测清单

**生成时间**：2026-08-04
**测试范围**：暂存区 30 文件（+1337 / -207 行）
**重点模块**：RBAC 权限系统、TTS 语音功能

---

## 📋 前置条件

1. 后端服务已启动（端口默认 3000）
2. 前端开发服务器已启动（端口默认 5173）
3. 已登录管理员账号
4. 浏览器控制台已打开（F12）

---

## 🔴 严重问题（阻塞构建）

### ❌ 后端类型错误（3 个）

**影响**：后端无法构建，服务无法启动

| # | 文件 | 行号 | 问题 | 修复建议 |
|---|------|------|------|----------|
| 1 | `apps/server/src/modules/auth/dto/register.dto.ts` | 19, 23 | `IsOptional` 未导入 | 第 1 行添加 `IsOptional` 到 import |
| 2 | `apps/server/src/modules/user/users.controller.ts` | 9 | 导入不存在的 `AssignRolesDto` | 改为 `UpdateUserRolesDto` |

**验证步骤**：
```bash
cd apps/server && npx tsc --noEmit
npm run build
```

---

## 🛡️ RBAC 权限系统测试

### 1. 用户管理页面（新增）

**文件**：`apps/web/src/pages/admin/UserManagePage.tsx`

#### 1.1 页面加载
- [ ] 访问 `/admin/users`，验证重定向到登录页（未登录时）
- [ ] 登录后访问，验证页面正常加载
- [ ] 验证三列数据并行加载：用户列表、部门列表、角色列表
- [ ] 验证 Loading 状态显示正确
- [ ] 验证加载失败时显示错误提示

#### 1.2 用户列表
- [ ] 验证表格显示：用户名、真实姓名、邮箱、手机号、部门、角色、创建时间
- [ ] 验证角色以 Tag 组件显示（不同角色类型不同颜色）
- [ ] 验证部门名称正确关联显示
- [ ] 验证空状态提示（无用户时）

#### 1.3 搜索功能
- [ ] 在搜索框输入用户名，验证列表过滤
- [ ] 输入真实姓名，验证列表过滤
- [ ] 清空搜索框，验证恢复全量列表

#### 1.4 创建用户
- [ ] 点击"新建用户"按钮，验证模态框打开
- [ ] 表单字段：用户名、密码、真实姓名、邮箱（可选）、手机号（可选）、部门（必选）、角色（多选）
- [ ] 提交必填字段为空，验证前端校验提示
- [ ] 提交成功，验证模态框关闭、列表刷新、成功提示
- [ ] 提交失败，验证错误提示

#### 1.5 编辑用户
- [ ] 点击用户行"编辑"按钮，验证模态框打开并回填数据
- [ ] 修改真实姓名/邮箱/手机号/部门，保存成功
- [ ] 验证角色选择器回填正确
- [ ] 验证系统用户（如 admin）不可编辑（根据业务逻辑）

#### 1.6 删除用户
- [ ] 点击用户行"删除"按钮，验证确认弹窗
- [ ] 确认删除，验证用户从列表移除、成功提示
- [ ] 取消删除，验证用户保留在列表

#### 1.7 权限控制
- [ ] 使用无 `rbac:read` 权限账号登录，验证页面访问被拒绝（403）
- [ ] 使用无 `rbac:write` 权限账号，验证创建/编辑/删除按钮禁用或隐藏
- [ ] 验证 `Can` 组件权限标签正确渲染

---

### 2. 角色管理页面（增强）

**文件**：`apps/web/src/pages/admin/RoleManagePage.tsx`

#### 2.1 页面布局
- [ ] 验证左右分栏布局（角色列表 + 权限配置）
- [ ] 验证角色列表显示：名称、编码、类型、描述、系统标识、关联用户数
- [ ] 验证权限树形控件显示正确

#### 2.2 角色 CRUD
- [ ] 新建角色：填写名称、编码、类型、描述，保存成功
- [ ] 编辑角色：修改信息后保存
- [ ] 删除角色：系统角色应不可删除，自定义角色可删除
- [ ] 验证角色编码唯一性校验

#### 2.3 权限分配
- [ ] 选中角色，右侧显示权限配置面板
- [ ] 勾选/取消权限，保存后验证生效
- [ ] 验证权限树按资源分组显示
- [ ] 验证权限变更实时反映到用户权限检查

---

### 3. 权限变更监听 Hook

**文件**：`apps/web/src/hooks/usePermissionChange.ts`

#### 3.1 权限刷新机制
- [ ] 角色权限变更后，验证前端权限缓存自动刷新
- [ ] 验证 `Can` 组件在权限变更后重新渲染
- [ ] 验证多标签页/窗口权限同步（如适用）

---

## 🎤 TTS 语音功能测试

### 4. 全局 TTS 控制

**文件**：`apps/web/src/components/chat/TtsGlobalControl.tsx`

#### 4.1 自动播放开关
- [ ] 验证开关显示"自动播放"标签
- [ ] 切换开关，验证状态反转
- [ ] 刷新页面，验证开关状态持久化（localStorage）
- [ ] 验证关闭自动播放后，新消息不自动播放

---

### 5. 单条消息 TTS 控制

**文件**：`apps/web/src/components/chat/MessageTtsButton.tsx`（推断存在）

#### 5.1 消息级控制
- [ ] 验证每条消息显示 TTS 播放按钮
- [ ] 点击播放，验证音频开始播放、按钮状态变化
- [ ] 点击停止，验证音频停止、按钮重置
- [ ] 验证同消息重复点击播放，无重复播放/冲突

---

### 6. TTS 播放器核心逻辑

**文件**：`apps/web/src/hooks/useTtsPlayer.ts`

#### 6.1 播放生命周期
- [ ] 验证消息进入 `loading` → `playing` → `idle` 状态流转
- [ ] 验证音频缓冲区正确调度（无重叠/卡顿）
- [ ] 验证 `audioEnd` 事件后延迟清理（drain timer）

#### 6.2 重播保护
- [ ] 验证同 `messageId` 重播时，旧的 `AudioContext` 正确关闭
- [ ] 验证旧的 `drainTimer` 正确取消，不误删新播放条目
- [ ] 验证并发播放时，只有最新播放生效

#### 6.3 错误处理
- [ ] 模拟 TTS 错误事件，验证停止播放、控制台警告、状态重置
- [ ] 验证网络断开时 TTS  gracefully degrade

#### 6.4 stopAll 功能
- [ ] 验证 `stopAll` 停止所有正在播放的消息
- [ ] 验证所有消息状态重置为 `idle`

---

### 7. 语音输入按钮

**文件**：`apps/web/src/components/chat/VoiceButton.tsx`

#### 7.1 录音状态切换
- [ ] 验证初始状态显示"点击说话" + 消息图标
- [ ] 点击按钮，验证切换到"点击停止" + 声音图标
- [ ] 再次点击，验证停止录音、恢复初始状态
- [ ] 验证 CSS 类 `recording` 在录音状态时添加

---

### 8. ChatPage 集成

**文件**：`apps/web/src/pages/chat/ChatPage.tsx`

#### 8.1 TTS 集成
- [ ] 验证聊天消息列表正确集成 TTS 播放器
- [ ] 验证全局 TTS 控制组件显示在聊天区域
- [ ] 验证发送消息后，根据自动播放设置决定是否播放
- [ ] 验证语音输入按钮功能正常

---

## 🔐 后端 API 验证

### 9. 用户管理 API

**文件**：`apps/server/src/modules/user/users.controller.ts`

```bash
# 测试命令（替换 <TOKEN> 为实际 JWT）
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/users
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/users/<USER_ID>
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/users/<USER_ID>/roles
```

- [ ] `GET /users` — 列表查询，验证权限 `rbac:read`
- [ ] `GET /users/:id` — 详情查询
- [ ] `PATCH /users/:id` — 更新信息，验证权限 `rbac:write`
- [ ] `PATCH /users/:id/roles` — 分配角色，验证权限 `rbac:write`
- [ ] `GET /users/:id/roles` — 查询用户角色

### 10. 角色管理 API

```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/rbac/roles
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/rbac/permissions
```

- [ ] `GET /rbac/roles` — 角色列表
- [ ] `GET /rbac/permissions` — 权限列表

### 11. 部门管理 API

**文件**：`apps/server/src/modules/user/departments.controller.ts`

```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/departments
```

- [ ] `GET /departments` — 部门列表

---

## 🔑 认证与权限守卫

### 12. JWT 策略

**文件**：`apps/server/src/modules/auth/strategies/jwt.strategy.ts`

- [ ] 验证过期 Token 正确拒绝
- [ ] 验证无效 Token 返回 401
- [ ] 验证有效 Token 正确解析用户信息

### 13. 权限守卫

**文件**：`apps/server/src/common/guards/permission.guard.ts`

- [ ] 验证无权限请求返回 403
- [ ] 验证白名单路由（如登录）绕过权限检查
- [ ] 验证权限码匹配逻辑（`resource:action` 格式）

---

## 📊 测试结果总结

| 模块 | 状态 | 问题数 | 备注 |
|------|------|--------|------|
| 构建检查（后端） | ❌ 失败 | 3 | 阻塞问题，需立即修复 |
| 构建检查（前端） | ✅ 通过 | 0 | - |
| 类型检查（后端） | ❌ 失败 | 3 | 同上 |
| 类型检查（前端） | ✅ 通过 | 0 | - |
| RBAC 用户管理 | ⏳ 待测 | - | 新增页面 |
| RBAC 角色管理 | ⏳ 待测 | - | 增强功能 |
| TTS 全局控制 | ⏳ 待测 | - | 新增功能 |
| TTS 单条控制 | ⏳ 待测 | - | 新增功能 |
| TTS 播放器核心 | ⏳ 待测 | - | 重构优化 |
| 权限守卫 | ⏳ 待测 | - | 逻辑验证 |

---

## 🚀 下一步行动

1. **立即修复** 2 个后端类型错误（~5 分钟）
2. **重新构建** 验证后端通过
3. **执行手动测试** 按模块逐项验证（预计 30-60 分钟）
4. **记录缺陷** 发现的问题录入缺陷跟踪

---

**测试人员**：____________
**测试日期**：____________
**测试环境**：____________
