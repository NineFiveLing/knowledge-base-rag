import {
  Controller, Post, Get, Delete, Patch, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, Body, Res, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentService } from './document.service';
import { ListDocumentDto } from './dto/list-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { RustFSService } from '../../database/rustfs/rustfs.service';

/** 文本类型统一映射为 text/plain（浏览器内渲染中文不乱码） */
const TEXT_CONTENT_TYPES = ['text/', 'application/json'];
const toViewContentType = (ct: string) =>
  TEXT_CONTENT_TYPES.some((t) => ct.startsWith(t)) ? 'text/plain; charset=utf-8' : ct;

/** RFC 5987 文件名编码: 旧浏览器 filename + 现代浏览器 filename*=UTF-8'' */
function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  // ASCII fallback：去除非 ASCII 字符
  const asciiFallback = filename.replace(/[^\x21-\x7E]/g, '_').replace(/_{2,}/g, '_') || 'file';
  const encoded = encodeURIComponent(filename);
  // 如果文件名是纯 ASCII，不需要 filename* 参数
  if (filename === asciiFallback) {
    return `${disposition}; filename="${filename}"`;
  }
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** 文档管理控制器 */
@Controller('documents')
export class DocumentController {
  constructor(
    private docService: DocumentService,
    private rustfs: RustFSService,
  ) {}

  /** 上传文档（阶段一：同步解析） */
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string },
    @Body('dept_id') deptId: string,
  ) {
    return this.docService.uploadStage1(file, user.id, deptId);
  }

  /** 查询文档列表（带权限过滤，支持分页和条件过滤） */
  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser() user: { id: string; dept_id: string },
    @Query() dto: ListDocumentDto,
  ) {
    return this.docService.list(dto, user);
  }

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

  /** 手动触发阶段二索引 */
  @Post(':id/index')
  @UseGuards(JwtAuthGuard)
  async triggerIndex(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.docService.triggerIndex(id, user.id);
  }

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

  /** 取消上传 */
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.docService.cancelUpload(id, user.id);
  }

  /** 删除文档（级联清理所有索引和存储） */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin');
    await this.docService.deleteDocument(id, user.id, isAdmin);
    return { success: true };
  }

  /** 查看历史版本文件 — 必须在 :id/file 之前注册，避免 :id 匹配 'versions' */
  @Get('versions/:versionId/file')
  @UseGuards(JwtAuthGuard)
  async viewVersionFile(
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, filename, contentType } = await this.docService.getVersionFile(versionId);
    res.set({
      'Content-Type': toViewContentType(contentType),
      'Content-Disposition': contentDisposition('inline', filename),
    });
    return new StreamableFile(stream);
  }

  /** 版本历史列表 */
  @Get(':id/versions')
  @UseGuards(JwtAuthGuard)
  async listVersions(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; dept_id: string },
  ) {
    await this.docService.checkViewAccess(id, user);
    return this.docService.getVersions(id);
  }

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
      'Content-Type': toViewContentType(meta.contentType),
      'Content-Disposition': contentDisposition('inline', doc.name),
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
      'Content-Disposition': contentDisposition('attachment', doc.name),
      'Content-Length': meta.contentLength.toString(),
    });

    return new StreamableFile(stream);
  }

  /** 预览文档 Markdown 正文 */
  @Get(':id/preview')
  @UseGuards(JwtAuthGuard)
  async preview(@Param('id') id: string) {
    const doc = await this.docService.findById(id);
    const markdownDoc = await this.docService.getPreviewMarkdown(doc.id);
    return {
      metadata: { id: doc.id, name: doc.name, type: doc.type, status: doc.status },
      markdown: markdownDoc?.markdown_content?.slice(0, 10000) || '',
    };
  }

  /** 重新索引：清理旧索引 → 触发新索引 */
  @Post(':id/reindex')
  @UseGuards(JwtAuthGuard)
  async reindex(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.docService.clearIndexes(id);
    return this.docService.triggerIndex(id, user.id);
  }
}
