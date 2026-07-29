import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { AsrService } from './services/asr.service';
import { TtsService } from './services/tts.service';

/**
 * 语音 WebSocket 网关：音频上行 → ASR → 前端触发 SSE 文字聊天
 * 命名空间 /voice
 */
@WebSocketGateway({ namespace: '/voice', cors: { origin: '*' } })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(VoiceGateway.name);
  private sessions = new Map<string, { isListening: boolean }>();

  constructor(
    private readonly asrService: AsrService,
    private readonly ttsService: TtsService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`语音客户端连接: ${client.id}`);
    this.sessions.set(client.id, { isListening: false });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`语音客户端断开: ${client.id}`);
    this.sessions.delete(client.id);
    this.asrService.endSession(client.id).catch(e => this.logger.error(e));
  }

  /** 接收音频分片 */
  @SubscribeMessage('audio')
  async handleAudio(client: Socket, payload: ArrayBuffer): Promise<void> {
    const session = this.sessions.get(client.id);
    if (!session) return;

    const buffer = Buffer.from(payload);
    const result = await this.asrService.feedAudio(client.id, buffer);

    client.emit('asrResult', { text: result.text, isFinal: result.isFinal });

    if (result.isFinal && result.text.trim()) {
      session.isListening = false;
      client.emit('triggerChat', { message: result.text, sessionId: client.id });
    }
  }

  /** 接收 TTS 请求 */
  @SubscribeMessage('ttsRequest')
  async handleTts(client: Socket, text: string): Promise<void> {
    for await (const audioChunk of this.ttsService.synthesizeStream(text)) {
      client.emit('audioChunk', audioChunk);
    }
    client.emit('audioEnd');
  }

  @SubscribeMessage('startListening')
  handleStartListening(client: Socket): void {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = true;
    this.asrService.startSession(client.id).catch(e => this.logger.error(e));
  }

  @SubscribeMessage('stopListening')
  async handleStopListening(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = false;

    const finalText = await this.asrService.endSession(client.id);
    if (finalText.trim()) {
      client.emit('triggerChat', { message: finalText, sessionId: client.id });
    }
  }
}
