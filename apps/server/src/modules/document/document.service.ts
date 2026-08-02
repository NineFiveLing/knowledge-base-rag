import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus, DocumentVisibility } from './entities/document.entity';
import { RustFSService } from '../../database/rustfs/rustfs.service';
import { MongoDBService } from '../../database/mongodb/mongodb.service';
import { ElasticsearchService } from '../../database/elasticsearch/es.service';
import { Neo4jService } from '../../database/neo4j/neo4j.service';
import { VectorService } from '../../database/postgres/vector.service';
import { IndexerService } from './services/indexer.service';
import { IndexQueueService } from './services/index-queue.service';
import { DocumentParser, ParseResult } from './parsers/parser.interface';
import { ListDocumentDto } from './dto/list-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentVersion } from './entities/document-version.entity';

/** 文件扩展名 → 类型映射 */
const TYPE_MAP: Record<string, string> = {
  pdf: 'pdf', doc: 'word', docx: 'word',
  xls: 'excel', xlsx: 'excel', csv: 'text',
  ppt: 'ppt', pptx: 'ppt',
  md: 'markdown', txt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', avi: 'video', mov: 'video', mkv: 'video', webm: 'video', flv: 'video',
};

/** 修正 Multer/busboy 将 UTF-8 文件名字节按 Latin-1 误读的编码问题 */
function fixEncoding(name: string): string {
  try {
    const buf = Buffer.from(name, 'latin1');
    const utf8 = buf.toString('utf8');
    // 如果还原后包含有效中文字符或日文/韩文，说明是误编码
    if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(utf8)) return utf8;
  } catch {}
  return name;
}

/** 文档管理服务：上传解析 + 阶段一回滚 */
@Injectable()
export class DocumentService {
  private parsers = new Map<string, DocumentParser>();

  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    @InjectRepository(DocumentVersion) private versionRepo: Repository<DocumentVersion>,
    private rustfs: RustFSService,
    private mongo: MongoDBService,
    private indexerService: IndexerService,
    private indexQueue: IndexQueueService,
    private esService: ElasticsearchService,
    private neo4jService: Neo4jService,
    private vectorService: VectorService,
  ) {}

  /** 注册解析器 */
  registerParser(parser: DocumentParser) {
    for (const type of parser.supportedTypes) {
      this.parsers.set(type, parser);
    }
  }

  /** 阶段一：同步解析（任一失败即回滚） */
  async uploadStage1(
    file: Express.Multer.File,
    uploaderId: string,
    deptId: string,
  ) {
    file.originalname = fixEncoding(file.originalname);
    const uploadedUrls: string[] = [];
    let saved: Document | null = null;

    try {
      // 1. 上传原文件到 RustFS
      const fileUrl = await this.rustfs.uploadFile(file.buffer, file.originalname, file.mimetype);
      uploadedUrls.push(fileUrl);

      // 2. 类型识别
      const ext = file.originalname.split('.').pop()?.toLowerCase() || 'txt';
      const type = TYPE_MAP[ext] || 'text';

      const parser = this.parsers.get(type);
      if (!parser) throw new BadRequestException(`不支持的文件类型: ${ext}`);

      const result: ParseResult = await parser.parse(file.buffer, file.originalname);

      // 3. 上传提取的图片到 RustFS，替换 Markdown 中的占位符
      for (const img of result.images) {
        const imgUrl = await this.rustfs.uploadFile(img.buffer, img.originalName, img.mimeType);
        uploadedUrls.push(imgUrl);
        result.markdown = result.markdown.replace(img.placeholderInMd, imgUrl);
      }

      // 4. 先存 Postgres（获取 UUID），再存 MongoDB
      // 先创建 Postgres 记录以获取 UUID
      const doc = this.docRepo.create({
        name: file.originalname,
        type,
        size: file.size,
        uploader_id: uploaderId,
        dept_id: deptId,
        mongo_doc_id: 'pending', // 先占位，下面会更新
        rustfs_file_url: fileUrl,
        status: DocumentStatus.PARSED,
      });
      saved = await this.docRepo.save(doc);

      // 5. 存 MongoDB（使用真实的 Postgres UUID）
      const mongoDoc = await this.mongo.saveMarkdown(saved.id, result.markdown, result.metadata);

      // 6. 回填 Postgres 中的 mongo_doc_id
      saved.mongo_doc_id = mongoDoc._id.toString();
      await this.docRepo.save(saved);

      // 异步触发阶段二索引（不阻塞上传响应）
      this.triggerIndex(saved.id, uploaderId).catch((err) => {
        this.logger.error(`上传后自动索引失败: ${saved!.id}`, err.message);
      });

      return { docId: saved.id, status: saved.status };
    } catch (error) {
      // 回滚：清理已上传的 RustFS 文件
      for (const url of uploadedUrls) {
        await this.rustfs.deleteFile(url).catch(() => {});
      }
      // 回滚：清理已写入的数据库记录
      if (saved) {
        await this.mongo.deleteByDocId(saved.id).catch(() => {});
        await this.docRepo.remove(saved).catch(() => {});
      }
      throw error;
    }
  }

  /** 触发阶段二异步索引（fire-and-forget） */
  async triggerIndex(docId: string, userId: string): Promise<{ docId: string; status: string }> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    // 权限检查：仅创建者可触发
    if (doc.uploader_id !== userId) {
      throw new ForbiddenException('无权限操作此文档');
    }

    // 仅 parsed 状态可触发索引
    if (doc.status !== DocumentStatus.PARSED) {
      throw new BadRequestException(`文档状态为 ${doc.status}，无法触发索引`);
    }

    // BullMQ 异步索引：入队后由 IndexWorkerService 消费
    await this.indexQueue.addJob(docId);
    this.logger.log(`索引入队: ${docId}`);

    return { docId, status: DocumentStatus.INDEXING };
  }

  /**
   * 文档列表查询：支持分页、状态/类型/关键词过滤，按数据权限隔离
   * 权限规则：公开文档所有人可见 + 本部门文档 + 自己创建的私有文档
   */
  async list(
    dto: ListDocumentDto,
    user: { id: string; dept_id: string },
  ): Promise<{ items: Partial<Document>[]; total: number; page: number; pageSize: number }> {
    const { page = 1, pageSize = 20, status, type, keyword } = dto;

    // 数据权限：公开文档 OR 本部门文档 OR 自己创建的文档
    const qb = this.docRepo
      .createQueryBuilder('doc')
      .select([
        'doc.id',
        'doc.name',
        'doc.type',
        'doc.size',
        'doc.status',
        'doc.visibility',
        'doc.uploader_id',
        'doc.dept_id',
        'doc.created_at',
        'doc.updated_at',
      ])
      .where(
        '(doc.visibility = :publicVis OR doc.dept_id = :deptId OR doc.uploader_id = :userId)',
        {
          publicVis: DocumentVisibility.PUBLIC,
          deptId: user.dept_id,
          userId: user.id,
        },
      );

    if (status) {
      qb.andWhere('doc.status = :status', { status });
    }
    if (type) {
      qb.andWhere('doc.type = :type', { type });
    }
    if (keyword) {
      qb.andWhere('doc.name ILIKE :kw', { kw: `%${keyword}%` });
    }

    qb.orderBy('doc.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  /** 根据 ID 查询文档（不含权限检查的纯查询） */
  async findById(docId: string): Promise<Document> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    return doc;
  }

  /** 级联删除文档：从下游到上游清理所有存储中的文档数据 */
  async deleteDocument(docId: string, userId: string, isAdmin = false): Promise<void> {
    const doc = await this.findById(docId);
    if (doc.uploader_id !== userId && !isAdmin) throw new ForbiddenException('只能删除自己上传的文档');

    const errors: string[] = [];

    // 1. Neo4j：删除实体和 chunk 节点
    try {
      await this.neo4jService.deleteDocument(docId);
    } catch (e) { errors.push('Neo4j'); }

    // 2. ES：按 postgres_doc_id 删除所有 chunk
    try {
      await this.esService.client.deleteByQuery({
        index: 'chunks',
        query: { term: { postgres_doc_id: docId } },
      });
    } catch (e) { errors.push('ES'); }

    // 3. PGVector：删除向量 chunks
    try {
      await this.vectorService.deleteByDocId(docId);
    } catch (e) { errors.push('PGVector'); }

    // 4. MongoDB：删除 Markdown 正文
    try {
      await this.mongo.deleteByDocId(docId);
    } catch (e) { errors.push('MongoDB'); }

    // 5. RustFS：删除原文件
    try {
      if (doc.rustfs_file_url) {
        await this.rustfs.deleteFile(doc.rustfs_file_url);
      }
    } catch (e) { errors.push('RustFS'); }

    // 6. Postgres：删除元信息（最后）
    await this.docRepo.remove(doc);

    if (errors.length > 0) {
      this.logger.warn(`文档 ${docId} 部分清理失败: ${errors.join(', ')}`);
    }
  }

  /** 清理文档所有索引并重置状态，用于 reindex 前 */
  async clearIndexes(docId: string): Promise<void> {
    await this.neo4jService.deleteDocument(docId).catch(() => {});
    await this.esService.client.deleteByQuery({
      index: 'chunks',
      query: { term: { postgres_doc_id: docId } },
    }).catch(() => {});
    await this.vectorService.deleteByDocId(docId).catch(() => {});
    // 重置状态为 PARSED，使 triggerIndex 可以再次触发
    await this.docRepo.update(docId, { status: DocumentStatus.PARSED });
  }

  /** 获取文档的 Markdown 正文（用于预览） */
  async getPreviewMarkdown(docId: string) {
    return this.mongo.getMarkdown(docId);
  }

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

  /** 检查用户对文档的查看权限（按可见性分级） */
  async checkViewAccess(docId: string, user: { id: string; dept_id: string }): Promise<Document> {
    const doc = await this.findById(docId);

    // 上传者始终有权限查看自己的文档
    if (doc.uploader_id === user.id) return doc;

    switch (doc.visibility) {
      case DocumentVisibility.PUBLIC:
        return doc;
      case DocumentVisibility.DEPT:
        // dept_id 为 null 时视作未分配部门，仅允许上传者查看（上面已处理）
        if (doc.dept_id && doc.dept_id === user.dept_id) return doc;
        throw new ForbiddenException('无权查看此文档');
      case DocumentVisibility.PRIVATE:
        throw new ForbiddenException('无权查看此文档');
      default:
        throw new ForbiddenException('无权查看此文档');
    }
  }

  /** 替换文件：归档当前版本 → 上传新文件 → 解析 → 更新 DB → 重建索引 */
  async replaceFile(
    docId: string,
    file: Express.Multer.File,
    user: { id: string; roles?: string[] },
  ): Promise<{ docId: string; version: number; status: string }> {
    file.originalname = fixEncoding(file.originalname);
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
      await this.clearIndexes(doc.id);

      // 8. 触发新索引（异步）
      this.triggerIndex(doc.id, user.id).catch((err) => {
        this.logger.error(`替换文件后索引失败: ${doc.id}`, err.message);
      });

      return { docId: doc.id, version: doc.version, status: doc.status };

    } catch (error) {
      // 回滚：清理本次上传的 RustFS 文件
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

  /** 取消上传：仅 uploading / parsing 状态可取消 */
  async cancelUpload(
    docId: string,
    userId: string,
  ): Promise<{ docId: string; status: string }> {
    const doc = await this.findById(docId);

    if (doc.uploader_id !== userId) {
      throw new ForbiddenException('只能取消自己上传的文档');
    }

    // 可取消：uploading / parsing / parsed / indexing（所有未达到 indexed 的中间态）
    const cancelable = [
      DocumentStatus.UPLOADING,
      DocumentStatus.PARSING,
      DocumentStatus.PARSED,
      DocumentStatus.INDEXING,
    ];
    if (!cancelable.includes(doc.status)) {
      throw new BadRequestException(`文档状态为 ${doc.status}，无法取消`);
    }

    const errors: string[] = [];

    // 1. 清理可能已写入的索引（parsed/indexing 状态可能已有部分索引）
    if (doc.status === DocumentStatus.INDEXING || doc.status === DocumentStatus.PARSED) {
      try { await this.neo4jService.deleteDocument(doc.id); } catch (e) { errors.push('Neo4j'); }
      try {
        await this.esService.client.deleteByQuery({
          index: 'chunks',
          query: { term: { postgres_doc_id: doc.id } },
        });
      } catch (e) { errors.push('ES'); }
      try { await this.vectorService.deleteByDocId(doc.id); } catch (e) { errors.push('PGVector'); }
    }

    // 2. 清理 RustFS 文件
    try {
      await this.rustfs.deleteFile(doc.rustfs_file_url);
    } catch (e) { errors.push('RustFS'); }

    // 3. 清理 MongoDB 正文
    try {
      await this.mongo.deleteByDocId(doc.id);
    } catch (e) { errors.push('MongoDB'); }

    // 4. 状态改为 cancelled
    doc.status = DocumentStatus.CANCELLED;
    await this.docRepo.save(doc);

    if (errors.length > 0) {
      this.logger.warn(`取消上传部分清理失败: ${errors.join(', ')}`);
    }

    return { docId: doc.id, status: doc.status };
  }

  /** 获取文档的历史版本列表（不含当前活跃版本） */
  async getVersions(docId: string): Promise<DocumentVersion[]> {
    await this.findById(docId);
    return this.versionRepo.find({
      where: { document_id: docId },
      order: { version: 'DESC' },
      select: { id: true, version: true, name: true, size: true, created_at: true },
    });
  }

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
}
