# 知识库系统 UI & 数据模型优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Document 实体新增 kb_id 直接关联、新增部门列表 API、优化前端 KB 必选/部门下拉/卡片布局

**Architecture:** Document 加 kb_id 列（FK → knowledge_bases），上传/编辑时若传 folder_id 则自动同步 kb_id；GET /departments 支持 keyword 搜索；前端 KB Select 改为必选、dept_id 改为下拉

**Tech Stack:** NestJS + TypeORM + React + Ant Design 5 + Zustand

## Global Constraints

- TypeORM `synchronize: true` 自动同步 DDL（不手写 migration）
- 后端所有接口需 JWT 认证（`@UseGuards(JwtAuthGuard)`）
- 前端 API 调用统一通过 `api` 实例（`/api` baseURL + JWT 拦截器）
- 代码风格遵循现有模式（DTO class-validator、TreeSelect 用 DataNode 类型）

---

## File Structure Map

```
apps/server/src/
  modules/
    document/
      entities/document.entity.ts          [MODIFY] +kb_id column
      document.service.ts                  [MODIFY] kb_id in upload/list/update
      document.controller.ts               [MODIFY] kb_id body param
      dto/update-document.dto.ts           [MODIFY] +kb_id field
    knowledge-base/
      kb.service.ts                        [MODIFY] list() docCount via kb_id
    user/
      user.module.ts                       [MODIFY] +DepartmentController
      departments.controller.ts            [CREATE] GET /departments?keyword=

apps/web/src/
  pages/
    knowledge/
      KnowledgeBaseListPage.tsx            [MODIFY] Card title layout
      FolderBrowsePage.tsx                 [MODIFY] kb_id in doc query
    document/
      DocumentUploadPage.tsx               [MODIFY] KB required + kb_id
      DocumentManagePage.tsx               [MODIFY] kb_id filter
  components/document/
    DocumentEditModal.tsx                  [MODIFY] dept Select + kb_id Select
```

---

### Task 1: Document 实体新增 kb_id 列

**Files:**
- Modify: `apps/server/src/modules/document/entities/document.entity.ts`

**Interfaces:**
- Produces: `Document.kb_id: string | null` — FK → knowledge_bases.id, ON DELETE SET NULL

- [ ] **Step 1: 在 Document 实体添加 kb_id 列**

在 `folder_id` 列定义后添加：

```typescript
/** 所属知识库（可直接关联，也可通过文件夹间接关联） */
@Column({ type: 'uuid', nullable: true })
@Index()
kb_id!: string | null;

@ManyToOne(() => KnowledgeBase, { nullable: true, onDelete: 'SET NULL' })
@JoinColumn({ name: 'kb_id' })
knowledgeBase!: KnowledgeBase | null;
```

同时添加 import：
```typescript
import { KnowledgeBase } from '../../knowledge-base/entities/knowledge-base.entity';
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 2: DocumentService 适配 kb_id

**Files:**
- Modify: `apps/server/src/modules/document/document.service.ts`

**Interfaces:**
- Consumes: `Document.kb_id` from Task 1
- Modifies: `uploadStage1(file, uploaderId, deptId, folderId?, kbId?)` — 新增 kbId 参数
- Modifies: `updateDocument(docId, dto, user)` — 新增 kb_id 处理
- Modifies: `list(dto, user)` — kb_id 筛选直接走索引

- [ ] **Step 1: uploadStage1 新增 kbId 参数并处理**

修改方法签名和逻辑（约 line 68-73）：

```typescript
async uploadStage1(
  file: Express.Multer.File,
  uploaderId: string,
  deptId: string,
  folderId?: string,
  kbId?: string,
) {
  // ... 解析逻辑不变 ...

  // 确定 kb_id：若指定了 folder_id，从文件夹获取 kb_id 覆盖
  let resolvedKbId = kbId || null;
  if (folderId) {
    const folder = await this.folderRepo.findOne({ where: { id: folderId } });
    if (folder) resolvedKbId = folder.kb_id;
  }

  const doc = this.docRepo.create({
    name: file.originalname,
    type,
    size: file.size,
    uploader_id: uploaderId,
    dept_id: deptId,
    mongo_doc_id: 'pending',
    rustfs_file_url: fileUrl,
    status: DocumentStatus.PARSED,
    folder_id: folderId || null,
    kb_id: resolvedKbId,  // 新增
  });
  // ... 后续逻辑不变 ...
}
```

- [ ] **Step 2: list() 中 kb_id 筛选直接走索引**

修改 `list()` 方法中的 kb_id 筛选逻辑（替换原先的"查文件夹ID再IN"方式）：

```typescript
// 按 kb_id 过滤（直接走索引，替代之前查文件夹 ID 再 IN 的方式）
if (dto.kb_id) {
  qb.andWhere('doc.kb_id = :kbId', { kbId: dto.kb_id });
}

// 按 folder_id 过滤（保持不变）
if (dto.folder_id) {
  qb.andWhere('doc.folder_id = :folderId', { folderId: dto.folder_id });
}
```

删除原先的 `else if (dto.kb_id) { ... }` 代码块（约 lines 213-223）。

同时确保 select 数组中包含 `kb_id`：
```typescript
.select([
  'doc.id', 'doc.name', 'doc.type', 'doc.size',
  'doc.status', 'doc.visibility', 'doc.uploader_id',
  'doc.dept_id', 'doc.folder_id', 'doc.kb_id',  // kb_id 新增
  'doc.created_at', 'doc.updated_at',
])
```

- [ ] **Step 3: updateDocument() 新增 kb_id 处理**

在 `updateDocument()` 方法末尾（`dto.dept_id` 处理后）添加 kb_id 处理：

```typescript
// 支持设置文档所属知识库（直接放 KB 下，不选文件夹）
if (dto.kb_id !== undefined) {
  if (dto.kb_id === null || (dto.kb_id as any) === '') {
    doc.kb_id = null;
  } else {
    const kb = await this.kbRepo.findOne({ where: { id: dto.kb_id } });
    if (!kb) throw new BadRequestException('目标知识库不存在');
    doc.kb_id = dto.kb_id;
  }
}

// folder_id 变更时同步 kb_id
if (dto.folder_id !== undefined) {
  if (dto.folder_id === null || (dto.folder_id as any) === '') {
    doc.folder_id = null;
  } else {
    const folder = await this.folderRepo.findOne({ where: { id: dto.folder_id } });
    if (!folder) throw new BadRequestException('目标文件夹不存在');
    doc.folder_id = dto.folder_id;
    doc.kb_id = folder.kb_id;  // 自动同步
  }
}
```

需要注入 `KnowledgeBase` repository。在构造函数添加：
```typescript
@InjectRepository(KnowledgeBase) private kbRepo: Repository<KnowledgeBase>,
```

并添加 import：
```typescript
import { KnowledgeBase } from '../knowledge-base/entities/knowledge-base.entity';
```

同时在 `document.module.ts` 的 `TypeOrmModule.forFeature` 中添加 `KnowledgeBase`：
```typescript
TypeOrmModule.forFeature([Document, DocumentVersion, Folder, KnowledgeBase]),
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 3: KnowledgeBaseService list() docCount 改用 kb_id

**Files:**
- Modify: `apps/server/src/modules/knowledge-base/kb.service.ts`

**Interfaces:**
- Consumes: `Document.kb_id` from Task 1

- [ ] **Step 1: 简化 list() 中 docCount 查询**

将 `list()` 方法中的 docCount 计算从"先查文件夹ID再IN统计"改为直接按 kb_id 统计：

```typescript
/** 列出所有知识库（含文档计数） */
async list(): Promise<{ id: string; name: string; description: string; docCount: number; created_at: Date }[]> {
  const kbs = await this.kbRepo.find({ order: { created_at: 'DESC' } });
  const results: any[] = [];
  for (const kb of kbs) {
    const docCount = await this.docRepo
      .createQueryBuilder('doc')
      .where('doc.kb_id = :kbId', { kbId: kb.id })
      .getCount();
    results.push({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      docCount,
      created_at: kb.created_at,
    });
  }
  return results;
}
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 4: DocumentController + DTO 适配 kb_id

**Files:**
- Modify: `apps/server/src/modules/document/document.controller.ts`
- Modify: `apps/server/src/modules/document/dto/update-document.dto.ts`

**Interfaces:**
- Consumes: `DocumentService.uploadStage1` 新签名 from Task 2

- [ ] **Step 1: update-document.dto.ts 新增 kb_id 字段**

在 `UpdateDocumentDto` 类中添加：

```typescript
@IsOptional()
@IsUUID()
kb_id?: string;
```

- [ ] **Step 2: document.controller.ts upload 新增 kb_id 参数**

修改 upload 方法签名（约 line 43-49）：

```typescript
async upload(
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser() user: { id: string },
  @Body('dept_id') deptId: string,
  @Body('folder_id') folderId?: string,
  @Body('kb_id') kbId?: string,
) {
  return this.docService.uploadStage1(file, user.id, deptId, folderId, kbId);
}
```

detail 方法也需要返回 kb_id（约 line 67-83），添加：
```typescript
kb_id: doc.kb_id,
```

- [ ] **Step 3: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 5: 新增 GET /departments 接口

**Files:**
- Create: `apps/server/src/modules/user/departments.controller.ts`
- Modify: `apps/server/src/modules/user/user.module.ts`

**Interfaces:**
- Produces: `GET /departments?keyword=` → `{ id: string, name: string }[]`

- [ ] **Step 1: 创建 DepartmentsController**

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Department } from './entities/department.entity';

@Controller('departments')
@UseGuards(JwtAuthGuard)
export class DepartmentsController {
  constructor(
    @InjectRepository(Department) private deptRepo: Repository<Department>,
  ) {}

  @Get()
  async list(@Query('keyword') keyword?: string) {
    const where = keyword
      ? { name: ILike(`%${keyword}%`) }
      : {};
    const depts = await this.deptRepo.find({
      where,
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return depts;
  }
}
```

- [ ] **Step 2: 在 UserModule 注册 Controller**

修改 `user.module.ts`：

```typescript
import { DepartmentsController } from './departments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Permission, Department])],
  controllers: [DepartmentsController],
  exports: [TypeOrmModule],
})
```

- [ ] **Step 3: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 6: 知识库列表页卡片布局调整

**Files:**
- Modify: `apps/web/src/pages/knowledge/KnowledgeBaseListPage.tsx`

- [ ] **Step 1: KB 名称移到 Card title**

将 `Card.Meta title` 改为 Card 的 `title` prop，实现名称在卡片顶部左侧、三点操作在右侧：

```tsx
<Card
  hoverable
  title={`📗 ${kb.name}`}  // 名称放在卡片顶部
  onClick={() => navigate(`/knowledge/${kb.id}`)}
  extra={
    <Dropdown menu={{...}} trigger={['click']}>
      <Button type="text" size="small" icon={<EllipsisOutlined />}
        onClick={(e) => e.stopPropagation()} />
    </Dropdown>
  }
>
  {/* Card.Meta 只保留 description */}
  <Card.Meta
    description={
      <>
        <div>{kb.description || '暂无描述'}</div>
        <div style={{ marginTop: 8, color: '#888' }}>
          {kb.docCount ?? 0} 个文档
        </div>
      </>
    }
  />
</Card>
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 7: 文档上传页 KB 必选 + kb_id

**Files:**
- Modify: `apps/web/src/pages/document/DocumentUploadPage.tsx`

- [ ] **Step 1: KB 改为必选、传 kb_id**

1. 去掉 KB Select 的 `allowClear`，placeholder 改为"选择知识库"
2. 在 FormData 中同时传 `folder_id` 和 `kb_id`

```tsx
// KB Select: 去掉 allowClear
<Select
  style={{ width: '100%' }}
  placeholder="选择知识库"
  options={kbs}
  value={selectedKbId}
  onChange={(val) => { setSelectedKbId(val); setSelectedFolderId(undefined); }}
/>

// handleUpload 中传 kb_id
const formData = new FormData();
formData.append('file', file);
if (user?.dept_id) formData.append('dept_id', user.dept_id);
if (selectedKbId) formData.append('kb_id', selectedKbId);
if (selectedFolderId) formData.append('folder_id', selectedFolderId);
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 8: 文档管理页 kb_id 筛选

**Files:**
- Modify: `apps/web/src/pages/document/DocumentManagePage.tsx`

- [ ] **Step 1: kb_id 筛选替代 folder_id 逻辑**

在 `loadDocuments` 中将 `selectedKbId` 直接作为 `kb_id` 参数：

```tsx
if (selectedKbId) params.kb_id = selectedKbId;
if (selectedFolderId) params.folder_id = selectedFolderId;
```

KB Select 保持默认不选（`allowClear`），文件夹不变。

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 9: 文档编辑弹窗 — 部门下拉 + KB 选择

**Files:**
- Modify: `apps/web/src/components/document/DocumentEditModal.tsx`

- [ ] **Step 1: 加载部门列表，dept_id 改为 Select**

```tsx
// 新增 state
const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);

// 新增 useEffect 加载部门
useEffect(() => {
  api.get('/departments').then(({ data }) => {
    setDepartments((data || []).map((d: any) => ({ value: d.id, label: d.name })));
  }).catch(() => {});
}, []);

// dept_id Form.Item 改为
<Form.Item name="dept_id" label="所属部门">
  <Select
    placeholder="选择部门（可选）"
    allowClear
    showSearch
    filterOption={(input, option) =>
      (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
    }
    options={departments}
  />
</Form.Item>
```

- [ ] **Step 2: 新增 kb_id TreeSelect（选知识库→出文件夹树）**

在表单中添加 kb_id 选择。已有 `kbs`、`selectedKbId`、`folderTree` 状态和管理逻辑，现在让用户可以通过 `kb_id` 选择知识库：

```tsx
<Form.Item name="kb_id" label="所属知识库">
  <Select
    style={{ width: '100%' }}
    placeholder="选择知识库（可选）"
    allowClear
    options={kbs}
    onChange={(val) => setSelectedKbId(val)}
  />
</Form.Item>
```

同时修改初始化逻辑，从 `document.kb_id` 反推 `selectedKbId`：

```tsx
useEffect(() => {
  if (document) {
    form.setFieldsValue({
      name: document.name,
      visibility: document.visibility,
      dept_id: document.dept_id || undefined,
      folder_id: document.folder_id || undefined,
      kb_id: document.kb_id || undefined,
    });
    setSelectedKbId(document.kb_id || undefined);
  }
}, [document, form]);
```

handleOk 中同时提交 kb_id：
```typescript
await api.patch(`/documents/${document!.id}`, {
  name: values.name,
  visibility: values.visibility,
  dept_id: values.dept_id || undefined,
  folder_id: values.folder_id || undefined,
  kb_id: values.kb_id || undefined,
});
```

- [ ] **Step 3: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 10: 文件夹浏览页适配 kb_id

**Files:**
- Modify: `apps/web/src/pages/knowledge/FolderBrowsePage.tsx`

- [ ] **Step 1: loadDocuments 改用 kb_id 查询**

将文档加载参数从 fallback kb_id 逻辑改为直接用 `kb_id`：

```tsx
const loadDocuments = useCallback(async (page = 1) => {
  setDocLoading(true);
  try {
    const params: Record<string, any> = { page, pageSize: 20 };
    if (selectedFolderId) {
      params.folder_id = selectedFolderId;
    } else {
      // 不选文件夹时：展示该 KB 下所有文档（通过 kb_id）
      params.kb_id = kbId;
    }
    const { data } = await api.get('/documents', { params });
    setDocuments(data.items || []);
    setDocTotal(data.total || 0);
  } catch { message.error('加载文档列表失败'); }
  finally { setDocLoading(false); }
}, [selectedFolderId, kbId]);
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无错误输出
