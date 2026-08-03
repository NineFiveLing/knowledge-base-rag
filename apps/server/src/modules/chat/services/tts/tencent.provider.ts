import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import type { TtsProvider, TtsSession, TtsCallbacks } from './tts-provider.interface';

/**
 * 腾讯云流式文本语音合成 Provider
 *
 * 通过 WebSocket v2 协议连接腾讯云实时语音合成服务（TextToStreamAudioWSv2），
 * 支持 HMAC-SHA1 签名鉴权，流式 PCM 音频输出。
 *
 * API 文档: https://cloud.tencent.com/document/product/1073/108595
 */
export class TencentTtsProvider implements TtsProvider {
  private readonly logger = new Logger(TencentTtsProvider.name);
  private readonly endpoint = 'tts.cloud.tencent.com';
  private readonly voiceType: number = 101001; // 智瑜（标准女声）
  private readonly sampleRate: number = 16000;

  constructor(
    private readonly secretId: string,
    private readonly secretKey: string,
    private readonly appId: string,
  ) {}

  /** 生成 HMAC-SHA1 签名，返回完整 WSS URL */
  private buildUrl(sessionId: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400;

    const params: Record<string, string> = {
      Action: 'TextToStreamAudioWSv2',
      AppId: this.appId,
      Codec: 'pcm',
      Expired: String(expired),
      SampleRate: String(this.sampleRate),
      SecretId: this.secretId,
      SessionId: sessionId,
      Speed: '0',
      Timestamp: String(timestamp),
      VoiceType: String(this.voiceType),
      Volume: '5',
    };

    // 按 key 字典序排序
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
    const path = `/stream_wsv2`;
    const signStr = `GET${this.endpoint}${path}?${queryString}`;

    const signature = createHmac('sha1', this.secretKey)
      .update(signStr)
      .digest('base64');

    const encodedSig = encodeURIComponent(signature);

    return `wss://${this.endpoint}${path}?${queryString}&Signature=${encodedSig}`;
  }

  async start(callbacks: TtsCallbacks): Promise<TtsSession> {
    // 先生成 sessionId，确保 URL 签名和后续 WebSocket 消息中的 session_id 一致
    const sessionId = randomUUID();
    const url = this.buildUrl(sessionId);
    const ws = new WebSocket(url);

    let ready = false;
    let ended = false;
    const pendingText: string[] = [];

    const sendAction = (action: string, data?: string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const msg = JSON.stringify({
        session_id: sessionId,
        message_id: randomUUID(),
        action,
        data,
      });
      ws.send(msg);
    };

    const flushPending = () => {
      ready = true;
      for (const text of pendingText) {
        sendAction('ACTION_SYNTHESIS', text);
      }
      pendingText.length = 0;
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };

      const timeout = setTimeout(() => {
        settle(new Error('腾讯云 TTS WebSocket 连接超时（10s）'));
      }, 10000);

      ws.addEventListener('open', () => {
        this.logger.log(`腾讯云 TTS WebSocket 已连接: session=${sessionId} urlSigned=${url.substring(0, 80)}...`);
      });

      ws.addEventListener('message', async (event) => {
        // 二进制帧 = PCM 音频数据
        if (typeof event.data !== 'string') {
          // Node.js v24 undici WebSocket 二进制帧可能是 Blob，不是 ArrayBuffer
          let arrayBuffer: ArrayBuffer | SharedArrayBuffer;
          if (event.data instanceof Blob) {
            arrayBuffer = await event.data.arrayBuffer();
          } else if (event.data instanceof ArrayBuffer) {
            arrayBuffer = event.data;
          } else {
            // Buffer（旧版 Node.js ws 库）
            arrayBuffer = (event.data as Buffer).buffer.slice(
              (event.data as Buffer).byteOffset,
              (event.data as Buffer).byteOffset + (event.data as Buffer).byteLength,
            );
          }
          const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
          if (buffer.length > 0) {
            callbacks.onAudioChunk(buffer);
          }
          return;
        }

        // JSON 事件
        try {
          const msg = JSON.parse(event.data as string);
          this.logger.log(`📨 腾讯云 TTS 消息: ${JSON.stringify(msg).substring(0, 500)}`);

          // 首次 success 即表示握手完成，服务端已就绪（含可能的 ready 字段）
          if (msg.code === 0 && msg.message === 'success') {
            if (!settled) {
              clearTimeout(timeout);
              settled = true;
              this.logger.log(`腾讯云 TTS 就绪 (success): session=${sessionId} ready=${msg.ready}`);
              // 若 success 消息里直接有 ready=1，立即 flush
              if (msg.ready === 1) {
                flushPending();
              }
              resolve({
                feedText: (text: string) => {
                  if (ended) return;
                  if (!ready) {
                    pendingText.push(text);
                    return;
                  }
                  sendAction('ACTION_SYNTHESIS', text);
                },
                end: () => {
                  if (ended) return;
                  ended = true;
                  if (!ready) flushPending();
                  sendAction('ACTION_COMPLETE');
                },
                cancel: () => {
                  if (ended) return;
                  ended = true;
                  ws.close();
                },
              });
            }
            // 后续 success 可能是合成子句确认（含 final/subtitles 等），忽略
            return;
          }

          // 兼容旧逻辑：ready 信号可能独立出现（非 success 包装）
          if (msg.ready === 1 && !settled) {
            clearTimeout(timeout);
            settled = true;
            flushPending();
            this.logger.log(`腾讯云 TTS 就绪 (ready): session=${sessionId}`);
            resolve({
              feedText: (text: string) => {
                if (ended) return;
                if (!ready) { pendingText.push(text); return; }
                sendAction('ACTION_SYNTHESIS', text);
              },
              end: () => {
                if (ended) return;
                ended = true;
                if (!ready) flushPending();
                sendAction('ACTION_COMPLETE');
              },
              cancel: () => {
                if (ended) return;
                ended = true;
                ws.close();
              },
            });
            return;
          }

          // 合成完成
          if (msg.final === 1) {
            callbacks.onEnd();
            ws.close();
            return;
          }

          // 心跳（忽略）
          if (msg.heartbeat === 1) {
            return;
          }

          // 错误
          if (msg.code && msg.code !== 0) {
            const errMsg = msg.message || `code=${msg.code}`;
            this.logger.error(`腾讯云 TTS 错误: ${errMsg}`);
            callbacks.onError(new Error(`TTS 合成失败: ${errMsg}`));
          }
        } catch {
          this.logger.warn(`腾讯云 TTS 无法解析消息: ${String(event.data).substring(0, 100)}`);
        }
      });

      ws.addEventListener('error', () => {
        this.logger.error(`腾讯云 TTS WebSocket 错误: session=${sessionId}`);
        settle(new Error('腾讯云 TTS WebSocket 连接错误'));
      });

      ws.addEventListener('close', (event) => {
        if (!ended) {
          // 非正常结束（如连接中断），通知结束
          callbacks.onEnd();
        }
        this.logger.log(`腾讯云 TTS WebSocket 关闭: session=${sessionId} code=${event.code}`);
        settle(new Error(`腾讯云 TTS WebSocket 连接关闭 (code=${event.code})`));
      });
    });
  }
}
