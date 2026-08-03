import {
  Controller, Post, Get, Delete, Patch,
  Body, Param, Query, Res, NotFoundException, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

/** 聊天控制器：SSE 流式问答 + 对话 CRUD */
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  /** SSE 流式聊天端点 */
  @Post('stream')
  @UseGuards(JwtAuthGuard)
  async streamChat(
    @Body() dto: ChatDto,
    @CurrentUser() user: { id: string },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sessionId = dto.sessionId || `sess-${Date.now()}`;
    const stream = this.chatService.streamAnswer(dto.message, user.id, sessionId, dto.conversationId);

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  /** 单条消息 TTS 合成回放端点（按需播放某条消息的语音） */
  @Post('tts')
  @UseGuards(JwtAuthGuard)
  async synthesizeTts(
    @Body() dto: { text: string; messageId: string; sessionId: string },
    @CurrentUser() user: { id: string },
  ) {
    await this.chatService.ttsSynthesize(dto.text, dto.messageId, dto.sessionId);
    return { success: true };
  }

  /** 会话结束端点 */
  @Post('session/end')
  @UseGuards(JwtAuthGuard)
  async endSession(
    @Body('sessionId') sessionId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.chatService.memory.onSessionEnd(sessionId, user.id);
    return { success: true };
  }

  /** 当前用户的对话列表 */
  @Get('conversations')
  @UseGuards(JwtAuthGuard)
  async listConversations(
    @CurrentUser() user: { id: string },
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.chatService.listConversations(user.id, page || 1, pageSize || 20);
  }

  /** 新建对话 */
  @Post('conversations')
  @UseGuards(JwtAuthGuard)
  async createConversation(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(user.id, dto.title);
  }

  /** 获取对话消息列表 */
  @Get('conversations/:id/messages')
  @UseGuards(JwtAuthGuard)
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    try {
      return await this.chatService.getMessages(id, user.id);
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }

  /** 删除对话 */
  @Delete('conversations/:id')
  @UseGuards(JwtAuthGuard)
  async deleteConversation(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    try {
      return await this.chatService.deleteConversation(id, user.id);
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }

  /** 编辑对话标题 */
  @Patch('conversations/:id')
  @UseGuards(JwtAuthGuard)
  async updateConversation(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() user: { id: string },
  ) {
    try {
      return await this.chatService.updateConversation(id, user.id, dto.title);
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }
}
