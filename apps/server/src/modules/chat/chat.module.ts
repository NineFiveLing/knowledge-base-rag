import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VoiceGateway } from './voice.gateway';
import { AsrService } from './services/asr.service';
import { TtsService } from './services/tts.service';
import { RAGModule } from '../rag/rag.module';
import { MemoryModule } from '../memory/memory.module';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

/** 聊天模块：SSE 流式问答 + WebSocket 语音网关 + 对话 CRUD */
@Module({
  imports: [RAGModule, MemoryModule, TypeOrmModule.forFeature([Conversation, Message])],
  controllers: [ChatController],
  providers: [ChatService, VoiceGateway, AsrService, TtsService],
  exports: [ChatService],
})
export class ChatModule {}
