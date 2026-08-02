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
  private sessions = new Map<string, { isListening: boolean; client: Socket }>();

  constructor(
    private readonly asrService: AsrService,
    private readonly ttsService: TtsService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`语音客户端连接: ${client.id}`);
    this.sessions.set(client.id, { isListening: false, client });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`语音客户端断开: ${client.id}`);
    this.sessions.delete(client.id);
    this.asrService.endSession(client.id).catch((e) => this.logger.error(e));
  }

  /** 开始监听：初始化 ASR 会话 */
  @SubscribeMessage('startListening')
  async handleStartListening(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = true;

    try {
      await this.asrService.startSession(client.id, {
        onPartialResult: (text: string) => {
          client.emit('asrResult', { text, isFinal: false });
        },
        onFinalResult: (text: string) => {
          client.emit('asrResult', { text, isFinal: true });
        },
        onError: (err: Error) => {
          this.logger.error(`ASR 错误 [${client.id}]: ${err.message}`);
          client.emit('asrResult', { text: '', isFinal: true, error: err.message });
        },
      });
    } catch (err) {
      this.logger.error(`启动 ASR 会话失败 [${client.id}]: ${(err as Error).message}`);
      client.emit('asrResult', { text: '', isFinal: true, error: '语音服务暂不可用' });
    }
  }

  /** 接收音频分片（PCM 16kHz 16bit 单声道） */
  @SubscribeMessage('audio')
  async handleAudio(client: Socket, payload: ArrayBuffer): Promise<void> {
    const session = this.sessions.get(client.id);
    if (!session?.isListening) return;

    const buffer = Buffer.from(payload);
    await this.asrService.feedAudio(client.id, buffer);
  }

  /** 停止监听：结束 ASR 会话，获取完整文本 */
  @SubscribeMessage('stopListening')
  async handleStopListening(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = false;

    const finalText = await this.asrService.endSession(client.id);
    this.logger.log(`ASR 最终文本 [${client.id}]: "${finalText.slice(0, 50)}${finalText.length > 50 ? '…' : ''}"`);

    if (finalText.trim()) {
      client.emit('triggerChat', { message: finalText.trim(), sessionId: client.id });
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
}
