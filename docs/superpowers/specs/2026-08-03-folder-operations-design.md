# 文件夹操作菜单优化

**日期**: 2026-08-03  
**状态**: 设计确认，待实施

---

## 背景

知识库文件夹系统已上线，后端 `renameFolder` / `moveFolder` / `deleteFolder` API 均已完成，但前端仅在 Tree 节点上通过右键菜单暴露重命名和删除，移动功能完全缺失。用户反馈"没有"这些功能——右键菜单不够直观。

## 改动范围

仅前端，后端 API 已就绪无需改动。

| 后端 API | 方法 | 状态 |
|----------|------|------|
| 重命名 | `PATCH /knowledge-bases/folders/:id` | ✅ 已就绪 |
| 删除 | `DELETE /knowledge-bases/folders/:id` | ✅ 已就绪 |
| 移动 | `POST /knowledge-bases/folders/:id/move` | ✅ 已就绪 |

---

## 一、交互设计

### 1.1 Tree 节点

当前右键菜单改为三点 `⋮` 图标，**一直可见**，点击弹出 Dropdown：

```
📁 文件夹名称                    [ ⋮ ]
```

Dropdown 菜单项：
- 新建子文件夹
- 重命名
- 移动到…
- ──（分割线）
- 删除（红色危险项）

### 1.2 移动文件夹弹窗（新增）

- 标题："移动文件夹 — {文件夹名}"
- TreeSelect 展示当前知识库完整文件夹树
- 排除自身及所有子节点（防循环引用）
- 可清空 = 移到知识库根目录
- 确定后调用 `POST /knowledge-bases/folders/:id/move { new_parent_id }`
- `new_parent_id` 为 `null` 时表示移到根目录

---

## 二、文件改动

| # | 文件 | 操作 |
|---|------|------|
| 1 | `apps/web/src/pages/knowledge/FolderBrowsePage.tsx` | 修改 titleRender：三点图标 + Dropdown，移除右键菜单 trigger |
| 2 | `apps/web/src/components/knowledge/MoveFolderModal.tsx` | **新建**：移动文件夹弹窗组件 |

### 2.1 FolderBrowsePage 改动

- `titleRender` 中 `Dropdown trigger={['contextMenu']}` → `Dropdown` 由显式 `<Button icon={<EllipsisOutlined />}>` 触发
- 新增 `handleMoveFolder(id)` → 打开 MoveFolderModal
- 新增 state：`moveFolderTarget`（要移动的文件夹）
- 导入 `EllipsisOutlined`

### 2.2 MoveFolderModal（新建）

```tsx
// Props
interface Props {
  open: boolean;
  folder: { id: string; name: string } | null;  // 要移动的文件夹
  kbId: string;
  folderTree: DataNode[];       // 完整文件夹树（用于构建 TreeSelect）
  allFolders: { id: string; parent_id: string | null; name: string }[];  // 用于排除自身及子孙
  onClose: () => void;
  onSuccess: () => void;
}
```

- 加载时收集自身及所有子孙 ID（通过 parent_id 递归），在 TreeSelect 选项中排除
- TreeSelect `allowClear`，placeholder = "留空则移到根目录"
- 提交：`POST /knowledge-bases/folders/:id/move { new_parent_id: targetId || null }`

### 2.3 FolderModal

无需改动，已支持新建和重命名两种模式。

---

## 三、不在范围

- 后端 API 变更（无需）
- 文件夹拖拽排序
- 批量操作
- 跨知识库移动
