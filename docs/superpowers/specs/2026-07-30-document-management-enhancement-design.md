# 文档管理功能增强 — 设计文档

> 日期：2026-07-30 | 版本：1.0

## 1. 概述

为现有知识库 RAG 系统补全文档管理的完整 CRUD 生命周期：
查看原文件、下载文件、编辑元信息、替换文件（版本追溯）、取消上传。

当前状态：仅支持上传（阶段一解析 + 阶段二索引）、列表、Markdown 预览、级联删除、重索引。

---

## 2. 前端状态模型

后端 7 个内部状态，前端简化为 4 个用户可见状态：

| 后端状态 | 映射为前端状态 | 说明 |
|----------|---------------|------|
| `uploading` | 上传中 | 文件上传中 |
| `parsing` | 上传中 | 内容解析中 |
| `parsed` | 上传中 | 解析完成，索引创建中，不可检索 |
| `indexing` | 上传中 | 索引写入中，不可检索 |
| `indexed` | 已上传 | 全部完成，可检索、可下载 |
| `failed` | 已失败 | 解析或索引失败 |
| `cancelled` | 已取消 | 用户主动取消上传 |

前端状态标签和颜色：

```typescript
const STATUS = {
  uploading:  { label: '上传中', color: 'blue' },
  cancelled:  { label: '已取消', color: 'default' },
  indexed:    { label: '已上传', color: 'green' },
  failed:     { label: '已失败', color: 'red' },
};
```

### 操作按钮（按状态 + 权限）

| 状态 | 👁查看 | 📥下载 | ✏️编辑 | 🔄替换 | ❌取消 | 🗑删除 |
|------|--------|--------|--------|--------|--------|--------|
| 上传中 | ✅ | — | — | — | ✅ | — |
| 已取消 | ✅ | — | — | ✅ | — | ✅ |
| 已上传 | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| 已失败 | ✅ | — | — | ✅ | — | ✅ |

权限规则（C 方案——按可见性分级）：

| 操作 | public | dept | private |
|------|--------|------|---------|
| 查看原文件 | 所有人 | 同部门 | 仅创建者 |
| 下载文件 | 所有人 | 同部门 | 仅创建者 |
| 编辑元信息 | 仅创建者+管理员 | 仅创建者+管理员 | 仅创建者 |
| 替换文件 | 仅创建者+管理员 | 仅创建者+管理员 | 仅创建者 |
| 取消上传 | 仅创建者 | 仅创建者 | 仅创建者 |
| 删除 | 仅创建者+管理员 | 仅创建者+管理员 | 仅创建者 |

---

## 3. 数据模型变更

### 3.1 documents 表（新增 1 列）

```typescript
// document.entity.ts 新增字段
@Column({ type: 'int', default: 1 })
version!: number;  // 当前版本号，每次替换文件 +1
```

### 3.2 DocumentStatus 枚举（新增 1 个值）

```typescript
CANCELLED = 'cancelled'  // 用户主动取消上传，区别于 failed
```

### 3.3 新增表：document_versions

文件替换时归档旧版本，纯存档用途（不参与检索）。

```sql
CREATE TABLE document_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  name            VARCHAR NOT NULL,        -- 替换时的文件名
  rustfs_file_url VARCHAR NOT NULL,        -- 旧文件在 RustFS 中的地址
  size            BIGINT NOT NULL,
  mongo_doc_id    VARCHAR NOT NULL,        -- 旧版 Markdown 正文在 MongoDB 的 _id
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_doc_versions_doc_id ON document_versions(document_id);
```

### 3.4 新增 DTO

**`update-document.dto.ts`**：

```typescript
export class UpdateDocumentDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(DocumentVisibility) visibility?: DocumentVisibility;
  @IsOptional() @IsString() dept_id?: string;
}
```

---

## 4. 后端 API

### 4.1 RustFS 服务新增方法

| 方法 | 说明 |
|------|------|
| `getFileStream(fileUrl): Promise<Readable>` | 从 URL 解析 key，`GetObjectCommand`，返回可读流 |
| `headFile(fileUrl): Promise<HeadObjectOutput>` | `HeadObjectCommand`，获取 ContentType/ContentLength（设置响应头用） |

---

### 4.2 端点清单

所有端点基于 `@Controller('documents')`，受 `JwtAuthGuard` 保护。

#### `GET /documents/:id` — 文档详情（修复空壳）

```
响应：{ id, name, type, size, version, status, visibility,
        uploader_id, dept_id, mongo_doc_id, rustfs_file_url,
        created_at, updated_at }
```

#### `PATCH /documents/:id` — 编辑元信息

```
请求体：{ name?, visibility?, dept_id? }  // 全部可选
权限：仅创建者或管理员
校验：visibility 取值 public|dept|private

响应：更新后的完整文档对象
```

#### `POST /documents/:id/replace` — 替换文件

```
请求：multipart/form-data { file }

流程：
  1. 权限检查（创建者或管理员）
  2. 将当前版本归档到 document_versions
     INSERT (document_id, version, name, rustfs_file_url, size, mongo_doc_id)
  3. 上传新文件到 RustFS
  4. 解析新文件 → Markdown + 图片
  5. 更新 MongoDB 正文（覆盖旧正文）
  6. 更新 documents 表：
     name, size, rustfs_file_url, version+1, mongo_doc_id, status=PARSED
  7. 清除旧索引（PGVector / ES / Neo4j）
  8. fire-and-forget 触发新索引

回滚：步骤 2~8 中任意失败 → 恢复归档记录，回滚文件
  注意：旧版文件（已归档到 document_versions）不删除，需一并回滚

响应：{ docId, version, status: 'parsed' }
```

#### `POST /documents/:id/cancel` — 取消上传

```
权限：仅创建者
前置条件：status 为 uploading / parsing

流程：
  1. 状态改为 cancelled
  2. 清理 RustFS 已上传文件
  3. 清理 MongoDB pending 记录（如有）
  4. 清理 Postgres（如有孤儿记录）

响应：{ docId, status: 'cancelled' }
```

#### `GET /documents/:id/file` — 查看原文件（inline）

```
权限：按可见性分级
响应：
  Content-Type: 文件的 mimeType
  Content-Disposition: inline
  Body: RustFS 文件流
```

#### `GET /documents/:id/download` — 下载原文件

```
同 /file，但 Content-Disposition: attachment; filename="xxx.pdf"
```

#### `GET /documents/:id/versions` — 版本历史

```
权限：同查看原文件
响应：[
  { id, version, name, size, created_at },
  ...
]
当前活跃版本不在列表中。
```

#### `GET /documents/versions/:versionId/file` — 查看历史版本文件

```
响应：Stream 历史版本原文件
Content-Disposition: inline
```

---

## 5. 前端设计

### 5.1 页面改造：DocumentManagePage

```
┌──────────────────────────────────────────────────────────────┐
│ 📂 文档管理                                     [+ 上传文档] │
│                                                              │
│ 🔍 [关键词...]  [类型 ▼]  [状态 ▼]  [搜索]                  │
│                                                              │
│ ┌────────┬──────┬──────┬──────────┬────────────────────────┐ │
│ │ 名称   │ 类型 │ 状态 │ 大小     │ 操作                   │ │
│ ├────────┼──────┼──────┼──────────┼────────────────────────┤ │
│ │ 📄 员工 │ md   │ 🟢  │ 12.5 KB  │ 👁 📥 ✏️ 🔄 ❌ 🗑     │ │
│ │ 📕 报销 │ pdf  │ 🔵  │ 1.2 MB   │ 👁 —  —  —  ❌ —      │ │
│ │ 📊 报表 │ xlsx │ 🔴  │ 890 KB   │ 👁 —  —  🔄 —  🗑     │ │
│ └────────┴──────┴──────┴──────────┴────────────────────────┘ │
│                               第 1/5 页  [◀ 1 2 3 ... 5 ▶]  │
└──────────────────────────────────────────────────────────────┘
```

- 名称列可点击 → 右侧滑出 DocumentDetailDrawer（含版本历史）
- `[+ 上传文档]` 按钮 → 跳转 `/documents/upload`（上传页）
- 文件类型带图标（📕📝📊📽️📄📃🖼️🎵🎬）
- 表格新增"大小"列（格式化显示）

### 5.2 新增组件

| 组件 | 作用 | 触发 |
|------|------|------|
| `DocumentEditModal` | 编辑名称/可见性/部门 | 点击 ✏️ |
| `DocumentReplaceModal` | 拖拽上传新文件 | 点击 🔄 |
| `DocumentDetailDrawer` | 右侧滑出：元信息 + 版本历史 | 点击文件名 |
| `SearchBar` | 关键词 + 类型下拉 + 状态下拉 | 管理页顶部 |

### 5.3 导航

侧边栏「文档管理」默认跳转 `/documents/manage`（管理页），上传入口在管理页顶部按钮。

### 5.4 状态映射常量

```typescript
const FRONTEND_STATUS = {
  uploading:  { label: '上传中', color: 'blue' },
  cancelled:  { label: '已取消', color: 'default' },
  indexed:    { label: '已上传', color: 'green' },
  failed:     { label: '已失败', color: 'red' },
} as const;

function toFrontendStatus(backendStatus: string): string {
  switch (backendStatus) {
    case 'uploading': case 'parsing': case 'parsed': case 'indexing':
      return 'uploading';
    case 'indexed':  return 'indexed';
    case 'failed':   return 'failed';
    case 'cancelled': return 'cancelled';
    default:         return 'failed';
  }
}
```

---

## 6. 文件改动清单

### 后端

| 文件 | 改动 |
|------|------|
| `apps/server/src/database/rustfs/rustfs.service.ts` | + `getFileStream()`, + `headFile()` |
| `apps/server/src/modules/document/entities/document.entity.ts` | + `version` 字段, + `CANCELLED` 状态 |
| `apps/server/src/modules/document/entities/document-version.entity.ts` | **新建** |
| `apps/server/src/modules/document/dto/update-document.dto.ts` | **新建** |
| `apps/server/src/modules/document/document.service.ts` | + `updateDocument()`, + `replaceFile()`, + `cancelUpload()`, + `getFileStream()`, + `getVersions()` |
| `apps/server/src/modules/document/document.controller.ts` | + `PATCH :id`, + `POST :id/replace`, + `POST :id/cancel`, + `GET :id/file`, + `GET :id/download`, + `GET :id/versions`, + `GET versions/:versionId/file`, 补全 `GET :id` |
| `apps/server/src/modules/document/document.module.ts` | 注册 `DocumentVersion` entity |

### 前端

| 文件 | 改动 |
|------|------|
| `apps/web/src/pages/document/DocumentManagePage.tsx` | 全面改造：搜索栏、分页、操作按钮矩阵、名称点击 |
| `apps/web/src/pages/document/DocumentUploadPage.tsx` | 补充 dept_id 和 visibility 选择 |
| `apps/web/src/components/document/DocumentEditModal.tsx` | **新建** |
| `apps/web/src/components/document/DocumentReplaceModal.tsx` | **新建** |
| `apps/web/src/components/document/DocumentDetailDrawer.tsx` | **新建** |
| `apps/web/src/components/document/SearchBar.tsx` | **新建** |
| `apps/web/src/services/api.ts` | 无需改动（axios 实例已满足需求） |
| `apps/web/src/App.tsx` | 无需改动路由（现有路由已覆盖） |
| `apps/web/src/components/layout/Layout.tsx` | 侧边栏"文档管理"链接改为 `/documents/manage` |

---

## 7. 实现顺序

```
第一层：基础设施
  1. RustFS + getFileStream() / headFile()
  2. document.entity.ts + version / CANCELLED
  3. document-version.entity.ts 新建
  4. update-document.dto.ts 新建

第二层：后端端点（按优先级）
  5. GET  /documents/:id             补全详情
  6. PATCH /documents/:id            编辑元信息
  7. GET  /documents/:id/file        查看原文件
  8. GET  /documents/:id/download    下载原文件
  9. POST /documents/:id/replace     替换文件
  10. POST /documents/:id/cancel     取消上传
  11. GET  /documents/:id/versions   版本列表
  12. GET  /documents/versions/:versionId/file  历史版本查看

第三层：前端
  13. SearchBar 组件
  14. DocumentManagePage 改造
  15. DocumentEditModal
  16. DocumentReplaceModal
  17. DocumentDetailDrawer
  18. 侧边栏导航调整
```

---

## 8. 不在范围内

- 批量删除 / 批量操作
- 支持上传时设置 visibility（本次只改管理页，上传页暂不改造）
- 替换文件时的进度展示优化
- 文档内容在线编辑（只支持元信息编辑，不支持 Markdown 正文编辑）
