import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';

/** 聊天控制器：SSE 流式问答 */
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
    const stream = this.chatService.streamAnswer(dto.message, user.id, sessionId);

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
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
}
