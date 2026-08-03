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

  // ── 知识库 CRUD ──

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
      const folderIds = await this.getFolderIdsByKb(kb.id);
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

  /** 删除知识库（CASCADE 文件夹，文档 folder_id 设为 NULL） */
  async delete(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const kb = await this.findById(id);
    if (kb.created_by !== userId && !isAdmin) throw new ForbiddenException('只能删除自己创建的知识库');
    await this.kbRepo.remove(kb);
  }

  // ── 文件夹 CRUD ──

  /** 创建文件夹 */
  async createFolder(dto: CreateFolderDto): Promise<Folder> {
    await this.findById(dto.kb_id);
    if (dto.parent_id) {
      const parent = await this.findFolderById(dto.parent_id);
      if (parent.kb_id !== dto.kb_id) throw new BadRequestException('父文件夹不属于该知识库');
    }
    const folder = this.folderRepo.create({
      kb_id: dto.kb_id,
      parent_id: dto.parent_id || null,
      name: dto.name,
    });
    return this.folderRepo.save(folder);
  }

  /** 获取文件夹树 */
  async getFolderTree(kbId: string): Promise<any[]> {
    const folders = await this.folderRepo.find({
      where: { kb_id: kbId },
      select: { id: true, parent_id: true, name: true, created_at: true },
      order: { name: 'ASC' },
    });

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
      if (newParent.kb_id !== folder.kb_id) throw new BadRequestException('不能移动到其他知识库');
      if (await this.isChildFolder(newParentId, folder.id)) {
        throw new BadRequestException('不能将文件夹移动到自己的子文件夹下');
      }
    }

    folder.parent_id = newParentId;
    return this.folderRepo.save(folder);
  }

  // ── 辅助方法 ──

  /** 查找单个文件夹 */
  async findFolderById(id: string): Promise<Folder> {
    const folder = await this.folderRepo.findOne({ where: { id } });
    if (!folder) throw new NotFoundException('文件夹不存在');
    return folder;
  }

  /** 获取知识库下所有文件夹 ID */
  private async getFolderIdsByKb(kbId: string): Promise<string[]> {
    const folders = await this.folderRepo.find({ where: { kb_id: kbId }, select: { id: true } });
    return folders.map(f => f.id);
  }

  /** 检查 targetId 是否是 ancestorId 的子节点（防循环引用） */
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
}
