# 文档管理功能增强 — 实现计划

> **For agentic workers:** 按任务顺序执行，每个任务包含代码、验证步骤和 commit。使用 checkbox (`- [ ]`) 追踪进度。

**目标：** 为知识库 RAG 系统补全文档 CRUD 全生命周期——查看原文件、下载、编辑元信息、替换文件（版本追溯）、取消上传，前端四态管理。

**架构：** 后端 NestJS + TypeORM 新增 `document_versions` 表和 8 个 API 端点；RustFS 新增 GetObject 下载能力；前端 React + Ant Design 新增 4 个组件，改造管理页为搜索+分页+四态操作按钮矩阵。

**技术栈：** NestJS, TypeORM (Postgres), MongoDB (Mongoose), AWS S3 SDK (RustFS), React 18, Ant Design 5, React Router 6

## 全局约束

- 后端端口 3001，前端端口 3000（Vite 代理 `/api` → 3001）
- RustFS bucket 名：`knowledge-rag`
- 所有 API 端点受 `JwtAuthGuard` 保护
- 权限：管理员角色为 `admin`，通过 `user.roles.includes('admin')` 判断
- 前端不新增路由，不修改 `App.tsx`

---

## Phase 1: 后端基础设施

### Task 1: RustFS 新增 GetObject 和 HeadObject

**文件：**
- 修改: `apps/server/src/database/rustfs/rustfs.service.ts`

**接口：**
- 消费: 无（纯增量）
- 产出:
  ```typescript
  getFileStream(fileUrl: string): Promise<Readable>
  headFile(fileUrl: string): Promise<{ contentLength: number; contentType: string }>
  ```

- [ ] **Step 1: 在 `rustfs.service.ts` 顶部新增 import**

```typescript
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,    // 新增
  HeadObjectCommand,   // 新增
} from '@aws-sdk/client-s3';
```

- [ ] **Step 2: 新增 `getFileStream` 方法**

在 `deleteFile` 方法后面新增：

```typescript
/** 从 RustFS 获取文件可读流（用于查看/下载原文件） */
async getFileStream(fileUrl: string): Promise<import('stream').Readable> {
  const key = fileUrl.split(`${this.bucket}/`)[1];
  if (!key) throw new Error(`无法解析 RustFS key: ${fileUrl}`);
  const response = await this.s3.send(
    new GetObjectCommand({ Bucket: this.bucket, Key: key }),
  );
  return response.Body as import('stream').Readable;
}
```

- [ ] **Step 3: 新增 `headFile` 方法**

```typescript
/** 获取 RustFS 文件元信息（ContentType / ContentLength） */
async headFile(fileUrl: string) {
  const key = fileUrl.split(`${this.bucket}/`)[1];
  if (!key) throw new Error(`无法解析 RustFS key: ${fileUrl}`);
  const response = await this.s3.send(
    new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
  );
  return {
    contentLength: response.ContentLength ?? 0,
    contentType: response.ContentType ?? 'application/octet-stream',
  };
}
```

- [ ] **Step 4: 验证——重启后端，确认无编译错误**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/database/rustfs/rustfs.service.ts
git commit -m "feat(rustfs): 新增 getFileStream 和 headFile 方法"
```

---

### Task 2: Document Entity 新增 version 和 CANCELLED

**文件：**
- 修改: `apps/server/src/modules/document/entities/document.entity.ts`

**接口：**
- 消费: 无
- 产出: `Document.version: number`, `DocumentStatus.CANCELLED`

- [ ] **Step 1: 在 `DocumentStatus` 枚举中新增 `CANCELLED`**

修改 [document.entity.ts:6-11](apps/server/src/modules/document/entities/document.entity.ts#L6-L11)：

```typescript
export enum DocumentStatus {
  UPLOADING = 'uploading',
  PARSING = 'parsing',
  PARSED = 'parsed',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',  // 新增：用户主动取消上传
}
```

- [ ] **Step 2: 在 `Document` 实体中新增 `version` 列**

在 `status` 列定义之后新增：

```typescript
/** 版本号，每次替换文件自增 */
@Column({ type: 'int', default: 1 })
version!: number;
```

- [ ] **Step 3: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 4: 验证数据库——重启后端后检查 documents 表新增了 version 列**

```bash
curl http://localhost:3001/api/documents?pageSize=1 -H "Authorization: Bearer $TOKEN"
# 响应中应包含 version 字段
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/modules/document/entities/document.entity.ts
git commit -m "feat(document): Document 实体新增 version 字段和 CANCELLED 状态"
```

---

### Task 3: 新建 DocumentVersion Entity

**文件：**
- 创建: `apps/server/src/modules/document/entities/document-version.entity.ts`
- 修改: `apps/server/src/modules/document/document.module.ts`

**接口：**
- 消费: `Document` entity (FK 引用)
- 产出: `DocumentVersion` entity class

- [ ] **Step 1: 创建 Entity 文件**

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Document } from './document.entity';

/**
 * 文档历史版本 —— 替换文件时归档旧版本
 * 纯存档用途，不参与检索
 */
@Entity('document_versions')
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  document_id!: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Column({ type: 'int' })
  version!: number;

  /** 当时的文件名 */
  @Column()
  name!: string;

  /** 旧文件在 RustFS 中的地址 */
  @Column()
  rustfs_file_url!: string;

  /** 文件大小（字节） */
  @Column({ type: 'bigint' })
  size!: number;

  /** 旧版 Markdown 正文在 MongoDB 中的 _id */
  @Column()
  mongo_doc_id!: string;

  @CreateDateColumn()
  created_at!: Date;
}
```

- [ ] **Step 2: 在 `document.module.ts` 中注册 Entity**

修改 [document.module.ts:26](apps/server/src/modules/document/document.module.ts#L26)：

```typescript
import { DocumentVersion } from './entities/document-version.entity';

// 在 imports 中：
TypeOrmModule.forFeature([Document, DocumentVersion]),
```

- [ ] **Step 3: 验证编译和数据库表创建**

```bash
cd apps/server && npx tsc --noEmit
# 重启后端后检查：document_versions 表应自动创建
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/modules/document/entities/document-version.entity.ts apps/server/src/modules/document/document.module.ts
git commit -m "feat(document): 新增 DocumentVersion 实体用于版本归档"
```

---

### Task 4: 新建 UpdateDocumentDto

**文件：**
- 创建: `apps/server/src/modules/document/dto/update-document.dto.ts`

**接口：**
- 消费: `DocumentVisibility` enum
- 产出: `UpdateDocumentDto` class

- [ ] **Step 1: 创建 DTO 文件**

```typescript
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { DocumentVisibility } from '../entities/document.entity';

/** 编辑文档元信息请求体，全部字段可选 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;

  @IsOptional()
  @IsString()
  dept_id?: string;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/document/dto/update-document.dto.ts
git commit -m "feat(document): 新增 UpdateDocumentDto"
```

---

## Phase 2: 后端 API 端点

### Task 5: 补全 GET /documents/:id 详情

**文件：**
- 修改: `apps/server/src/modules/document/document.controller.ts:39-43`

**接口：**
- 消费: `DocumentService.findById()` 已存在
- 产出: 完整文档详情 JSON

- [ ] **Step 1: 修改 controller 中的 `detail` 方法**

将空壳实现替换为：

```typescript
/** 查询单个文档详情 */
@Get(':id')
@UseGuards(JwtAuthGuard)
async detail(@Param('id') id: string) {
  const doc = await this.docService.findById(id);
  return {
    id: doc.id,
    name: doc.name,
    type: doc.type,
    size: doc.size,
    version: doc.version,
    status: doc.status,
    visibility: doc.visibility,
    uploader_id: doc.uploader_id,
    dept_id: doc.dept_id,
    mongo_doc_id: doc.mongo_doc_id,
    rustfs_file_url: doc.rustfs_file_url,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}
```

- [ ] **Step 2: 验证——curl 获取文档详情**

```bash
curl http://localhost:3001/api/documents/<DOC_ID> \
  -H "Authorization: Bearer $TOKEN"
# 预期：返回完整字段，含 version
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/document/document.controller.ts
git commit -m "fix(document): 补全 GET /documents/:id 详情接口"
```

---

### Task 6: PATCH /documents/:id 编辑元信息

**文件：**
- 修改: `apps/server/src/modules/document/document.service.ts`
- 修改: `apps/server/src/modules/document/document.controller.ts`

**接口：**
- 消费: `DocumentService.findById()`, `UpdateDocumentDto`
- 产出: `DocumentService.updateDocument(id, dto, userId): Promise<Document>`

- [ ] **Step 1: 在 `document.service.ts` 新增 `updateDocument` 方法**

```typescript
/** 编辑文档元信息（name / visibility / dept_id），仅创建者或管理员 */
async updateDocument(docId: string, dto: UpdateDocumentDto, userId: string): Promise<Document> {
  const doc = await this.findById(docId);

  // 权限检查：仅创建者或管理员
  const isAdmin = false; // 由 controller 通过 user 对象判断后传入，此处暂留
  if (doc.uploader_id !== userId) {
    throw new ForbiddenException('只能编辑自己上传的文档');
  }

  if (dto.name !== undefined) doc.name = dto.name;
  if (dto.visibility !== undefined) doc.visibility = dto.visibility;
  if (dto.dept_id !== undefined) doc.dept_id = dto.dept_id;

  return this.docRepo.save(doc);
}
```

等等——权限需要判断管理员。让我改为接收 user 对象：

```typescript
import { UpdateDocumentDto } from './dto/update-document.dto';

/** 编辑文档元信息（name / visibility / dept_id），仅创建者或管理员 */
async updateDocument(
  docId: string,
  dto: UpdateDocumentDto,
  user: { id: string; roles?: string[] },
): Promise<Document> {
  const doc = await this.findById(docId);

  // 权限检查：仅创建者或管理员
  const isAdmin = user.roles?.includes('admin');
  if (doc.uploader_id !== user.id && !isAdmin) {
    throw new ForbiddenException('只能编辑自己上传的文档');
  }

  if (dto.name !== undefined) doc.name = dto.name;
  if (dto.visibility !== undefined) doc.visibility = dto.visibility;
  if (dto.dept_id !== undefined) doc.dept_id = dto.dept_id;

  return this.docRepo.save(doc);
}
```

- [ ] **Step 2: 在 `document.controller.ts` 新增 `update` 方法**

```typescript
import { UpdateDocumentDto } from './dto/update-document.dto';

/** 编辑文档元信息 */
@Patch(':id')
@UseGuards(JwtAuthGuard)
async update(
  @Param('id') id: string,
  @Body() dto: UpdateDocumentDto,
  @CurrentUser() user: { id: string; roles?: string[] },
) {
  return this.docService.updateDocument(id, dto, user);
}
```

注意：`@CurrentUser()` 能否拿到 `roles` 取决于 JWT payload。检查一下 JWT strategy 是否返回 roles。如果当前 `CurrentUser` decorator 只返回 `{ id, dept_id }`，需要调整 JWT payload。先检查——

- [ ] **Step 3: 检查 JWT payload 是否包含 roles**

查看 `apps/server/src/common/decorators/current-user.decorator.ts` 和 JWT strategy：

```bash
grep -r "roles" apps/server/src/common/ --include="*.ts"
grep -r "validate\|payload" apps/server/src/modules/auth/ --include="*.ts" | head -20
```

如果 JWT payload 不含 roles，在 `current-user.decorator.ts` 或 JWT strategy 中补充：

```typescript
// JWT strategy validate 方法中：
return { id: payload.sub, dept_id: payload.dept_id, roles: payload.roles || [] };
```

- [ ] **Step 4: 验证——PATCH 修改文档名称**

```bash
curl -X PATCH http://localhost:3001/api/documents/<DOC_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "新文件名.md"}'
# 预期：返回 200，name 已更新
```

- [ ] **Step 5: 验证——非创建者无权限编辑**

使用其他用户的 token 调用同一接口 → 预期 403

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/modules/document/document.service.ts apps/server/src/modules/document/document.controller.ts
git commit -m "feat(document): 新增 PATCH /documents/:id 编辑元信息"
```

---

### Task 7: GET /documents/:id/file 和 GET /documents/:id/download

**文件：**
- 修改: `apps/server/src/modules/document/document.service.ts`
- 修改: `apps/server/src/modules/document/document.controller.ts`

**接口：**
- 消费: `RustFSService.getFileStream()`, `RustFSService.headFile()`
- 产出:
  ```typescript
  DocumentService.checkFileAccess(docId, user): Promise<Document>
  DocumentService.streamFile(docId, inline: boolean, res: Response): Promise<void>
  ```

- [ ] **Step 1: 在 `document.service.ts` 新增权限检查方法**

```typescript
/** 检查用户对文档的查看权限（按可见性分级） */
async checkViewAccess(docId: string, user: { id: string; dept_id: string }): Promise<Document> {
  const doc = await this.findById(docId);

  switch (doc.visibility) {
    case DocumentVisibility.PUBLIC:
      return doc;  // 所有人可看
    case DocumentVisibility.DEPT:
      if (doc.dept_id === user.dept_id) return doc;
      throw new ForbiddenException('无权查看此文档');
    case DocumentVisibility.PRIVATE:
      if (doc.uploader_id === user.id) return doc;
      throw new ForbiddenException('无权查看此文档');
    default:
      throw new ForbiddenException('无权查看此文档');
  }
}
```

- [ ] **Step 2: 在 `document.controller.ts` 新增 file 和 download 端点**

```typescript
import { Response } from 'express';
import { Get, Res, StreamableFile } from '@nestjs/common';

/** 查看原文件（浏览器内预览） */
@Get(':id/file')
@UseGuards(JwtAuthGuard)
async viewFile(
  @Param('id') id: string,
  @CurrentUser() user: { id: string; dept_id: string },
  @Res({ passthrough: true }) res: Response,
) {
  const doc = await this.docService.checkViewAccess(id, user);
  const meta = await this.rustfs.headFile(doc.rustfs_file_url);
  const stream = await this.rustfs.getFileStream(doc.rustfs_file_url);

  res.set({
    'Content-Type': meta.contentType,
    'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name)}"`,
    'Content-Length': meta.contentLength.toString(),
  });

  return new StreamableFile(stream);
}

/** 下载原文件（强制浏览器下载） */
@Get(':id/download')
@UseGuards(JwtAuthGuard)
async downloadFile(
  @Param('id') id: string,
  @CurrentUser() user: { id: string; dept_id: string },
  @Res({ passthrough: true }) res: Response,
) {
  const doc = await this.docService.checkViewAccess(id, user);
  const meta = await this.rustfs.headFile(doc.rustfs_file_url);
  const stream = await this.rustfs.getFileStream(doc.rustfs_file_url);

  res.set({
    'Content-Type': meta.contentType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.name)}"`,
    'Content-Length': meta.contentLength.toString(),
  });

  return new StreamableFile(stream);
}
```

注意：controller 构造函数中需注入 RustFSService。添加：

```typescript
import { RustFSService } from '../../database/rustfs/rustfs.service';

// constructor 中新增：
private rustfs: RustFSService,
```

- [ ] **Step 3: 验证——查看原文件**

```bash
curl -I http://localhost:3001/api/documents/<DOC_ID>/file \
  -H "Authorization: Bearer $TOKEN"
# 预期：Content-Type 匹配文件类型，200 OK
```

- [ ] **Step 4: 验证——下载原文件**

```bash
curl -I http://localhost:3001/api/documents/<DOC_ID>/download \
  -H "Authorization: Bearer $TOKEN"
# 预期：Content-Disposition: attachment
```

- [ ] **Step 5: 验证——无权限用户 403**

```bash
# 使用其他部门用户的 token 访问 dept 可见性文档
# 预期：403 Forbidden
```

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/modules/document/document.controller.ts apps/server/src/modules/document/document.service.ts
git commit -m "feat(document): 新增查看原文件和下载端点"
```

---

### Task 8: POST /documents/:id/replace 替换文件

**文件：**
- 修改: `apps/server/src/modules/document/document.service.ts`
- 修改: `apps/server/src/modules/document/document.controller.ts`

**接口：**
- 消费: `DocumentVersion` entity, `RustFSService.uploadFile()`, `MongoDBService.saveMarkdown()`, `clearIndexes()`, `triggerIndex()`
- 产出: `DocumentService.replaceFile(id, file, user): Promise<{ docId, version, status }>`

- [ ] **Step 1: 在 DocumentService 构造函数中注入 DocumentVersion repository**

修改 `document.service.ts`，在 import 区域新增：

```typescript
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentVersion } from './entities/document-version.entity';
```

在 constructor 参数中新增：

```typescript
@InjectRepository(DocumentVersion)
private versionRepo: Repository<DocumentVersion>,
```

- [ ] **Step 2: 在 `document.controller.ts` 新增 `replaceFile` 端点**

```typescript
/** 替换文件（归档旧版本 → 解析新文件 → 重建索引） */
@Post(':id/replace')
@UseGuards(JwtAuthGuard)
@UseInterceptors(FileInterceptor('file'))
async replaceFile(
  @Param('id') id: string,
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser() user: { id: string; roles?: string[] },
) {
  return this.docService.replaceFile(id, file, user);
}
```

- [ ] **Step 3: 在 `document.service.ts` 新增 `replaceFile` 方法**

```typescript
/** 替换文件：归档当前版本 → 上传新文件 → 解析 → 更新 DB → 重建索引 */
async replaceFile(
  docId: string,
  file: Express.Multer.File,
  user: { id: string; roles?: string[] },
): Promise<{ docId: string; version: number; status: string }> {
  const doc = await this.findById(docId);

  // 权限检查：仅创建者或管理员
  const isAdmin = user.roles?.includes('admin');
  if (doc.uploader_id !== user.id && !isAdmin) {
    throw new ForbiddenException('无权替换此文档的文件');
  }

  const uploadedUrls: string[] = [];
  const previousVersion = doc.version;
  let archived = false;

  try {
    // 1. 归档当前版本
    const versionRecord = this.versionRepo.create({
      document_id: doc.id,
      version: previousVersion,
      name: doc.name,
      rustfs_file_url: doc.rustfs_file_url,
      size: doc.size,
      mongo_doc_id: doc.mongo_doc_id,
    });
    await this.versionRepo.save(versionRecord);
    archived = true;

    // 2. 上传新文件到 RustFS
    const fileUrl = await this.rustfs.uploadFile(file.buffer, file.originalname, file.mimetype);
    uploadedUrls.push(fileUrl);

    // 3. 解析新文件
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'txt';
    const type = TYPE_MAP[ext] || 'text';
    const parser = this.parsers.get(type);
    if (!parser) throw new BadRequestException(`不支持的文件类型: ${ext}`);

    const result: ParseResult = await parser.parse(file.buffer, file.originalname);

    // 4. 上传图片
    for (const img of result.images) {
      const imgUrl = await this.rustfs.uploadFile(img.buffer, img.originalName, img.mimeType);
      uploadedUrls.push(imgUrl);
      result.markdown = result.markdown.replace(img.placeholderInMd, imgUrl);
    }

    // 5. 更新 MongoDB 正文
    await this.mongo.saveMarkdown(doc.id, result.markdown, result.metadata);

    // 6. 更新 Postgres 元信息
    doc.name = file.originalname;
    doc.type = type;
    doc.size = file.size;
    doc.rustfs_file_url = fileUrl;
    doc.version = previousVersion + 1;
    doc.status = DocumentStatus.PARSED;
    await this.docRepo.save(doc);

    // 7. 清理旧索引
    await this.clearIndexes(doc.id); // ← 注意：clearIndexes 会把 status 重置为 PARSED，但上面已设为 PARSED，无影响

    // 8. 触发新索引（异步）
    this.triggerIndex(doc.id, user.id).catch((err) => {
      this.logger.error(`替换文件后索引失败: ${doc.id}`, err.message);
    });

    return { docId: doc.id, version: doc.version, status: doc.status };

  } catch (error) {
    // 回滚
    for (const url of uploadedUrls) {
      await this.rustfs.deleteFile(url).catch(() => {});
    }
    // 如果已归档，回滚归档记录
    if (archived) {
      await this.versionRepo.delete({
        document_id: doc.id,
        version: previousVersion,
      });
    }
    throw error;
  }
}
```

- [ ] **Step 4: 验证——替换文件**

```bash
curl -X POST http://localhost:3001/api/documents/<DOC_ID>/replace \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@new-file.md"
# 预期：{"docId": "...", "version": 2, "status": "parsed"}
```

- [ ] **Step 5: 验证——版本号自增 + 归档记录**

```bash
# 查文档详情，version 应为 2
curl http://localhost:3001/api/documents/<DOC_ID> -H "Authorization: Bearer $TOKEN"

# 查版本列表
curl http://localhost:3001/api/documents/<DOC_ID>/versions -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 6: 验证——索引重建**

等待约 30 秒后查文档状态应变为 `indexed`。

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/modules/document/document.service.ts apps/server/src/modules/document/document.controller.ts
git commit -m "feat(document): 新增 POST /documents/:id/replace 替换文件"
```

---

### Task 9: POST /documents/:id/cancel 取消上传

**文件：**
- 修改: `apps/server/src/modules/document/document.service.ts`
- 修改: `apps/server/src/modules/document/document.controller.ts`

**接口：**
- 消费: `DocumentService.findById()`, `RustFSService.deleteFile()`, `MongoDBService.deleteByDocId()`
- 产出: `DocumentService.cancelUpload(id, userId): Promise<{ docId, status }>`

- [ ] **Step 1: 在 `document.service.ts` 新增 `cancelUpload` 方法**

```typescript
/** 取消上传：仅 uploading / parsing 状态可取消 */
async cancelUpload(
  docId: string,
  userId: string,
): Promise<{ docId: string; status: string }> {
  const doc = await this.findById(docId);

  if (doc.uploader_id !== userId) {
    throw new ForbiddenException('只能取消自己上传的文档');
  }

  if (doc.status !== DocumentStatus.UPLOADING && doc.status !== DocumentStatus.PARSING) {
    throw new BadRequestException(`文档状态为 ${doc.status}，无法取消`);
  }

  const errors: string[] = [];

  // 1. 清理 RustFS 文件
  try {
    await this.rustfs.deleteFile(doc.rustfs_file_url);
  } catch (e) { errors.push('RustFS'); }

  // 2. 清理 MongoDB（如果有 pending 或已写入的正文）
  try {
    await this.mongo.deleteByDocId(doc.id);
  } catch (e) { errors.push('MongoDB'); }

  // 3. 状态改为 cancelled
  doc.status = DocumentStatus.CANCELLED;
  await this.docRepo.save(doc);

  if (errors.length > 0) {
    this.logger.warn(`取消上传部分清理失败: ${errors.join(', ')}`);
  }

  return { docId: doc.id, status: doc.status };
}
```

- [ ] **Step 2: 在 `document.controller.ts` 新增 `cancel` 端点**

```typescript
/** 取消上传 */
@Post(':id/cancel')
@UseGuards(JwtAuthGuard)
async cancel(
  @Param('id') id: string,
  @CurrentUser() user: { id: string },
) {
  return this.docService.cancelUpload(id, user.id);
}
```

- [ ] **Step 3: 验证——取消一个 uploading 状态的文档**

```bash
curl -X POST http://localhost:3001/api/documents/<DOC_ID>/cancel \
  -H "Authorization: Bearer $TOKEN"
# 预期：{"docId": "...", "status": "cancelled"}
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/modules/document/document.service.ts apps/server/src/modules/document/document.controller.ts
git commit -m "feat(document): 新增 POST /documents/:id/cancel 取消上传"
```

---

### Task 10: GET 版本列表和历史版本查看

**文件：**
- 修改: `apps/server/src/modules/document/document.service.ts`
- 修改: `apps/server/src/modules/document/document.controller.ts`

**接口：**
- 消费: `DocumentVersion` repository, `RustFSService.getFileStream()`
- 产出:
  ```typescript
  DocumentService.getVersions(docId): Promise<DocumentVersion[]>
  DocumentService.getVersionFile(versionId): Promise<{ stream, filename, contentType }>
  ```

- [ ] **Step 1: 在 `document.service.ts` 新增 `getVersions` 方法**

```typescript
/** 获取文档的历史版本列表（不含当前活跃版本） */
async getVersions(docId: string): Promise<DocumentVersion[]> {
  // 先确认文档存在
  await this.findById(docId);
  return this.versionRepo.find({
    where: { document_id: docId },
    order: { version: 'DESC' },
    select: ['id', 'version', 'name', 'size', 'created_at'],
  });
}
```

- [ ] **Step 2: 在 `document.service.ts` 新增 `getVersionFile` 方法**

```typescript
/** 获取历史版本文件流 */
async getVersionFile(versionId: string): Promise<{
  stream: import('stream').Readable;
  filename: string;
  contentType: string;
}> {
  const version = await this.versionRepo.findOne({ where: { id: versionId } });
  if (!version) throw new NotFoundException('版本不存在');

  const meta = await this.rustfs.headFile(version.rustfs_file_url);
  const stream = await this.rustfs.getFileStream(version.rustfs_file_url);

  return {
    stream,
    filename: version.name,
    contentType: meta.contentType,
  };
}
```

- [ ] **Step 3: 在 `document.controller.ts` 新增两个端点**

```typescript
/** 版本历史列表 */
@Get(':id/versions')
@UseGuards(JwtAuthGuard)
async listVersions(
  @Param('id') id: string,
  @CurrentUser() user: { id: string; dept_id: string },
) {
  // 复用查看权限
  await this.docService.checkViewAccess(id, user);
  return this.docService.getVersions(id);
}

/** 查看历史版本文件 */
@Get('versions/:versionId/file')
@UseGuards(JwtAuthGuard)
async viewVersionFile(
  @Param('versionId') versionId: string,
  @Res({ passthrough: true }) res: Response,
) {
  const { stream, filename, contentType } = await this.docService.getVersionFile(versionId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
  });
  return new StreamableFile(stream);
}
```

> **注意：** `GET versions/:versionId/file` 和 `GET :id/file` 路由有潜在冲突——`versions` 可能被解析为 `:id`。NestJS 按注册顺序匹配，将 `versions/:versionId/file` **放在** `:id` 路由**之前**注册即可避免。

- [ ] **Step 4: 调整 controller 方法声明顺序**

确保 controller 中方法顺序为：
1. `@Get('versions/:versionId/file')` — 历史版本查看
2. `@Get(':id/versions')` — 版本列表
3. `@Get(':id/file')` — 查看当前文件
4. `@Get(':id/download')` — 下载当前文件
5. `@Get(':id/preview')` — Markdown 预览（已有）
6. `@Get(':id')` — 文档详情

- [ ] **Step 5: 验证——获取版本列表**

```bash
curl http://localhost:3001/api/documents/<DOC_ID>/versions \
  -H "Authorization: Bearer $TOKEN"
# 预期：数组，每个元素含 id/version/name/size/created_at
```

- [ ] **Step 6: 验证——查看历史版本文件**

```bash
curl -I http://localhost:3001/api/documents/versions/<VERSION_ID>/file \
  -H "Authorization: Bearer $TOKEN"
# 预期：200，Content-Type 匹配文件类型
```

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/modules/document/document.service.ts apps/server/src/modules/document/document.controller.ts
git commit -m "feat(document): 新增版本列表和历史版本查看端点"
```

---

## Phase 3: 前端实现

### Task 11: SearchBar 组件

**文件：**
- 创建: `apps/web/src/components/document/SearchBar.tsx`

**接口：**
- 消费: 无
- 产出:
  ```tsx
  <SearchBar
    onSearch: (filters: { keyword?: string; type?: string; status?: string }) => void
  />
  ```

- [ ] **Step 1: 创建组件目录并写组件**

```bash
mkdir -p apps/web/src/components/document
```

```tsx
import { Input, Select, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word' },
  { value: 'excel', label: 'Excel' },
  { value: 'ppt', label: 'PPT' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'uploading', label: '上传中' },
  { value: 'indexed', label: '已上传' },
  { value: 'failed', label: '已失败' },
  { value: 'cancelled', label: '已取消' },
];

interface SearchFilters {
  keyword?: string;
  type?: string;
  status?: string;
}

interface Props {
  onSearch: (filters: SearchFilters) => void;
}

export default function SearchBar({ onSearch }: Props) {
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const handleSearch = () => {
    onSearch({ keyword: keyword || undefined, type: type || undefined, status: status || undefined });
  };

  return (
    <Space style={{ marginBottom: 16 }} wrap>
      <Input
        placeholder="搜索文件名..."
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={handleSearch}
        style={{ width: 200 }}
        prefix={<SearchOutlined />}
        allowClear
      />
      <Select
        value={type}
        onChange={(v) => setType(v)}
        options={TYPE_OPTIONS}
        style={{ width: 120 }}
      />
      <Select
        value={status}
        onChange={(v) => setStatus(v)}
        options={STATUS_OPTIONS}
        style={{ width: 120 }}
      />
      <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
        搜索
      </Button>
    </Space>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/document/SearchBar.tsx
git commit -m "feat(web): 新增 SearchBar 组件"
```

---

### Task 12: DocumentEditModal 组件

**文件：**
- 创建: `apps/web/src/components/document/DocumentEditModal.tsx`

**接口：**
- 消费: `api.patch('/documents/:id', dto)`
- 产出:
  ```tsx
  <DocumentEditModal
    open: boolean
    document: { id, name, visibility, dept_id }
    onClose: () => void
    onSuccess: () => void
  />
  ```

- [ ] **Step 1: 创建组件**

```tsx
import { Modal, Form, Input, Select, App } from 'antd';
import { useEffect } from 'react';
import api from '../../services/api';

interface DocInfo {
  id: string;
  name: string;
  visibility: string;
  dept_id?: string;
}

interface Props {
  open: boolean;
  document: DocInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DocumentEditModal({ open, document, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  useEffect(() => {
    if (document) {
      form.setFieldsValue({
        name: document.name,
        visibility: document.visibility,
        dept_id: document.dept_id || '',
      });
    }
  }, [document, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      await api.patch(`/documents/${document!.id}`, {
        name: values.name,
        visibility: values.visibility,
        dept_id: values.dept_id || undefined,
      });
      message.success('修改成功');
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '修改失败');
    }
  };

  return (
    <Modal
      title="编辑文档"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="文件名" rules={[{ required: true, message: '请输入文件名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="visibility" label="可见性" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'public', label: '公开 — 所有人可见' },
              { value: 'dept', label: '部门 — 仅本部门可见' },
              { value: 'private', label: '私有 — 仅自己可见' },
            ]}
          />
        </Form.Item>
        <Form.Item name="dept_id" label="所属部门">
          <Input placeholder="部门 ID（留空则不修改）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/document/DocumentEditModal.tsx
git commit -m "feat(web): 新增 DocumentEditModal 编辑弹窗"
```

---

### Task 13: DocumentReplaceModal 组件

**文件：**
- 创建: `apps/web/src/components/document/DocumentReplaceModal.tsx`

**接口：**
- 消费: `api.post('/documents/:id/replace', formData)`
- 产出:
  ```tsx
  <DocumentReplaceModal
    open: boolean
    document: { id, name }
    onClose: () => void
    onSuccess: () => void
  />
  ```

- [ ] **Step 1: 创建组件**

```tsx
import { Modal, Upload, App } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { UploadFile } from 'antd/es/upload/interface';
import api from '../../services/api';

const { Dragger } = Upload;

interface Props {
  open: boolean;
  document: { id: string; name: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DocumentReplaceModal({ open, document, onClose, onSuccess }: Props) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();

  const handleReplace = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post(`/documents/${document!.id}/replace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(`替换成功 — 版本 ${data.version}`);
      setFileList([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '替换失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={`替换文件 — ${document?.name || ''}`}
      open={open}
      onOk={handleReplace}
      onCancel={() => { setFileList([]); onClose(); }}
      okText="上传并替换"
      cancelText="取消"
      confirmLoading={uploading}
      destroyOnClose
      okButtonProps={{ disabled: fileList.length === 0 }}
    >
      <Dragger
        fileList={fileList}
        beforeUpload={() => false}
        onChange={({ fileList: fl }) => setFileList(fl)}
        maxCount={1}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4"
        onRemove={() => setFileList([])}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">点击或拖拽新文件到此区域</p>
        <p className="ant-upload-hint">替换后将自动归档当前版本并重建索引</p>
      </Dragger>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/document/DocumentReplaceModal.tsx
git commit -m "feat(web): 新增 DocumentReplaceModal 替换文件弹窗"
```

---

### Task 14: DocumentDetailDrawer 组件

**文件：**
- 创建: `apps/web/src/components/document/DocumentDetailDrawer.tsx`

**接口：**
- 消费: `api.get('/documents/:id')`, `api.get('/documents/:id/versions')`
- 产出:
  ```tsx
  <DocumentDetailDrawer
    open: boolean
    docId: string | null
    onClose: () => void
  />
  ```

- [ ] **Step 1: 创建组件**

```tsx
import { Drawer, Descriptions, Table, Tag, Spin, App } from 'antd';
import { useEffect, useState } from 'react';
import api from '../../services/api';

const STATUS_LABELS: Record<string, string> = {
  uploading: '上传中', parsing: '上传中', parsed: '上传中', indexing: '上传中',
  indexed: '已上传', failed: '已失败', cancelled: '已取消',
};

const STATUS_COLORS: Record<string, string> = {
  uploading: 'blue', parsing: 'blue', parsed: 'blue', indexing: 'blue',
  indexed: 'green', failed: 'red', cancelled: 'default',
};

const VIS_LABELS: Record<string, string> = {
  public: '公开', dept: '部门', private: '私有',
};

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  open: boolean;
  docId: string | null;
  onClose: () => void;
}

export default function DocumentDetailDrawer({ open, docId, onClose }: Props) {
  const [doc, setDoc] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (open && docId) {
      setLoading(true);
      Promise.all([
        api.get(`/documents/${docId}`).then(r => setDoc(r.data)),
        api.get(`/documents/${docId}/versions`).then(r => setVersions(r.data)),
      ]).catch(() => message.error('加载文档详情失败'))
        .finally(() => setLoading(false));
    }
  }, [open, docId]);

  const versionColumns = [
    { title: '版本', dataIndex: 'version', key: 'version' },
    { title: '文件名', dataIndex: 'name', key: 'name' },
    {
      title: '大小', dataIndex: 'size', key: 'size',
      render: (s: number) => formatSize(s),
    },
    {
      title: '归档时间', dataIndex: 'created_at', key: 'created_at',
      render: (d: string) => d ? new Date(d).toLocaleString() : '-',
    },
  ];

  return (
    <Drawer
      title="文档详情"
      open={open}
      onClose={onClose}
      width={640}
    >
      {loading ? <Spin /> : doc && (
        <>
          <Descriptions column={2} bordered size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label="文件名">{doc.name}</Descriptions.Item>
            <Descriptions.Item label="类型">{doc.type}</Descriptions.Item>
            <Descriptions.Item label="大小">{formatSize(doc.size)}</Descriptions.Item>
            <Descriptions.Item label="版本">v{doc.version}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_COLORS[doc.status]}>
                {STATUS_LABELS[doc.status] || doc.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="可见性">
              {VIS_LABELS[doc.visibility] || doc.visibility}
            </Descriptions.Item>
            <Descriptions.Item label="上传时间" span={2}>
              {doc.created_at ? new Date(doc.created_at).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>

          <h4>📜 历史版本</h4>
          {versions.length === 0 ? (
            <p style={{ color: '#999' }}>暂无历史版本</p>
          ) : (
            <Table
              columns={versionColumns}
              dataSource={versions}
              rowKey="id"
              size="small"
              pagination={false}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/document/DocumentDetailDrawer.tsx
git commit -m "feat(web): 新增 DocumentDetailDrawer 详情抽屉"
```

---

### Task 15: DocumentManagePage 全面改造

**文件：**
- 修改: `apps/web/src/pages/document/DocumentManagePage.tsx`

**接口：**
- 消费: `SearchBar`, `DocumentEditModal`, `DocumentReplaceModal`, `DocumentDetailDrawer`, `api`
- 产出: 完整的四态文档管理页

- [ ] **Step 1: 重写 `DocumentManagePage.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Popconfirm, Tag, Space, App } from 'antd';
import {
  EyeOutlined, DownloadOutlined, EditOutlined,
  SwapOutlined, CloseCircleOutlined, DeleteOutlined,
  PlusOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import SearchBar from '../../components/document/SearchBar';
import DocumentEditModal from '../../components/document/DocumentEditModal';
import DocumentReplaceModal from '../../components/document/DocumentReplaceModal';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';

// ── 前端四态 ──
function toFrontendStatus(status: string): string {
  switch (status) {
    case 'uploading': case 'parsing': case 'parsed': case 'indexing':
      return 'uploading';
    case 'indexed':   return 'indexed';
    case 'failed':    return 'failed';
    case 'cancelled': return 'cancelled';
    default:          return 'failed';
  }
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  uploading:  { label: '上传中', color: 'blue' },
  cancelled:  { label: '已取消', color: 'default' },
  indexed:    { label: '已上传', color: 'green' },
  failed:     { label: '已失败', color: 'red' },
};

const TYPE_ICONS: Record<string, string> = {
  pdf: '📕', word: '📝', excel: '📊', ppt: '📽️',
  markdown: '📄', text: '📃', image: '🖼️', audio: '🎵', video: '🎬',
};

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{ keyword?: string; type?: string; status?: string }>({});

  // 弹窗状态
  const [editDoc, setEditDoc] = useState<any>(null);
  const [replaceDoc, setReplaceDoc] = useState<any>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const { message } = App.useApp();
  const navigate = useNavigate();

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.type) params.type = filters.type;
      if (filters.status) params.status = filters.status;
      const { data } = await api.get('/documents', { params });
      setDocuments(data.items || []);
      setTotal(data.total || 0);
    } catch {
      message.error('加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // 轮询：有 uploading 状态时每 5 秒刷新
  useEffect(() => {
    const hasUploading = documents.some(d => toFrontendStatus(d.status) === 'uploading');
    if (!hasUploading) return;
    const timer = setInterval(loadDocuments, 5000);
    return () => clearInterval(timer);
  }, [documents, loadDocuments]);

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/documents/${id}`);
      setDocuments(prev => prev.filter(d => d.id !== id));
      message.success('删除成功');
    } catch { message.error('删除失败'); }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.post(`/documents/${id}/cancel`);
      message.success('已取消上传');
      loadDocuments();
    } catch (err: any) { message.error(err.response?.data?.message || '取消失败'); }
  };

  const handleViewFile = (id: string) => {
    window.open(`/api/documents/${id}/file`, '_blank');
  };

  const handleDownload = (id: string) => {
    const a = document.createElement('a');
    a.href = `/api/documents/${id}/download`;
    a.click();
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name: string, record: any) => (
        <a onClick={() => setDetailDocId(record.id)} style={{ cursor: 'pointer' }}>
          {TYPE_ICONS[record.type] || '📄'} {name}
        </a>
      ),
    },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
    {
      title: '大小', dataIndex: 'size', key: 'size', width: 100,
      render: (s: number) => formatSize(s),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const fs = STATUS_MAP[toFrontendStatus(s)] || { label: s, color: 'default' };
        return <Tag color={fs.color}>{fs.label}</Tag>;
      },
    },
    {
      title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 120,
      render: (d: string) => d ? new Date(d).toLocaleDateString() : '-',
    },
    {
      title: '操作', key: 'actions', width: 240,
      render: (_: unknown, record: any) => {
        const fs = toFrontendStatus(record.status);
        return (
          <Space size="small">
            {/* 👁 查看 — 全部状态 */}
            <Button size="small" icon={<EyeOutlined />}
              onClick={() => handleViewFile(record.id)}>查看</Button>

            {/* 📥 下载 — 仅已上传 */}
            {fs === 'indexed' && (
              <Button size="small" icon={<DownloadOutlined />}
                onClick={() => handleDownload(record.id)}>下载</Button>
            )}

            {/* ✏️ 编辑 — 仅已上传 */}
            {fs === 'indexed' && (
              <Button size="small" icon={<EditOutlined />}
                onClick={() => setEditDoc(record)}>编辑</Button>
            )}

            {/* 🔄 替换 — 已取消 / 已上传 / 已失败 */}
            {(fs === 'cancelled' || fs === 'indexed' || fs === 'failed') && (
              <Button size="small" icon={<SwapOutlined />}
                onClick={() => setReplaceDoc(record)}>替换</Button>
            )}

            {/* ❌ 取消 — 仅上传中 */}
            {fs === 'uploading' && (
              <Popconfirm title="确定要取消上传吗？" onConfirm={() => handleCancel(record.id)}>
                <Button size="small" icon={<CloseCircleOutlined />}>取消</Button>
              </Popconfirm>
            )}

            {/* 🗑 删除 — 已取消 / 已上传 / 已失败 */}
            {(fs === 'cancelled' || fs === 'indexed' || fs === 'failed') && (
              <Popconfirm title="确定删除？此操作不可撤销。" onConfirm={() => handleDelete(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>📂 文档管理</h1>
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => navigate('/documents')}>上传文档</Button>
      </div>

      <SearchBar onSearch={(f) => { setFilters(f); setPage(1); }} />

      <Table
        columns={columns}
        dataSource={documents}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 篇文档`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <DocumentEditModal
        open={!!editDoc}
        document={editDoc}
        onClose={() => setEditDoc(null)}
        onSuccess={loadDocuments}
      />

      <DocumentReplaceModal
        open={!!replaceDoc}
        document={replaceDoc}
        onClose={() => setReplaceDoc(null)}
        onSuccess={loadDocuments}
      />

      <DocumentDetailDrawer
        open={!!detailDocId}
        docId={detailDocId}
        onClose={() => setDetailDocId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 浏览器验证**

1. 打开 `http://localhost:3000/documents/manage`
2. 确认：搜索栏、分页、上传按钮、操作按钮矩阵
3. 点击文件名 → 右侧抽屉详情
4. 点击 ✏️ → 编辑弹窗
5. 点击 🔄 → 替换弹窗
6. 确认 uploading 状态文档显示"取消"按钮
7. 确认 uploading 状态时表格每 5 秒自动刷新

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/document/DocumentManagePage.tsx
git commit -m "feat(web): 全面改造 DocumentManagePage — 四态管理 + 搜索分页"
```

---

### Task 16: 侧边栏导航调整 + 上传页补充

**文件：**
- 修改: `apps/web/src/components/layout/Layout.tsx`
- 修改: `apps/web/src/pages/document/DocumentUploadPage.tsx`

- [ ] **Step 1: 修改侧边栏「文档管理」链接为 `/documents/manage`**

在 [Layout.tsx:17-22](apps/web/src/components/layout/Layout.tsx#L17-L22) 中：

```typescript
const menuItems = [
  { key: '/knowledge', icon: <FolderOutlined />, label: '知识库' },
  { key: '/chat', icon: <MessageOutlined />, label: 'AI 问答' },
  { key: '/documents/manage', icon: <FileTextOutlined />, label: '文档管理' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '数据统计' },
];
```

同时修改 `selectedKey` 的计算逻辑，确保 `/documents` 和 `/documents/manage` 都能高亮：

```typescript
const pathname = location.pathname;
const selectedKey = pathname.startsWith('/documents') ? '/documents/manage' : '/' + pathname.split('/')[1];
```

- [ ] **Step 2: 在上传页添加返回管理页的链接**

在 `DocumentUploadPage.tsx` 页面顶部添加导航：

```tsx
import { Link } from 'react-router-dom';
import { Breadcrumb } from 'antd';

// 在 return 的 <div> 开头加入：
<Breadcrumb style={{ marginBottom: 16 }}
  items={[
    { title: <Link to="/documents/manage">文档管理</Link> },
    { title: '上传文档' },
  ]}
/>
```

- [ ] **Step 3: 验证——侧边栏跳转管理页**

点击侧边栏"文档管理" → 跳转 `/documents/manage`（管理页），管理页顶部 `[+ 上传文档]` → 跳转 `/documents`（上传页），上传页面包屑 → 返回管理页。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/layout/Layout.tsx apps/web/src/pages/document/DocumentUploadPage.tsx
git commit -m "feat(web): 侧边栏导航调整 + 上传页面包屑"
```

---

## 完成检查清单

- [ ] RustFS 可获取文件流 (`getFileStream` / `headFile`)
- [ ] Document entity 有 `version` 字段和 `CANCELLED` 状态
- [ ] `document_versions` 表已创建，可写入归档
- [ ] `GET /documents/:id` 返回完整详情
- [ ] `PATCH /documents/:id` 可修改名称/可见性/部门，非创建者 403
- [ ] `GET /documents/:id/file` 浏览器中查看原文件
- [ ] `GET /documents/:id/download` 触发浏览器下载
- [ ] `POST /documents/:id/replace` 替换文件，版本号+1，索引重建
- [ ] `POST /documents/:id/cancel` 取消上传中文件，清理存储
- [ ] `GET /documents/:id/versions` 返回版本历史
- [ ] `GET /documents/versions/:versionId/file` 查看历史版本
- [ ] 前端管理页四态展示 + 操作按钮矩阵
- [ ] 前端搜索分页 + 编辑/替换弹窗 + 详情抽屉
- [ ] 侧边栏导航正确，上传页面包屑正常
