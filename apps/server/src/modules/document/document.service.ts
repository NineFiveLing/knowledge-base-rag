import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from './entities/document.entity';
import { RustFSService } from '../../database/rustfs/rustfs.service';
import { MongoDBService } from '../../database/mongodb/mongodb.service';
import { DocumentParser, ParseResult } from './parsers/parser.interface';

/** 文件扩展名 → 类型映射 */
const TYPE_MAP: Record<string, string> = {
  pdf: 'pdf', doc: 'word', docx: 'word',
  xls: 'excel', xlsx: 'excel', csv: 'text',
  ppt: 'ppt', pptx: 'ppt',
  md: 'markdown', txt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio',
  mp4: 'video', avi: 'video', mov: 'video', mkv: 'video',
};

/** 文档管理服务：上传解析 + 阶段一回滚 */
@Injectable()
export class DocumentService {
  private parsers = new Map<string, DocumentParser>();

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private rustfs: RustFSService,
    private mongo: MongoDBService,
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
    const uploadedUrls: string[] = [];

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

      // 4. 存 MongoDB（先存，获 ObjectId，回填后更新）
      const mongoDoc = await this.mongo.saveMarkdown('pending', result.markdown, result.metadata);

      // 5. 存 Postgres（元信息）
      const doc = this.docRepo.create({
        name: file.originalname,
        type,
        size: file.size,
        uploader_id: uploaderId,
        dept_id: deptId,
        mongo_doc_id: mongoDoc._id.toString(),
        rustfs_file_url: fileUrl,
        status: DocumentStatus.PARSED,
      });
      const saved = await this.docRepo.save(doc);

      // 6. 回填 MongoDB 中的 postgres_doc_id
      await this.mongo.updateMarkdown(saved.id, result.markdown);

      return { docId: saved.id, status: saved.status };
    } catch (error) {
      // 回滚：清理已上传的 RustFS 文件
      for (const url of uploadedUrls) {
        await this.rustfs.deleteFile(url).catch(() => {});
      }
      throw error;
    }
  }
}
