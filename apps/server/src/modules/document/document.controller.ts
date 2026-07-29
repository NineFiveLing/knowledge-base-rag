import {
  Controller, Post, Get, Param, Query, Req, UseGuards,
  UseInterceptors, UploadedFile, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentService } from './document.service';
import { ListDocumentDto } from './dto/list-document.dto';

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
    return { id };
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
}
