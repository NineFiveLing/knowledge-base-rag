import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * 语音 WebSocket 网关（MVP 骨架）
 * 完整实现：音频流 → ASR → ChatService → TTS → 推回客户端
 */
@WebSocketGateway({ namespace: '/voice', cors: { origin: '*' } })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    console.log(`[Voice] 客户端已连接: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[Voice] 客户端已断开: ${client.id}`);
  }
}
