import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VoiceGateway } from './voice.gateway';
import { AsrService } from './services/asr.service';
import { TtsService } from './services/tts.service';
import { RAGModule } from '../rag/rag.module';
import { MemoryModule } from '../memory/memory.module';

/** 聊天模块：SSE 流式问答 + WebSocket 语音网关 */
@Module({
  imports: [RAGModule, MemoryModule],
  controllers: [ChatController],
  providers: [ChatService, VoiceGateway, AsrService, TtsService],
  exports: [ChatService],
})
export class ChatModule {}
