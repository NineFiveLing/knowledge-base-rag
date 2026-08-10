# 知识库文件夹层级体系 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入「知识库 → 文件夹（多级嵌套）→ 文档」三级层级体系，替代当前全局扁平文档池。

**Architecture:** 新增 `knowledge_bases` 和 `folders` 两张表，`documents` 表增加 `folder_id` 外键。后端新建 `KnowledgeBaseModule`，前端新建知识库列表页和文件夹浏览页，改造文档上传/管理页增加 KB+文件夹选择。

**Tech Stack:** NestJS + TypeORM + class-validator | React + Ant Design 5 + react-router-dom v6 + axios

## Global Constraints

- TypeORM `synchronize: true` 自动同步 DDL，无需手写迁移
- 所有 API 路由受 `JwtAuthGuard` 保护
- 用户信息通过 `@CurrentUser()` 装饰器获取
- 前端 API 调用统一使用 `services/api.ts` 的 axios 实例
- DTO 使用 `class-validator` + `class-transformer` 装饰器校验
- 遵循现有代码风格和项目结构

---

### Task 1: 创建 KnowledgeBase Entity

**Files:**
- Create: `apps/server/src/modules/knowledge-base/entities/knowledge-base.entity.ts`

**Interfaces:**
- Produces: `KnowledgeBase` entity class（`id`, `name`, `description`, `created_by`, `created_at`, `updated_at`）

- [ ] **Step 1: 创建 knowledge-base.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

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

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 2: 创建 Folder Entity

**Files:**
- Create: `apps/server/src/modules/knowledge-base/entities/folder.entity.ts`

**Interfaces:**
- Produces: `Folder` entity class（`id`, `kb_id`, `parent_id`, `name`, `created_at`, `updated_at`）
- Consumes: `KnowledgeBase` from Task 1

- [ ] **Step 1: 创建 folder.entity.ts**

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';

@Entity('folders')
@Index(['kb_id'])
@Unique(['kb_id', 'parent_id', 'name'])
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  kb_id!: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'kb_id' })
  knowledgeBase!: KnowledgeBase;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  parent_id!: string | null;

  @ManyToOne(() => Folder, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent!: Folder | null;

  @Column({ length: 200 })
  name!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 3: 给 Document Entity 增加 folder_id 字段

**Files:**
- Modify: `apps/server/src/modules/document/entities/document.entity.ts`

**Interfaces:**
- Produces: `Document.folder_id: string | null` 可选外键

- [ ] **Step 1: 在 Document entity 中新增 folder_id 列和关联**

在 `document.entity.ts` 中，在 `version` 字段后新增：

```typescript
import { Folder } from '../../knowledge-base/entities/folder.entity';

// 在 version 字段之后、created_at 之前添加：
/** 所属文件夹 folders.id，可为 NULL（兼容旧数据），父文件夹删除时 SET NULL */
@Column({ type: 'uuid', nullable: true })
@Index()
folder_id!: string | null;

@ManyToOne(() => Folder, { nullable: true, onDelete: 'SET NULL' })
@JoinColumn({ name: 'folder_id' })
folder!: Folder | null;
```

注意：需要在文件顶部新增 import `import { Folder } from '../../knowledge-base/entities/folder.entity';`

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 4: 创建 KnowledgeBase + Folder 相关 DTO

**Files:**
- Create: `apps/server/src/modules/knowledge-base/dto/create-kb.dto.ts`
- Create: `apps/server/src/modules/knowledge-base/dto/update-kb.dto.ts`
- Create: `apps/server/src/modules/knowledge-base/dto/create-folder.dto.ts`
- Create: `apps/server/src/modules/knowledge-base/dto/move-folder.dto.ts`

**Interfaces:**
- Produces: `CreateKnowledgeBaseDto`, `UpdateKnowledgeBaseDto`, `CreateFolderDto`, `MoveFolderDto`

- [ ] **Step 1: 创建 create-kb.dto.ts**

```typescript
import { IsString, IsOptional, Length } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 2: 创建 update-kb.dto.ts**

```typescript
import { IsString, IsOptional, Length } from 'class-validator';

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 3: 创建 create-folder.dto.ts**

```typescript
import { IsUUID, IsString, IsOptional, Length } from 'class-validator';

export class CreateFolderDto {
  @IsUUID()
  kb_id!: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsString()
  @Length(1, 200)
  name!: string;
}
```

- [ ] **Step 4: 创建 move-folder.dto.ts**

```typescript
import { IsUUID, IsOptional } from 'class-validator';

export class MoveFolderDto {
  @IsOptional()
  @IsUUID()
  new_parent_id?: string | null;  // null 表示移到根目录
}
```

- [ ] **Step 5: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 5: 更新 ListDocumentDto 和 UpdateDocumentDto

**Files:**
- Modify: `apps/server/src/modules/document/dto/list-document.dto.ts`
- Modify: `apps/server/src/modules/document/dto/update-document.dto.ts`

**Interfaces:**
- Produces: `ListDocumentDto` 新增 `kb_id`、`folder_id` 查询参数；`UpdateDocumentDto` 新增 `folder_id` 可选字段

- [ ] **Step 1: 更新 list-document.dto.ts**

在现有 `keyword` 字段之后新增：

```typescript
  @IsOptional()
  @IsUUID()
  kb_id?: string;

  @IsOptional()
  @IsUUID()
  folder_id?: string;
```

同时新增 `import { IsUUID } from 'class-validator';` 到顶部。

- [ ] **Step 2: 更新 update-document.dto.ts**

在 `dept_id` 字段之后新增：

```typescript
  @IsOptional()
  @IsUUID()
  folder_id?: string;
```

同时新增 `import { IsUUID } from 'class-validator';` 到顶部。

- [ ] **Step 3: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 6: 创建 KnowledgeBaseModule

**Files:**
- Create: `apps/server/src/modules/knowledge-base/kb.module.ts`

**Interfaces:**
- Produces: `KnowledgeBaseModule`（导入 TypeORM entities、注册 Service/Controller、导出 TypeOrmModule）
- Consumes: `KnowledgeBase` from Task 1, `Folder` from Task 2

- [ ] **Step 1: 创建 kb.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { Folder } from './entities/folder.entity';
import { KnowledgeBaseService } from './kb.service';
import { KnowledgeBaseController } from './kb.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Folder])],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [TypeOrmModule, KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 7: 创建 KnowledgeBaseService

**Files:**
- Create: `apps/server/src/modules/knowledge-base/kb.service.ts`

**Interfaces:**
- Produces: `KnowledgeBaseService`（KB CRUD + Folder CRUD + 文件夹树组装 + 循环引用校验）
- Consumes: `KnowledgeBase` from Task 1, `Folder` from Task 2, DTOs from Task 4, `Document` entity from Task 3

- [ ] **Step 1: 创建 kb.service.ts — 类骨架和依赖注入**

```typescript
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { Folder } from './entities/folder.entity';
import { Document } from '../document/entities/document.entity';
import { CreateKnowledgeBaseDto } from './dto/create-kb.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-kb.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveFolderDto } from './dto/move-folder.dto';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase) private kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(Folder) private folderRepo: Repository<Folder>,
    @InjectRepository(Document) private docRepo: Repository<Document>,
  ) {}
}
```

- [ ] **Step 2: 实现知识库 CRUD 方法**

在类中追加：

```typescript
  /** 创建知识库 */
  async create(dto: CreateKnowledgeBaseDto, userId: string): Promise<KnowledgeBase> {
    const kb = this.kbRepo.create({ ...dto, created_by: userId });
    return this.kbRepo.save(kb);
  }

  /** 列出所有知识库（含文档计数） */
  async list(): Promise<{ id: string; name: string; description: string; docCount: number; created_at: Date }[]> {
    const kbs = await this.kbRepo.find({ order: { created_at: 'DESC' } });
    const results: any[] = [];
    for (const kb of kbs) {
      // 获取该 KB 下所有文件夹的 ID
      const folderIds = await this.getFolderIdsByKb(kb.id);
      // 统计这些文件夹下的文档数
      const docCount = await this.docRepo
        .createQueryBuilder('doc')
        .where('doc.folder_id IN (:...ids)', { ids: folderIds.length ? folderIds : ['__none__'] })
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

  /** 单个知识库详情 */
  async findById(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    return kb;
  }

  /** 编辑知识库 */
  async update(id: string, dto: UpdateKnowledgeBaseDto, userId: string, isAdmin: boolean): Promise<KnowledgeBase> {
    const kb = await this.findById(id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('只能编辑自己创建的知识库');
    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description;
    return this.kbRepo.save(kb);
  }

  /** 删除知识库（CASCADE 删除文件夹，文档 folder_id SET NULL） */
  async delete(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const kb = await this.findById(id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('只能删除自己创建的知识库');
    await this.kbRepo.remove(kb);
  }
```

- [ ] **Step 3: 实现文件夹 CRUD 方法**

```typescript
  /** 创建文件夹 */
  async createFolder(dto: CreateFolderDto): Promise<Folder> {
    // 校验 KB 存在
    await this.findById(dto.kb_id);
    // 如果指定了 parent_id，校验父文件夹存在且属于同一 KB
    if (dto.parent_id) {
      const parent = await this.findFolderById(dto.parent_id);
      if (parent.kb_id !== dto.kb_id) throw new BadRequestException('父文件夹不属于该知识库');
    }
    const folder = this.folderRepo.create({ kb_id: dto.kb_id, parent_id: dto.parent_id || null, name: dto.name });
    return this.folderRepo.save(folder);
  }

  /** 获取文件夹树 */
  async getFolderTree(kbId: string): Promise<any[]> {
    const folders = await this.folderRepo.find({
      where: { kb_id: kbId },
      select: { id: true, parent_id: true, name: true, created_at: true },
      order: { name: 'ASC' },
    });

    // 获取 KB 下所有 folder ID 用于统计
    const folderIds = folders.map(f => f.id);

    // 批量统计每个文件夹下的文档数
    const docCounts: Record<string, number> = {};
    for (const fid of folderIds) {
      docCounts[fid] = await this.docRepo
        .createQueryBuilder('doc')
        .where('doc.folder_id = :fid', { fid })
        .getCount();
    }

    // 组装嵌套树
    const buildTree = (parentId: string | null): any[] =>
      folders
        .filter(f => f.parent_id === parentId)
        .map(f => ({
          id: f.id,
          name: f.name,
          docCount: docCounts[f.id] || 0,
          children: buildTree(f.id),
        }));

    return buildTree(null);
  }

  /** 重命名文件夹 */
  async renameFolder(id: string, name: string, userId: string, isAdmin: boolean): Promise<Folder> {
    const folder = await this.findFolderById(id);
    // 通过 KB 的创建者判断权限
    const kb = await this.findById(folder.kb_id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('无权限编辑此文件夹');
    folder.name = name;
    return this.folderRepo.save(folder);
  }

  /** 删除文件夹（CASCADE 子文件夹，文档 SET NULL） */
  async deleteFolder(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const folder = await this.findFolderById(id);
    const kb = await this.findById(folder.kb_id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('无权限删除此文件夹');
    await this.folderRepo.remove(folder);
  }

  /** 移动文件夹 */
  async moveFolder(id: string, dto: MoveFolderDto, userId: string, isAdmin: boolean): Promise<Folder> {
    const folder = await this.findFolderById(id);
    const kb = await this.findById(folder.kb_id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('无权限移动此文件夹');

    const newParentId = dto.new_parent_id ?? null;
    if (newParentId) {
      const newParent = await this.findFolderById(newParentId);
      // 限制同一知识库内移动
      if (newParent.kb_id !== folder.kb_id) throw new BadRequestException('不能移动到其他知识库');
      // 校验循环引用
      if (await this.isChildFolder(newParentId, folder.id)) {
        throw new BadRequestException('不能将文件夹移动到自己的子文件夹下');
      }
    }

    folder.parent_id = newParentId;
    return this.folderRepo.save(folder);
  }
```

- [ ] **Step 4: 实现辅助方法**

```typescript
  /** 查找单个文件夹 */
  private async findFolderById(id: string): Promise<Folder> {
    const folder = await this.folderRepo.findOne({ where: { id } });
    if (!folder) throw new NotFoundException('文件夹不存在');
    return folder;
  }

  /** 获取知识库下所有文件夹 ID（递归） */
  private async getFolderIdsByKb(kbId: string): Promise<string[]> {
    const folders = await this.folderRepo.find({ where: { kb_id: kbId }, select: { id: true } });
    return folders.map(f => f.id);
  }

  /** 检查 targetId 是否是 ancestorId 的子节点（防止循环引用） */
  private async isChildFolder(ancestorId: string, targetId: string): Promise<boolean> {
    const childIds = await this.collectChildFolderIds(ancestorId);
    return childIds.has(targetId);
  }

  /** 递归收集所有子文件夹 ID */
  private async collectChildFolderIds(parentId: string): Promise<Set<string>> {
    const result = new Set<string>();
    const children = await this.folderRepo.find({ where: { parent_id: parentId }, select: { id: true } });
    for (const child of children) {
      result.add(child.id);
      const subChildren = await this.collectChildFolderIds(child.id);
      for (const id of subChildren) result.add(id);
    }
    return result;
  }
```

- [ ] **Step 5: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 8: 创建 KnowledgeBaseController

**Files:**
- Create: `apps/server/src/modules/knowledge-base/kb.controller.ts`

**Interfaces:**
- Produces: REST API 端点（KB CRUD + Folder CRUD）
- Consumes: `KnowledgeBaseService` from Task 7, DTOs from Task 4

- [ ] **Step 1: 创建 kb.controller.ts**

```typescript
import { Controller, Post, Get, Delete, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { KnowledgeBaseService } from './kb.service';
import { CreateKnowledgeBaseDto } from './dto/create-kb.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-kb.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveFolderDto } from './dto/move-folder.dto';

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  /** 创建知识库 */
  @Post()
  async create(@Body() dto: CreateKnowledgeBaseDto, @CurrentUser() user: { id: string }) {
    return this.kbService.create(dto, user.id);
  }

  /** 列出知识库 */
  @Get()
  async list() {
    return this.kbService.list();
  }

  /** 知识库详情 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const kb = await this.kbService.findById(id);
    return kb;
  }

  /** 编辑知识库 */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    return this.kbService.update(id, dto, user.id, isAdmin);
  }

  /** 删除知识库 */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    await this.kbService.delete(id, user.id, isAdmin);
    return { success: true };
  }

  // ── 文件夹相关端点 ──

  /** 创建文件夹 */
  @Post(':kbId/folders')
  async createFolder(@Param('kbId') kbId: string, @Body() dto: CreateFolderDto) {
    return this.kbService.createFolder({ ...dto, kb_id: kbId });
  }

  /** 获取文件夹树 */
  @Get(':kbId/folders')
  async getFolderTree(@Param('kbId') kbId: string) {
    return this.kbService.getFolderTree(kbId);
  }

  /** 重命名文件夹 */
  @Patch('folders/:id')
  async renameFolder(
    @Param('id') id: string,
    @Body('name') name: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    return this.kbService.renameFolder(id, name, user.id, isAdmin);
  }

  /** 删除文件夹 */
  @Delete('folders/:id')
  async deleteFolder(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    await this.kbService.deleteFolder(id, user.id, isAdmin);
    return { success: true };
  }

  /** 移动文件夹 */
  @Post('folders/:id/move')
  async moveFolder(
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    return this.kbService.moveFolder(id, dto, user.id, isAdmin);
  }
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 9: 适配 DocumentService 支持 folder_id

**Files:**
- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/document/document.module.ts`

**Interfaces:**
- Consumes: `Folder` entity from Task 2, updated DTOs from Task 5
- Produces: `uploadStage1()` 接收 `folderId` 参数，`list()` 支持 `kb_id`/`folder_id` 过滤，`updateDocument()` 支持 `folder_id`

- [ ] **Step 1: 在 document.module.ts 中注册 Folder entity**

将 imports 从：
```typescript
TypeOrmModule.forFeature([Document, DocumentVersion]),
```
改为：
```typescript
TypeOrmModule.forFeature([Document, DocumentVersion, Folder]),
```

并在顶部新增 import：
```typescript
import { Folder } from '../knowledge-base/entities/folder.entity';
```

- [ ] **Step 2: 修改 document.service.ts — 构造函数注入 Folder repo**

在 `DocumentService` 构造函数中新增：
```typescript
@InjectRepository(Folder) private folderRepo: Repository<Folder>,
```
同时顶部新增 import：
```typescript
import { Folder } from '../knowledge-base/entities/folder.entity';
```

- [ ] **Step 3: 修改 uploadStage1() 方法签名**

将方法签名从：
```typescript
async uploadStage1(file: Express.Multer.File, uploaderId: string, deptId: string)
```
改为：
```typescript
async uploadStage1(file: Express.Multer.File, uploaderId: string, deptId: string, folderId?: string)
```

在创建 Document 记录时（`this.docRepo.create({...})` 处），新增：
```typescript
folder_id: folderId || null,
```

- [ ] **Step 4: 修改 list() 方法 — 支持 kb_id 和 folder_id 过滤**

在 `list()` 方法中，现有权限过滤之后、状态过滤之前新增：

```typescript
// 按 folder_id 过滤
if (dto.folder_id) {
  qb.andWhere('doc.folder_id = :folderId', { folderId: dto.folder_id });
} else if (dto.kb_id) {
  // 按知识库过滤：获取该 KB 下所有文件夹 ID
  const folderIds = await this.folderRepo.find({
    where: { kb_id: dto.kb_id },
    select: { id: true },
  });
  const ids = folderIds.map(f => f.id);
  if (ids.length) {
    qb.andWhere('doc.folder_id IN (:...folderIds)', { folderIds: ids });
  } else {
    // 知识库下无文件夹，返回空结果
    return { items: [], total: 0, page, pageSize };
  }
}
```

- [ ] **Step 5: 修改 updateDocument() 方法 — 支持 folder_id**

在 `updateDocument()` 方法中现有 `dept_id` 处理之后新增：

```typescript
// 支持设置文档所属文件夹
if (dto.folder_id !== undefined) {
  // 如果传入 null 或空字符串，表示移除文件夹归属
  if (dto.folder_id === null || dto.folder_id === '') {
    doc.folder_id = null;
  } else {
    // 校验文件夹存在
    const folder = await this.folderRepo.findOne({ where: { id: dto.folder_id } });
    if (!folder) throw new BadRequestException('目标文件夹不存在');
    doc.folder_id = dto.folder_id;
  }
}
```

注意：需要在文件顶部新增 import `import { BadRequestException } from '@nestjs/common';`（已存在，无需重复导入）。

- [ ] **Step 6: 修改 detail() 或 list() 返回 folder_id + kb_id**

在 list() 方法的 `select` 数组中新增 `'doc.folder_id'`。

在 controller 的 detail() 方法返回对象中新增：
```typescript
folder_id: doc.folder_id,
```

- [ ] **Step 7: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 10: 适配 DocumentController 传递 folder_id 参数

**Files:**
- Modify: `apps/server/src/modules/document/document.controller.ts`

**Interfaces:**
- Consumes: 更新后的 `DocumentService` from Task 9

- [ ] **Step 1: 修改 upload 端点 — 接收 folder_id**

将 upload 方法中的：
```typescript
async upload(
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser() user: { id: string },
  @Body('dept_id') deptId: string,
) {
  return this.docService.uploadStage1(file, user.id, deptId);
}
```
改为：
```typescript
async upload(
  @UploadedFile() file: Express.Multer.File,
  @CurrentUser() user: { id: string },
  @Body('dept_id') deptId: string,
  @Body('folder_id') folderId?: string,
) {
  return this.docService.uploadStage1(file, user.id, deptId, folderId);
}
```

- [ ] **Step 2: 修改 detail 端点 — 返回 folder_id**

在 detail() 方法返回对象中新增：
```typescript
folder_id: doc.folder_id,
```

- [ ] **Step 3: 验证编译通过**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 11: 在 AppModule 中注册 KnowledgeBaseModule

**Files:**
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `KnowledgeBaseModule` from Task 6

- [ ] **Step 1: 注册模块**

在 `app.module.ts` 中新增 import：
```typescript
import { KnowledgeBaseModule } from './modules/knowledge-base/kb.module';
```

在 `imports` 数组中（`RAGModule` 之前插入）：
```typescript
KnowledgeBaseModule,
```

- [ ] **Step 2: 验证编译通过，启动确认无报错**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 12: 创建 KnowledgeBaseModal 组件

**Files:**
- Create: `apps/web/src/components/knowledge/KnowledgeBaseModal.tsx`

**Interfaces:**
- Produces: `KnowledgeBaseModal` React 组件
- Props: `{ open, knowledgeBase, onClose, onSuccess }`

- [ ] **Step 1: 创建 KnowledgeBaseModal.tsx**

```typescript
import { Modal, Form, Input, App } from 'antd';
import { useEffect } from 'react';
import api from '../../services/api';

interface KBInfo {
  id?: string;
  name?: string;
  description?: string;
}

interface Props {
  open: boolean;
  knowledgeBase: KBInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function KnowledgeBaseModal({ open, knowledgeBase, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isEdit = !!knowledgeBase?.id;

  useEffect(() => {
    if (knowledgeBase) {
      form.setFieldsValue({
        name: knowledgeBase.name || '',
        description: knowledgeBase.description || '',
      });
    } else {
      form.resetFields();
    }
  }, [knowledgeBase, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      if (isEdit) {
        await api.patch(`/knowledge-bases/${knowledgeBase!.id}`, values);
        message.success('知识库已更新');
      } else {
        await api.post('/knowledge-bases', values);
        message.success('知识库已创建');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑知识库' : '新建知识库'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="知识库名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input maxLength={100} placeholder="例如：研发知识库" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="知识库简介（可选）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 13: 创建 FolderModal 组件

**Files:**
- Create: `apps/web/src/components/knowledge/FolderModal.tsx`

**Interfaces:**
- Produces: `FolderModal` React 组件（新建/重命名文件夹弹窗）
- Props: `{ open, folder, kbId, onClose, onSuccess }`

- [ ] **Step 1: 创建 FolderModal.tsx**

```typescript
import { Modal, Form, Input, App } from 'antd';
import { useEffect } from 'react';
import api from '../../services/api';

interface FolderInfo {
  id?: string;
  name?: string;
}

interface Props {
  open: boolean;
  folder: FolderInfo | null;  // null = 新建模式，有 id = 重命名模式
  kbId: string;
  parentId?: string;          // 新建时指定父文件夹
  onClose: () => void;
  onSuccess: () => void;
}

export default function FolderModal({ open, folder, kbId, parentId, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isRename = !!folder?.id;

  useEffect(() => {
    if (folder) {
      form.setFieldsValue({ name: folder.name || '' });
    } else {
      form.resetFields();
    }
  }, [folder, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      if (isRename) {
        await api.patch(`/knowledge-bases/folders/${folder!.id}`, { name: values.name });
        message.success('文件夹已重命名');
      } else {
        await api.post(`/knowledge-bases/${kbId}/folders`, {
          name: values.name,
          kb_id: kbId,
          parent_id: parentId || undefined,
        });
        message.success('文件夹已创建');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  return (
    <Modal
      title={isRename ? '重命名文件夹' : '新建文件夹'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="文件夹名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input maxLength={200} placeholder="例如：前端规范" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 14: 创建 KnowledgeBaseListPage

**Files:**
- Create: `apps/web/src/pages/knowledge/KnowledgeBaseListPage.tsx`
- Modify: `apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx`（替换内容为导出新页面）

**Interfaces:**
- Produces: 知识库卡片列表页面，路由 `/knowledge`
- Consumes: `KnowledgeBaseModal` from Task 12, `api` from `services/api.ts`

- [ ] **Step 1: 创建 KnowledgeBaseListPage.tsx**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Dropdown, App, Empty, Spin, Row, Col } from 'antd';
import { PlusOutlined, EllipsisOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import KnowledgeBaseModal from '../../components/knowledge/KnowledgeBaseModal';

export default function KnowledgeBaseListPage() {
  const [kbs, setKbs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<any>(null);
  const { message } = App.useApp();
  const navigate = useNavigate();

  const loadKbs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/knowledge-bases');
      setKbs(data || []);
    } catch {
      message.error('加载知识库列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKbs(); }, [loadKbs]);

  const handleDelete = async (id: string, name: string) => {
    try {
      await api.delete(`/knowledge-bases/${id}`);
      message.success(`已删除"${name}"`);
      loadKbs();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>📚 知识库</h2>
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => { setEditingKb(null); setModalOpen(true); }}>新建知识库</Button>
      </div>

      {loading ? (
        <Spin style={{ display: 'block', margin: '40px auto' }} />
      ) : kbs.length === 0 ? (
        <Empty description="暂无知识库，点击上方按钮创建" />
      ) : (
        <Row gutter={[16, 16]}>
          {kbs.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                onClick={() => navigate(`/knowledge/${kb.id}`)}
                extra={
                  <Dropdown menu={{
                    items: [
                      { key: 'edit', icon: <EditOutlined />, label: '编辑',
                        onClick: ({ domEvent }) => {
                          domEvent.stopPropagation();
                          setEditingKb(kb);
                          setModalOpen(true);
                        },
                      },
                      { type: 'divider' },
                      { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                        onClick: ({ domEvent }) => {
                          domEvent.stopPropagation();
                          handleDelete(kb.id, kb.name);
                        },
                      },
                    ],
                  }} trigger={['click']}>
                    <Button type="text" size="small" icon={<EllipsisOutlined />}
                      onClick={(e) => e.stopPropagation()} />
                  </Dropdown>
                }
              >
                <Card.Meta
                  title={`📗 ${kb.name}`}
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
            </Col>
          ))}
        </Row>
      )}

      <KnowledgeBaseModal
        open={modalOpen}
        knowledgeBase={editingKb}
        onClose={() => { setModalOpen(false); setEditingKb(null); }}
        onSuccess={loadKbs}
      />
    </div>
  );
}
```

- [ ] **Step 2: 更新 KnowledgeBasePage.tsx 为重新导出**

将 `apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx` 内容替换为：
```typescript
export { default } from '../knowledge/KnowledgeBaseListPage';
```

- [ ] **Step 3: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 15: 创建 FolderBrowsePage

**Files:**
- Create: `apps/web/src/pages/knowledge/FolderBrowsePage.tsx`

**Interfaces:**
- Produces: 文件夹树 + 文档列表浏览页面，路由 `/knowledge/:kbId`
- Consumes: `FolderModal` from Task 13, `DocumentDetailDrawer`, `api`

- [ ] **Step 1: 创建 FolderBrowsePage.tsx — 页面骨架 + 加载文件夹树**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Breadcrumb, Button, Tree, Table, Tag, Dropdown, App, Spin, Empty } from 'antd';
import {
  PlusOutlined, FolderAddOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, DownloadOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import api from '../../services/api';
import FolderModal from '../../components/knowledge/FolderModal';
import KnowledgeBaseModal from '../../components/knowledge/KnowledgeBaseModal';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';

// 复用状态映射（与 DocumentManagePage 一致）
function toFrontendStatus(status: string): string {
  switch (status) {
    case 'uploading': case 'parsing': case 'parsed': case 'indexing': return 'uploading';
    case 'indexed':   return 'indexed';
    case 'failed':    return 'failed';
    case 'cancelled': return 'cancelled';
    default:          return 'failed';
  }
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  uploading: { label: '上传中', color: 'blue' },
  cancelled: { label: '已取消', color: 'default' },
  indexed:   { label: '已上传', color: 'green' },
  failed:    { label: '已失败', color: 'red' },
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

export default function FolderBrowsePage() {
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [kb, setKb] = useState<any>(null);
  const [folderTree, setFolderTree] = useState<DataNode[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  const [documents, setDocuments] = useState<any[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const [docTotal, setDocTotal] = useState(0);

  // 弹窗状态
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<string | undefined>();
  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
```

- [ ] **Step 2: 实现数据加载和交互逻辑**

```typescript
  // 加载知识库详情
  const loadKb = useCallback(async () => {
    try {
      const { data } = await api.get(`/knowledge-bases/${kbId}`);
      setKb(data);
    } catch { message.error('加载知识库失败'); }
  }, [kbId]);

  // 加载文件夹树
  const loadFolderTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const { data } = await api.get(`/knowledge-bases/${kbId}/folders`);
      const toTreeNodes = (nodes: any[]): DataNode[] =>
        nodes.map((n: any) => ({
          key: n.id,
          title: `📁 ${n.name}`,
          children: n.children ? toTreeNodes(n.children) : undefined,
          isLeaf: !n.children || n.children.length === 0,
          data: n,
        }));
      setFolderTree(toTreeNodes(data || []));
    } catch { message.error('加载文件夹失败'); }
    finally { setTreeLoading(false); }
  }, [kbId]);

  // 加载当前选中文件夹下的文档
  const loadDocuments = useCallback(async (page = 1) => {
    setDocLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: 20 };
      if (selectedFolderId) {
        params.folder_id = selectedFolderId;
      } else {
        params.kb_id = kbId;
      }
      const { data } = await api.get('/documents', { params });
      setDocuments(data.items || []);
      setDocTotal(data.total || 0);
    } catch { message.error('加载文档列表失败'); }
    finally { setDocLoading(false); }
  }, [selectedFolderId, kbId]);

  useEffect(() => { loadKb(); loadFolderTree(); }, [loadKb, loadFolderTree]);
  useEffect(() => { loadDocuments(docPage); }, [loadDocuments, docPage]);
```

- [ ] **Step 3: 实现文件夹右键菜单和删除**

```typescript
  const handleDeleteFolder = async (id: string) => {
    try {
      await api.delete(`/knowledge-bases/folders/${id}`);
      message.success('文件夹已删除');
      if (selectedFolderId === id) setSelectedFolderId(null);
      loadFolderTree();
    } catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const handleTreeSelect = (selectedKeys: React.Key[]) => {
    setSelectedFolderId(selectedKeys.length ? (selectedKeys[0] as string) : null);
    setDocPage(1);
  };

  // 下载
  const extractFilename = (disposition: string): string => {
    const utf8Match = disposition?.match(/filename\*=UTF-8''([^;]+)/);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const match = disposition?.match(/filename="?([^";\n]+)"?/);
    if (match) return match[1].replace(/\\/g, '');
    return 'download';
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = extractFilename(res.headers['content-disposition'] || '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch { message.error('下载文件失败'); }
  };
```

- [ ] **Step 4: 实现渲染**

```typescript
  const docColumns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name: string, record: any) => (
        <a onClick={() => setDetailDocId(record.id)} style={{ cursor: 'pointer' }}>
          {TYPE_ICONS[record.type] || '📄'} {name}
        </a>
      ),
    },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
    { title: '大小', dataIndex: 'size', key: 'size', width: 100, render: (s: number) => formatSize(s) },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const fs = STATUS_MAP[toFrontendStatus(s)] || { label: s, color: 'default' };
        return <Tag color={fs.color}>{fs.label}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: unknown, record: any) => (
        <>
          <Button size="small" icon={<EyeOutlined />}
            onClick={() => setDetailDocId(record.id)}>查看</Button>
          {toFrontendStatus(record.status) === 'indexed' && (
            <Button size="small" icon={<DownloadOutlined />} style={{ marginLeft: 4 }}
              onClick={() => handleDownload(record.id)}>下载</Button>
          )}
        </>
      ),
    },
  ];

  // 当前路径面包屑
  const getBreadcrumbPath = () => {
    const parts = [{ title: kb?.name || '知识库', key: 'root' }];
    if (selectedFolderId) {
      const findPath = (nodes: DataNode[], targetKey: string, path: { title: string; key: string }[]): boolean => {
        for (const node of nodes) {
          if (node.key === targetKey) return true;
          if (node.children && findPath(node.children, targetKey, path)) {
            path.unshift({ title: (node.title as string).replace('📁 ', ''), key: node.key as string });
            return true;
          }
        }
        return false;
      };
      findPath(folderTree, selectedFolderId, parts);
    }
    return parts;
  };

  return (
    <div>
      {/* 顶部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge')}>返回</Button>
          <Breadcrumb items={getBreadcrumbPath().map(p => ({ title: p.title }))} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<FolderAddOutlined />}
            onClick={() => { setEditingFolder(null); setNewFolderParentId(undefined); setFolderModalOpen(true); }}>
            新建文件夹
          </Button>
          <Button onClick={() => setKbModalOpen(true)}>编辑知识库</Button>
        </div>
      </div>

      {/* 左右布局 */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左侧文件夹树 */}
        <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #f0f0f0', paddingRight: 8 }}>
          {treeLoading ? <Spin /> : folderTree.length === 0 ? (
            <Empty description="暂无文件夹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Tree
              showIcon
              defaultExpandAll
              treeData={folderTree}
              selectedKeys={selectedFolderId ? [selectedFolderId] : []}
              onSelect={handleTreeSelect}
              onRightClick={({ node }) => {
                const folderData = (node as any).data;
                if (!folderData) return;
              }}
              titleRender={(node: any) => {
                const folder = node.data;
                return (
                  <Dropdown menu={{
                    items: [
                      { key: 'new', icon: <FolderAddOutlined />, label: '新建子文件夹',
                        onClick: () => {
                          setEditingFolder(null);
                          setNewFolderParentId(folder.id);
                          setFolderModalOpen(true);
                        },
                      },
                      { key: 'rename', icon: <EditOutlined />, label: '重命名',
                        onClick: () => {
                          setEditingFolder(folder);
                          setNewFolderParentId(undefined);
                          setFolderModalOpen(true);
                        },
                      },
                      { type: 'divider' },
                      { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                        onClick: () => handleDeleteFolder(folder.id),
                      },
                    ],
                  }} trigger={['contextMenu']}>
                    <span>📁 {folder.name}</span>
                  </Dropdown>
                );
              }}
            />
          )}
        </div>

        {/* 右侧文档表格 */}
        <div style={{ flex: 1 }}>
          <Table
            columns={docColumns}
            dataSource={documents}
            rowKey="id"
            loading={docLoading}
            locale={{ emptyText: <Empty description="当前目录暂无文档" /> }}
            pagination={{
              current: docPage,
              pageSize: 20,
              total: docTotal,
              showTotal: (t) => `共 ${t} 篇文档`,
              onChange: (p) => setDocPage(p),
            }}
          />
        </div>
      </div>

      {/* 弹窗 */}
      <FolderModal
        open={folderModalOpen}
        folder={editingFolder}
        kbId={kbId!}
        parentId={newFolderParentId}
        onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        onSuccess={loadFolderTree}
      />
      <KnowledgeBaseModal
        open={kbModalOpen}
        knowledgeBase={kb}
        onClose={() => setKbModalOpen(false)}
        onSuccess={loadKb}
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

- [ ] **Step 5: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 16: 改造 DocumentUploadPage — 增加 KB + 文件夹选择

**Files:**
- Modify: `apps/web/src/pages/document/DocumentUploadPage.tsx`

**Interfaces:**
- Consumes: `api`

- [ ] **Step 1: 增加 KB 选择器和文件夹 TreeSelect**

将 `DocumentUploadPage.tsx` 完整替换为：

```typescript
import { useState, useEffect } from 'react';
import { Upload, Card, Progress, Button, Breadcrumb, Select, TreeSelect, App, Row, Col } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import type { DefaultOptionType } from 'antd/es/select';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

const { Dragger } = Upload;

export default function DocumentUploadPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);

  // KB + 文件夹选择状态
  const [kbs, setKbs] = useState<{ value: string; label: string }[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | undefined>();
  const [folderTree, setFolderTree] = useState<DefaultOptionType[]>([]);

  // 加载 KB 列表
  useEffect(() => {
    api.get('/knowledge-bases').then(({ data }) => {
      setKbs((data || []).map((kb: any) => ({ value: kb.id, label: kb.name })));
    }).catch(() => {});
  }, []);

  // KB 变化时加载文件夹树
  useEffect(() => {
    if (!selectedKbId) { setFolderTree([]); return; }
    api.get(`/knowledge-bases/${selectedKbId}/folders`).then(({ data }) => {
      const toTreeOptions = (nodes: any[]): DefaultOptionType[] =>
        nodes.map((n: any) => ({
          value: n.id,
          title: n.name,
          label: n.name,
          children: n.children ? toTreeOptions(n.children) : undefined,
        }));
      setFolderTree(toTreeOptions(data || []));
    }).catch(() => setFolderTree([]));
  }, [selectedKbId]);

  const handleUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    setProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    if (user?.dept_id) formData.append('dept_id', user.dept_id);
    if (selectedFolderId) formData.append('folder_id', selectedFolderId);

    try {
      const { data } = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      message.success(`上传成功 — 文档 ID: ${data.docId}`);
      setFileList([]);
      setProgress(0);
    } catch (err: any) {
      message.error(err.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/documents/manage">文档管理</Link> },
          { title: '上传文档' },
        ]}
      />
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>📄 上传文档</h2>
      <Card>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>知识库</div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择知识库（可选）"
              allowClear
              options={kbs}
              value={selectedKbId}
              onChange={(val) => { setSelectedKbId(val); setSelectedFolderId(undefined); }}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>文件夹</div>
            <TreeSelect
              style={{ width: '100%' }}
              placeholder={selectedKbId ? '选择文件夹（可选）' : '请先选择知识库'}
              treeData={folderTree}
              value={selectedFolderId}
              onChange={(val) => setSelectedFolderId(val)}
              allowClear
              disabled={!selectedKbId}
            />
          </Col>
        </Row>

        <Dragger
          fileList={fileList}
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setFileList(fl)}
          maxCount={1}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4"
          onRemove={() => { setFileList([]); setProgress(0); }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">支持 PDF / Word / Excel / PPT / Markdown / 文本 / 图片 / 音频 / 视频</p>
        </Dragger>
        {fileList.length > 0 && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              onClick={handleUpload}
              loading={uploading}
              icon={<UploadOutlined />}
            >
              {uploading ? '上传中' : '开始上传'}
            </Button>
          </div>
        )}
        {progress > 0 && <Progress percent={progress} style={{ marginTop: 16 }} />}
      </Card>
    </div>
  );
}
```

注意：上面的代码中加入了 `selectedFolderId` 状态，需要在上面的 KB `onChange` 中也加入 `setSelectedFolderId(undefined)`，并在状态声明区补充：

```typescript
const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
```

同时将 `import { Select } from 'antd'` 改为 `import { Select, TreeSelect } from 'antd'`，新增 `import type { DefaultOptionType } from 'antd/es/select';`。

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 17: 改造 DocumentManagePage — 增加 KB + 文件夹筛选

**Files:**
- Modify: `apps/web/src/pages/document/DocumentManagePage.tsx`

**Interfaces:**
- Consumes: `api`

- [ ] **Step 1: 在 SearchBar 上方增加 KB + 文件夹筛选行**

在 `DocumentManagePage.tsx` 中，在现有 `<SearchBar>` 之前新增一个筛选条，放在标题下方：

```typescript
// 在文件顶部新增 import
import { Select, TreeSelect } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';

// 在组件内新增状态
const [kbs, setKbs] = useState<{ value: string; label: string }[]>([]);
const [selectedKbId, setSelectedKbId] = useState<string | undefined>();
const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
const [folderTree, setFolderTree] = useState<DefaultOptionType[]>([]);

// 加载 KB 列表
useEffect(() => {
  api.get('/knowledge-bases').then(({ data }) => {
    setKbs((data || []).map((kb: any) => ({ value: kb.id, label: kb.name })));
  }).catch(() => {});
}, []);

// KB 变化时加载文件夹树
useEffect(() => {
  if (!selectedKbId) { setFolderTree([]); return; }
  api.get(`/knowledge-bases/${selectedKbId}/folders`).then(({ data }) => {
    const toTreeOptions = (nodes: any[]): DefaultOptionType[] =>
      nodes.map((n: any) => ({
        value: n.id, title: n.name, label: n.name,
        children: n.children ? toTreeOptions(n.children) : undefined,
      }));
    setFolderTree(toTreeOptions(data || []));
  }).catch(() => setFolderTree([]));
}, [selectedKbId]);

// 在 loadDocuments 中，将 kb_id / folder_id 加入 params
// 在构建 params 处新增：
if (selectedKbId) params.kb_id = selectedKbId;
if (selectedFolderId) params.folder_id = selectedFolderId;

// 在标题下方、SearchBar 上方插入筛选条：
<div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
  <div style={{ width: 200 }}>
    <Select
      style={{ width: '100%' }}
      placeholder="知识库"
      allowClear
      options={kbs}
      value={selectedKbId}
      onChange={(val) => { setSelectedKbId(val); setSelectedFolderId(undefined); setPage(1); }}
    />
  </div>
  <div style={{ width: 220 }}>
    <TreeSelect
      style={{ width: '100%' }}
      placeholder="文件夹"
      treeData={folderTree}
      value={selectedFolderId}
      onChange={(val) => { setSelectedFolderId(val); setPage(1); }}
      allowClear
      disabled={!selectedKbId}
    />
  </div>
</div>
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 18: 改造 DocumentEditModal — 增加文件夹选择

**Files:**
- Modify: `apps/web/src/components/document/DocumentEditModal.tsx`

**Interfaces:**
- Consumes: `api`

- [ ] **Step 1: 在编辑弹窗中增加文件夹字段**

在 `DocumentEditModal.tsx` 中：

```typescript
import { TreeSelect } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { useState, useEffect as useEff } from 'react';

// 新增状态：文件夹树
const [kbs, setKbs] = useState<{ value: string; label: string }[]>([]);
const [selectedKbId, setSelectedKbId] = useState<string | undefined>();
const [folderTree, setFolderTree] = useState<DefaultOptionType[]>([]);

// 加载 KB 列表 + 加载文件夹树（逻辑同 Task 16/17）

// 初始化时从 document 反查 folder 的 KB
// 新增一个 useEffect：
useEff(() => {
  if (!document) return;
  // 设置 folder_id（如果有的话，需要反查 KB — 为简化先只设值）
  form.setFieldsValue({
    folder_id: (document as any).folder_id ?? undefined,
  });
}, [document, form]);
```

在该弹窗的 Form 中（`dept_id` 字段之后）新增：
```typescript
<Form.Item name="folder_id" label="所属文件夹">
  <TreeSelect
    style={{ width: '100%' }}
    placeholder="选择文件夹（可选，用于重新归类）"
    treeData={folderTree}
    value={form.getFieldValue('folder_id')}
    onChange={(val) => form.setFieldValue('folder_id', val)}
    allowClear
  />
</Form.Item>
```

在 `handleOk` 中，发送请求时 `folder_id` 已经在 form values 中自动带上。

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 19: 更新 App.tsx 路由

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: 新增 `/knowledge/:kbId` 路由

- [ ] **Step 1: 新增路由**

在 `App.tsx` 中新增 import：
```typescript
import FolderBrowsePage from './pages/knowledge/FolderBrowsePage';
```

在 `<Route path="knowledge">` 后面新增：
```typescript
<Route path="knowledge/:kbId" element={<FolderBrowsePage />} />
```

注意：`knowledge`（列表页）和 `knowledge/:kbId`（详情页）需要在路由表中共存。React Router v6 中这没问题。但需要确保 `KnowledgeBaseListPage` 已正确导入。当前 `KnowledgeBasePage` import 保持不变（它已重导出为 `KnowledgeBaseListPage`）。

- [ ] **Step 2: 验证编译通过 + 确认无路由冲突**

```bash
cd apps/web && npx tsc --noEmit
```

---

### 验证清单

全部任务完成后，逐步验证：

1. **启动后端**，确认表自动创建：
   ```bash
   cd apps/server && pnpm dev
   ```
   检查日志无报错，`knowledge_bases` 和 `folders` 表已创建。

2. **API 验证**：
   ```bash
   # 创建知识库
   curl -X POST http://localhost:3001/api/knowledge-bases -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":"测试知识库","description":"测试"}'
   
   # 创建文件夹
   curl -X POST http://localhost:3001/api/knowledge-bases/<kbId>/folders -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":"子文件夹","kb_id":"<kbId>"}'
   
   # 获取文件夹树
   curl http://localhost:3001/api/knowledge-bases/<kbId>/folders -H "Authorization: Bearer <token>"
   ```

3. **前端验证**：
   - 访问 `/knowledge`，创建知识库、编辑、删除
   - 点击知识库卡片进入 `/knowledge/:kbId`，创建文件夹、右键菜单操作
   - 点击文件夹树节点，切换文档列表
   - 上传文档时选择知识库和文件夹
   - 文档管理页按 KB 和文件夹筛选
