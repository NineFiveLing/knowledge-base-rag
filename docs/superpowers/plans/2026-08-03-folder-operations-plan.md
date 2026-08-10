# 文件夹操作菜单优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文件夹节点右侧显示三点菜单（⋮），包含重命名/移动/删除/新建子文件夹，去掉右键菜单；新增移动文件夹弹窗。

**Architecture:** Tree titleRender 内嵌 Dropdown（由 Button 触发），新增 MoveFolderModal 组件独立处理移动逻辑。后端 API 已就绪无需改动。

**Tech Stack:** React + Ant Design 5 + TypeScript

## Global Constraints

- 后端 API 已就绪：`PATCH /knowledge-bases/folders/:id`（重命名）、`POST /knowledge-bases/folders/:id/move`（移动）、`DELETE /knowledge-bases/folders/:id`（删除）
- 移动 API body：`{ new_parent_id: string | null }`（null = 移到根目录）
- Tree 节点数据来自 `GET /knowledge-bases/:kbId/folders`，扁平文件夹列表需额外维护用于 MoveFolderModal 排除祖先
- 代码风格遵循现有模式：antd 5、函数组件 + hooks、api 实例
- 编译验证命令：`cd apps/web && npx tsc --noEmit`

---

## File Structure Map

```
apps/web/src/
  pages/knowledge/
    FolderBrowsePage.tsx                  [MODIFY] titleRender 三点菜单 + 集成 MoveFolderModal
  components/knowledge/
    MoveFolderModal.tsx                   [CREATE] 移动文件夹弹窗
    FolderModal.tsx                       [NO CHANGE] 已支持新建/重命名
```

---

### Task 1: 新建 MoveFolderModal 组件

**Files:**
- Create: `apps/web/src/components/knowledge/MoveFolderModal.tsx`

**Interfaces:**
- Consumes: `POST /knowledge-bases/folders/:id/move`，body `{ new_parent_id: string | null }`
- Consumes: 完整文件夹扁平列表（含 id、parent_id、name），用于构建 TreeSelect 选项 + 排除自身及子孙
- Produces: `MoveFolderModal` 组件，props 见下方签名

**Component signature:**
```typescript
interface FolderNode {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  open: boolean;
  folder: FolderNode | null;   // 要移动的文件夹
  allFolders: FolderNode[];     // 当前 KB 下所有文件夹（扁平列表）
  onClose: () => void;
  onSuccess: () => void;
}
```

- [ ] **Step 1: 创建 MoveFolderModal 组件**

在 `apps/web/src/components/knowledge/MoveFolderModal.tsx` 新建文件：

```typescript
import { Modal, TreeSelect, App } from 'antd';
import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';

interface FolderNode {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  open: boolean;
  folder: FolderNode | null;
  allFolders: FolderNode[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function MoveFolderModal({ open, folder, allFolders, onClose, onSuccess }: Props) {
  const [targetParentId, setTargetParentId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  // 收集自身及所有子孙节点 ID（需要排除）
  const excludedIds = useMemo(() => {
    if (!folder) return new Set<string>();
    const ids = new Set<string>();
    ids.add(folder.id);
    // BFS/递归收集子节点
    const collectChildren = (parentId: string) => {
      allFolders.forEach(f => {
        if (f.parent_id === parentId && !ids.has(f.id)) {
          ids.add(f.id);
          collectChildren(f.id);
        }
      });
    };
    collectChildren(folder.id);
    return ids;
  }, [folder, allFolders]);

  // 构建 TreeSelect 数据（排除自身及子孙）
  const treeData = useMemo(() => {
    const availableFolders = allFolders.filter(f => !excludedIds.has(f.id));
    const buildTree = (parentId: string | null): any[] =>
      availableFolders
        .filter(f => f.parent_id === parentId)
        .map(f => ({
          title: f.name,
          value: f.id,
          key: f.id,
          children: buildTree(f.id),
        }));
    return buildTree(null);
  }, [allFolders, excludedIds]);

  useEffect(() => {
    if (open) {
      setTargetParentId(undefined);
    }
  }, [open]);

  const handleOk = async () => {
    if (!folder) return;
    setLoading(true);
    try {
      await api.post(`/knowledge-bases/folders/${folder.id}/move`, {
        new_parent_id: targetParentId || null,
      });
      message.success('文件夹已移动');
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '移动失败');
    } finally {
      setLoading(false);
    }
  };

  if (!folder) return null;

  return (
    <Modal
      title={`移动文件夹 — ${folder.name}`}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="移动"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
    >
      <p style={{ marginBottom: 8, color: '#666' }}>
        选择目标位置，留空则移到知识库根目录
      </p>
      <TreeSelect
        style={{ width: '100%' }}
        placeholder="留空则移到根目录"
        allowClear
        treeDefaultExpandAll
        treeData={treeData}
        value={targetParentId}
        onChange={(val) => setTargetParentId(val)}
      />
    </Modal>
  );
}
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/knowledge/MoveFolderModal.tsx
git commit -m "feat: 新增 MoveFolderModal 移动文件夹弹窗组件"
```

---

### Task 2: FolderBrowsePage Tree 三点菜单改造

**Files:**
- Modify: `apps/web/src/pages/knowledge/FolderBrowsePage.tsx`

**Interfaces:**
- Consumes: `MoveFolderModal` from Task 1
- Consumes: `EllipsisOutlined` from @ant-design/icons
- Modifies: `titleRender` — 去掉 `trigger={['contextMenu']}`，改为 `<Button icon={<EllipsisOutlined />}>` 显示触发 Dropdown

- [ ] **Step 1: 导入新依赖**

在文件顶部添加 import：

```typescript
import { EllipsisOutlined } from '@ant-design/icons';
import MoveFolderModal from '../../components/knowledge/MoveFolderModal';
```

`EllipsisOutlined` 加入已有 icons 的 import 行：
```typescript
import {
  FolderAddOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, DownloadOutlined, ArrowLeftOutlined,
  EllipsisOutlined,
} from '@ant-design/icons';
```

- [ ] **Step 2: 新增 state 和 handleMoveFolder**

在组件 state 区域添加：

```typescript
const [moveFolderTarget, setMoveFolderTarget] = useState<{ id: string; name: string; parent_id: string | null } | null>(null);
```

添加 `handleMoveFolder` 方法（在 `handleDeleteFolder` 附近）：

```typescript
const handleMoveFolder = (folder: any) => {
  setMoveFolderTarget(folder);
};
```

- [ ] **Step 3: 收集完整文件夹扁平列表**

在 `loadFolderTree` 加载成功后将扁平数据存入 state，供 MoveFolderModal 使用：

新增 state：
```typescript
const [flatFolders, setFlatFolders] = useState<{ id: string; name: string; parent_id: string | null }[]>([]);
```

修改 `loadFolderTree` 中的成功分支，在 `setFolderTree` 同时保存扁平列表：

```typescript
// 在 loadFolderTree 中，获取到 data（原始数组）后：
setFlatFolders(data || []);
```

但 `data` 是嵌套树结构。需要改为从 API 获取扁平数据。查看当前 `loadFolderTree`：

```typescript
const loadFolderTree = useCallback(async () => {
  setTreeLoading(true);
  try {
    const { data } = await api.get(`/knowledge-bases/${kbId}/folders`);
    const toTreeNodes = (nodes: any[]): DataNode[] =>
      nodes.map((n: any) => ({
        key: n.id,
        title: n.name,
        children: n.children ? toTreeNodes(n.children) : undefined,
        isLeaf: !n.children || n.children.length === 0,
        data: n,
      }));
    setFolderTree(toTreeNodes(data || []));
  } catch { message.error('加载文件夹失败'); }
  finally { setTreeLoading(false); }
}, [kbId]);
```

API 返回的是嵌套树。需要先从嵌套树中提取扁平列表存入 `flatFolders`：

```typescript
const loadFolderTree = useCallback(async () => {
  setTreeLoading(true);
  try {
    const { data } = await api.get(`/knowledge-bases/${kbId}/folders`);
    // 从嵌套树中提取扁平列表（供 MoveFolderModal 使用）
    const flatten = (nodes: any[]): any[] => {
      const result: any[] = [];
      for (const n of nodes) {
        result.push({ id: n.id, name: n.name, parent_id: n.parent_id ?? null });
        if (n.children) result.push(...flatten(n.children));
      }
      return result;
    };
    setFlatFolders(flatten(data || []));
    // 原有逻辑不变
    const toTreeNodes = (nodes: any[]): DataNode[] =>
      nodes.map((n: any) => ({
        key: n.id,
        title: n.name,
        children: n.children ? toTreeNodes(n.children) : undefined,
        isLeaf: !n.children || n.children.length === 0,
        data: n,
      }));
    setFolderTree(toTreeNodes(data || []));
  } catch { message.error('加载文件夹失败'); }
  finally { setTreeLoading(false); }
}, [kbId]);
```

- [ ] **Step 4: 改造 titleRender**

将当前 `titleRender`（使用 `Dropdown trigger={['contextMenu']}` 右键菜单）：

```tsx
titleRender={(node: any) => {
  const folder = node.data;
  return (
    <Dropdown menu={{
      items: [
        {
          key: 'new', icon: <FolderAddOutlined />, label: '新建子文件夹',
          onClick: () => {
            setEditingFolder(null);
            setNewFolderParentId(folder.id);
            setFolderModalOpen(true);
          },
        },
        {
          key: 'rename', icon: <EditOutlined />, label: '重命名',
          onClick: () => {
            setEditingFolder(folder);
            setNewFolderParentId(undefined);
            setFolderModalOpen(true);
          },
        },
        { type: 'divider' },
        {
          key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
          onClick: () => handleDeleteFolder(folder.id),
        },
      ],
    }} trigger={['contextMenu']}>
      <span>📁 {folder.name}</span>
    </Dropdown>
  );
}}
```

改为三点图标按钮触发（**去除右键**，三点一直可见）：

```tsx
titleRender={(node: any) => {
  const folder = node.data;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <span>📁 {folder.name}</span>
      <Dropdown menu={{
        items: [
          {
            key: 'new', icon: <FolderAddOutlined />, label: '新建子文件夹',
            onClick: () => {
              setEditingFolder(null);
              setNewFolderParentId(folder.id);
              setFolderModalOpen(true);
            },
          },
          {
            key: 'rename', icon: <EditOutlined />, label: '重命名',
            onClick: () => {
              setEditingFolder(folder);
              setNewFolderParentId(undefined);
              setFolderModalOpen(true);
            },
          },
          {
            key: 'move', icon: <FolderAddOutlined />, label: '移动到…',
            onClick: () => handleMoveFolder(folder),
          },
          { type: 'divider' },
          {
            key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
            onClick: () => handleDeleteFolder(folder.id),
          },
        ],
      }} trigger={['click']}>
        <Button type="text" size="small" icon={<EllipsisOutlined />}
          onClick={(e) => e.stopPropagation()} />
      </Dropdown>
    </div>
  );
}}
```

要点：
- 三点 `Button` 使用 `onClick={(e) => e.stopPropagation()}` 阻止 Tree 节点选中事件冒泡
- `Dropdown trigger={['click']}` 替代 `trigger={['contextMenu']}`
- 新增 `move` 菜单项 — 调用 `handleMoveFolder(folder)`
- 不再需要 `Dropdown` 包裹整行文字

- [ ] **Step 5: 在 JSX 底部添加 MoveFolderModal**

在 `FolderModal` 和 `KnowledgeBaseModal` 之间插入：

```tsx
<MoveFolderModal
  open={!!moveFolderTarget}
  folder={moveFolderTarget}
  allFolders={flatFolders}
  onClose={() => setMoveFolderTarget(null)}
  onSuccess={loadFolderTree}
/>
```

- [ ] **Step 6: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/pages/knowledge/FolderBrowsePage.tsx
git commit -m "feat: 文件夹节点三点菜单 — 重命名/移动/删除，去除右键菜单"
```
