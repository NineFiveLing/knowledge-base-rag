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
    const isAdmin = user.roles?.includes('admin') || false;
    return this.kbService.update(id, dto, user.id, isAdmin);
  }

  /** 删除知识库 */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin') || false;
    await this.kbService.delete(id, user.id, isAdmin);
    return { success: true };
  }

  // ── 文件夹端点 ──

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
    const isAdmin = user.roles?.includes('admin') || false;
    return this.kbService.renameFolder(id, name, user.id, isAdmin);
  }

  /** 删除文件夹 */
  @Delete('folders/:id')
  async deleteFolder(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    const isAdmin = user.roles?.includes('admin') || false;
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
    const isAdmin = user.roles?.includes('admin') || false;
    return this.kbService.moveFolder(id, dto, user.id, isAdmin);
  }
}
