# 前端迁移至 Ant Design — 设计文档

> 目标：将前端 UI 层从纯手写 HTML/CSS 全量迁移至 Ant Design 5
> 日期：2026-07-30

---

## 1. 背景与动机

当前前端（React 19 + TypeScript + Vite）未使用任何 UI 框架，所有组件均为原生 HTML 元素配合内联样式和一个 48 行 `global.css` 实现。随着功能页面增长（7 页），手动维护一致性日益困难：表格/Modal/表单/消息提示等常见模式反复手写，RoleManagePage 单个文件 280 行中大量内联样式。

迁移到 Ant Design 5 可消除这类重复代码，获得开箱即用的主题一致性、内置的表格分页排序筛选、Form 校验、Modal 管理、消息提示等能力。

## 2. 方案选型

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 迁移范围 | 全量替换 | 无旧框架冲突，一步到位 |
| UI 库 | antd 5.x | 最新稳定版，内置 CSS-in-JS |
| 图标 | @ant-design/icons | 按需导入，与 antd 配套 |
| 高级组件 | 不用 Pro Components | 当前复杂度不需要 ProLayout/ProTable |

## 3. 组件映射

| 现有 | 替换为 |
|------|--------|
| Layout (sidebar + topbar) | `Layout.Sider` + `Menu` + `Layout.Header` + `Space` + `Avatar` + `Dropdown` |
| LoginPage | `Card` + `Tabs` + `Form` + `Input` / `Input.Password` + `Button` + `App.message` |
| ChatPage 输入区 | `Input.Search` + `Button` + `Tag`（来源标签）；气泡保留自定义 |
| KnowledgeBasePage | `Table` + `Tag` + `Empty` + `Spin` |
| DocumentUploadPage | `Upload.Dragger` + `Progress` + `Card` |
| DocumentManagePage | `Table` + `Modal` + `Popconfirm` + `Button` + `Tag` |
| RoleManagePage | `Table` + `Modal` + `Form` + `Input` + `Checkbox.Group` + `Popconfirm` |
| AnalyticsPage | `Card` + `Statistic` + `Table` + `Spin` |
| Can (权限门) | 保留 — 纯逻辑组件，children 自然用 antd |
| VoiceButton | 保留 — Web Audio API 定制逻辑 |

## 4. 样式策略

- antd 5 内置 CSS-in-JS，组件自带完整样式
- `global.css` 从 ~50 行缩减到 ~15 行：仅保留基础 reset、字体系列、聊天气泡样式
- 删除：登录页/布局/表格/表单/上传区的自定义样式（全部被 antd 替代）

## 5. 主题配置

```tsx
// main.tsx
<ConfigProvider theme={{
  token: {
    colorPrimary: '#667eea',
    borderRadius: 6,
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
}}>
  <AntApp>
    <App />
  </AntApp>
</ConfigProvider>
```

- `colorPrimary` 延续现有品牌色，用户视觉无感知
- `AntApp` 提供 `message` / `notification` / `Modal` 静态方法上下文

## 6. 实施步骤

| 步序 | 内容 | 预估 |
|:--:|------|:--:|
| 1 | 安装 antd + @ant-design/icons，配置 ConfigProvider，清理 global.css | 15min |
| 2 | 重构 Layout（侧边栏 Menu + 顶栏 Header） | 30min |
| 3 | 重构简单页面：LoginPage / KnowledgeBasePage / AnalyticsPage | 30min |
| 4 | 重构表单页面：DocumentUploadPage（Upload.Dragger） | 20min |
| 5 | 重构 DocumentManagePage（表格+Modal预览+Popconfirm删除） | 30min |
| 6 | 重构 RoleManagePage（表格+创建Modal+编辑Modal+删除确认+权限Checkbox） | 40min |
| 7 | 重构 ChatPage（输入区换 antd，气泡保留自定义） | 20min |
| — | 联调验证：`pnpm build` + 路由切换 + 各页面功能检查 | 15min |
| **合计** | | **~3h** |

## 7. 不改动的文件

- `App.tsx` — 路由结构不变
- `vite.config.ts` — 构建配置不变
- `api.ts` — axios 封装不变
- `auth.store.ts` — Zustand store 不变
- `useSSE.ts` / `useVoiceChat.ts` — hooks 不变
- `Can.tsx` — 权限门纯逻辑不变
- `VoiceButton.tsx` — 音频采集逻辑不变

## 8. 验收标准

- [ ] `pnpm build` TypeScript 编译零错误
- [ ] 全 7 个页面路由切换正常，无白屏
- [ ] 登录/注册表单校验与提交正常
- [ ] 文档上传拖拽/进度/结果展示正常
- [ ] 文档列表分页/预览 Modal/删除确认正常
- [ ] 角色管理创建/编辑/删除/权限分配正常
- [ ] 聊天输入发送+SSE 流式接收正常
- [ ] 语音按钮录制/停止正常
- [ ] `global.css` 仅剩基础 reset + 聊天气泡
