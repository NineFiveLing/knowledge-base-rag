import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VoiceGateway } from './voice.gateway';

/** 聊天模块：SSE 流式问答 + WebSocket 语音网关 */
@Module({
  controllers: [ChatController],
  providers: [ChatService, VoiceGateway],
  exports: [ChatService],
})
export class ChatModule {}
