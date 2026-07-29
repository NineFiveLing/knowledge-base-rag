import {
  Controller, Post, Get, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentService } from './document.service';

/** 文档管理控制器 */
@Controller('documents')
export class DocumentController {
  constructor(private docService: DocumentService) {}

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

  /** 查询文档列表（带权限过滤） */
  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser() user: { id: string },
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    // MVP: 简化实现，后续接入权限过滤
    return { items: [], total: 0, page, pageSize };
  }

  /** 查询单个文档详情 */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async detail(@Param('id') id: string) {
    return { id };
  }
}
