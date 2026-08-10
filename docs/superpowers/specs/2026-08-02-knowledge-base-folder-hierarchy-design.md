# 知识库文件夹层级体系 — 设计方案

> 日期：2026-08-02 | 状态：已确认

## 1. 概述

当前系统所有文档平铺在 `documents` 表中，没有层级组织结构。本次设计引入「知识库 → 文件夹（多级嵌套）→ 文档」三级层级体系，让用户能够像文件系统一样组织知识文档。

### 核心需求

- 创建多个知识库作为顶层容器
- 每个知识库内支持多级嵌套文件夹
- 文档只能属于一个文件夹
- 知识库页面：浏览文件夹树 + 查看文档
- 文档管理页面：上传/管理时选择所属知识库和文件夹

---

## 2. 数据模型

### 2.1 新增表：knowledge_bases

```sql
CREATE TABLE knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

### 2.2 新增表：folders

```sql
CREATE TABLE folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_id      UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES folders(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT uq_folder_name UNIQUE(kb_id, parent_id, name)
);
```

- `parent_id`：NULL 表示该文件夹在知识库根目录下，非 NULL 指向父文件夹
- `parent_id` 自引用实现无限层级嵌套
- `CASCADE` 删除：删除知识库 → 级联删除所有文件夹；删除父文件夹 → 级联删除子文件夹
- 唯一约束：同一父级下文件夹名不可重复

### 2.3 现有表变更：documents

`documents` 表新增一列：

```sql
ALTER TABLE documents ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
```

- 可为 NULL（兼容旧数据）
- 父文件夹删除时文档的 `folder_id` 被 SET NULL，不删除文档本身
- 文档所属知识库通过 `folders.kb_id` 推导

### 2.4 关系示意

```
knowledge_bases ──→ folders (kb_id)
                         │
                         └──→ folders (parent_id, 自引用)
                                  │
                                  └──→ documents (folder_id)
```

### 2.5 TypeORM Entity

**KnowledgeBase**：

```typescript
@Entity('knowledge_bases')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ type: 'uuid' })
  created_by!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
```

**Folder**：

```typescript
@Entity('folders')
@Index(['kb_id'])
@Unique(['kb_id', 'parent_id', 'name'])
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  kb_id!: string;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent_id!: string | null;

  @Column({ length: 200 })
  name!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
```

---

## 3. 后端 API

### 3.1 知识库 CRUD

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `POST` | `/api/knowledge-bases` | 创建知识库 | 登录用户 |
| `GET` | `/api/knowledge-bases` | 列出当前用户可见的知识库（含文档计数） | 登录用户 |
| `GET` | `/api/knowledge-bases/:id` | 单个知识库详情（含文件夹树） | 登录用户 |
| `PATCH` | `/api/knowledge-bases/:id` | 编辑名称、描述 | 创建者/管理员 |
| `DELETE` | `/api/knowledge-bases/:id` | 删除知识库（CASCADE 所有文件夹，文档 SET NULL） | 创建者/管理员 |

### 3.2 文件夹 CRUD

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `POST` | `/api/knowledge-bases/:kbId/folders` | 创建文件夹 | 登录用户 |
| `GET` | `/api/knowledge-bases/:kbId/folders` | 获取文件夹树（嵌套结构） | 登录用户 |
| `PATCH` | `/api/folders/:id` | 重命名文件夹 | 创建者/管理员 |
| `DELETE` | `/api/folders/:id` | 删除文件夹（级联子文件夹，文档 SET NULL） | 创建者/管理员 |
| `POST` | `/api/folders/:id/move` | 移动文件夹到新父级（限同一知识库内） | 创建者/管理员 |

### 3.3 文档 API 变更

| 方法 | 路径 | 变更点 |
|------|------|--------|
| `GET` | `/api/documents` | 新增 `kb_id`、`folder_id` 查询参数 |
| `POST` | `/api/documents/upload` | 新增 `folder_id` 表单字段 |
| `PATCH` | `/api/documents/:id` | 新增 `folder_id` 可选字段（移动文档） |

### 3.4 关键逻辑

- **获取文件夹树**：查询 KB 下所有文件夹，在应用层按 `parent_id` 组装为嵌套树，每个节点附带文档数量
- **移动文件夹**：校验循环引用（目标不能是自身或其子节点），限制同知识库内移动
- **删除知识库**：级联删除所有文件夹（CASCADE），文档的 `folder_id` 被 SET NULL
- **知识库列表**：通过文件夹链计算每个 KB 下的文档总数

### 3.5 新 DTO

**create-knowledge-base.dto.ts**：
```typescript
export class CreateKnowledgeBaseDto {
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsString() description?: string;
}
```

**update-knowledge-base.dto.ts**：
```typescript
export class UpdateKnowledgeBaseDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() description?: string;
}
```

**create-folder.dto.ts**：
```typescript
export class CreateFolderDto {
  @IsUUID() kb_id!: string;
  @IsOptional() @IsUUID() parent_id?: string;
  @IsString() @Length(1, 200) name!: string;
}
```

**move-folder.dto.ts**：
```typescript
export class MoveFolderDto {
  @IsUUID() new_parent_id!: string;  // null 表示移到根目录
}
```

---

## 4. 前端设计

### 4.1 页面路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/knowledge` | `KnowledgeBaseListPage` | 知识库卡片列表 |
| `/knowledge/:kbId` | `FolderBrowsePage` | 文件夹树 + 文档浏览 |
| `/documents` | `DocumentUploadPage` | 上传（增加 KB/文件夹选择） |
| `/documents/manage` | `DocumentManagePage` | 文档管理（增加 KB/文件夹筛选） |

### 4.2 知识库列表页 `/knowledge`

卡片式布局，每个知识库一张卡片（名称、描述、文档数量、创建时间）。点击进入。右上角 `...` 菜单支持编辑、删除。

### 4.3 文件夹浏览页 `/knowledge/:kbId`

左右分栏布局：

- **左侧**（200px）：Ant Design Tree 组件展示文件夹树
  - 右键菜单：新建子文件夹 / 重命名 / 删除
  - 点击节点切换右侧文档列表
- **右侧**：当前目录下的文档表格
  - 面包屑显示当前路径
  - 列：名称、类型、大小、状态
  - 操作：👁 查看、📥 下载
  - 点击文档名 → 滑出 `DocumentDetailDrawer`
- **顶部**：返回按钮、知识库名、`[+ 新建文件夹]`、`[编辑知识库]`

### 4.4 文档上传页改造 `/documents`

在拖拽上传组件上方增加两个选择器：
- **知识库**：下拉选择已有知识库
- **文件夹**：选择知识库后动态加载该 KB 的文件夹树（TreeSelect）

### 4.5 文档管理页改造 `/documents/manage`

在表格上方增加筛选条件：
- **知识库**：下拉选择
- **文件夹**：树形选择（随知识库联动）

编辑弹窗中增加文件夹选择，允许移动文档到其他文件夹。

### 4.6 组件改动清单

| 类型 | 文件 | 说明 |
|------|------|------|
| **新建** | `pages/knowledge/KnowledgeBaseListPage.tsx` | 知识库卡片列表 |
| **新建** | `pages/knowledge/FolderBrowsePage.tsx` | 文件夹树 + 文档浏览 |
| **新建** | `components/knowledge/KnowledgeBaseModal.tsx` | 新建/编辑知识库弹窗 |
| **新建** | `components/knowledge/FolderModal.tsx` | 新建/重命名文件夹弹窗 |
| **改造** | `pages/knowledge/KnowledgeBasePage.tsx` | 重构为上述新页面 |
| **改造** | `pages/document/DocumentUploadPage.tsx` | 增加 KB + 文件夹选择器 |
| **改造** | `pages/document/DocumentManagePage.tsx` | 增加 KB + 文件夹筛选 |
| **改造** | `components/document/DocumentEditModal.tsx` | 增加文件夹选择 |
| **改造** | `App.tsx` | 新增路由 |

### 4.7 职责分工

| 操作 | 知识库页面 | 文档管理页面 |
|------|:--:|:--:|
| 管理知识库 | ✅ | — |
| 管理文件夹 | ✅ | — |
| 浏览文档 | ✅（按文件夹查看） | ✅（筛选列表） |
| 查看文档详情 | ✅ | ✅ |
| 下载文档 | ✅ | ✅ |
| 上传文档 | — | ✅ |
| 编辑文档元信息 | — | ✅ |
| 替换/删除/取消文档 | — | ✅ |
| 移动文档到其他文件夹 | — | ✅（编辑弹窗） |

---

## 5. RAG 检索集成

### 5.1 检索范围过滤

后续可基于知识库范围进行检索过滤：

- **PGVector**：`postgres_doc_id IN (SELECT id FROM documents WHERE folder_id IN <该KB下所有文件夹>)`
- **ES**：查询时附加 `kb_id` filter
- **Neo4j**：从 chunk 追溯到文档，按文件夹链过滤

### 5.2 对话集成（后续迭代）

ChatPage 顶部可增加知识库范围选择器 `[▼ 全部知识库]`，选中后检索限定在该 KB 内。本次 MVP 不包含此功能。

---

## 6. 实现顺序

```
第一层：后端基础设施
  1. knowledge-base.entity.ts + folder.entity.ts（新建）
  2. DTO 新建（create-kb, update-kb, create-folder, move-folder）
  3. document.entity.ts + folder_id 字段
  4. 数据库自动同步（synchronize: true）

第二层：后端 API
  5. KnowledgeBaseModule / Service / Controller
  6. 文件夹 CRUD（创建/列表树/重命名/删除/移动）
  7. 文档 API 适配（upload + folder_id, list + kb_id/folder_id, update + folder_id）

第三层：前端
  8. KnowledgeBaseListPage（卡片列表）
  9. KnowledgeBaseModal（新建/编辑弹窗）
  10. FolderBrowsePage（文件夹树 + 文档表格 + 详情 drawer）
  11. FolderModal（新建/重命名文件夹）
  12. DocumentUploadPage 改造（KB + 文件夹选择器）
  13. DocumentManagePage 改造（KB + 文件夹筛选）
  14. DocumentEditModal 改造（文件夹移动）
  15. App.tsx 路由更新
```

---

## 7. 不在本次范围

- 对话页按知识库筛选检索范围
- 批量移动文档
- 文件夹拖拽排序
- 知识库级别的权限配置（使用现有部门+可见性权限体系）
