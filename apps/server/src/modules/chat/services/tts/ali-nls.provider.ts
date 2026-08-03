import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import type { TtsProvider, TtsSession, TtsCallbacks } from './tts-provider.interface';

/**
 * 阿里云智能语音交互（NLS）流式 TTS Provider
 *
 * 通过 WebSocket 连接 NLS 流式文本语音合成服务，使用 HMAC-SHA1 签名获取 Token 鉴权。
 * namespace: FlowingSpeechSynthesizer
 *
 * API 文档: https://help.aliyun.com/zh/isi/developer-reference/streaming-text-tts-wss
 */
export class AliNlsTtsProvider implements TtsProvider {
  private readonly logger = new Logger(AliNlsTtsProvider.name);
  private readonly tokenEndpoint = 'https://nls-meta.cn-beijing.aliyuncs.com/pop/2018-05-18/tokens';
  private readonly wsEndpoint = 'wss://nls-gateway-cn-beijing.aliyuncs.com/ws/v1';

  constructor(
    private readonly accessKeyId: string,
    private readonly accessKeySecret: string,
    private readonly appKey: string,
    private readonly voice: string = 'xiaoyun',
    private readonly sampleRate: number = 16000,
  ) {}

  /** 生成 32 位 hex ID（无连字符） */
  private hexId(): string {
    return randomUUID().replace(/-/g, '');
  }

  /** 获取 NLS 临时 Token（24h 有效） */
  private async fetchToken(): Promise<string> {
    const body = JSON.stringify({ AccessKeyId: this.accessKeyId });
    const signature = createHmac('sha1', this.accessKeySecret)
      .update(body)
      .digest('base64');

    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `acs ${this.accessKeyId}:${signature}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`NLS Token 获取失败 (${res.status}): ${await res.text()}`);
    }

    const data = await res.json() as any;
    const token = data.Token?.Id || data.token?.id || data.Token;
    if (!token) throw new Error('NLS Token 响应中未找到 Token');
    return token;
  }

  async start(callbacks: TtsCallbacks): Promise<TtsSession> {
    const token = await this.fetchToken();
    const taskId = this.hexId();

    const ws = new WebSocket(`${this.wsEndpoint}?token=${encodeURIComponent(token)}`);

    let wsReady = false;
    let ended = false;
    const pendingText: string[] = [];

    const sendCmd = (name: string, payload: Record<string, any> = {}) => {
      const msg = JSON.stringify({
        header: {
          message_id: this.hexId(),
          task_id: taskId,
          namespace: 'FlowingSpeechSynthesizer',
          name,
          appkey: this.appKey,
        },
        payload,
      });
      ws.send(msg);
    };

    const flushPending = () => {
      wsReady = true;
      for (const text of pendingText) {
        sendCmd('RunSynthesis', { text });
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
        settle(new Error('NLS TTS WebSocket 连接超时（10s）'));
      }, 10000);

      ws.addEventListener('open', () => {
        sendCmd('StartSynthesis', {
          voice: this.voice,
          format: 'pcm',
          sample_rate: this.sampleRate,
          volume: 50,
          speech_rate: 0,
          pitch_rate: 0,
        });
      });

      ws.addEventListener('message', (event) => {
        // Binary frame = PCM 音频数据
        if (typeof event.data !== 'string') {
          const buffer = Buffer.from(event.data as ArrayBuffer);
          if (buffer.length > 0) {
            callbacks.onAudioChunk(buffer);
          }
          return;
        }

        // JSON 事件
        try {
          const msg = JSON.parse(event.data as string);
          const header = msg.header;
          const name = header?.name;
          const status = header?.status;

          if (status && status !== 20000000 && name !== 'TaskFailed') {
            return; // 跳过非致命状态
          }

          if (name === 'SynthesisStarted') {
            clearTimeout(timeout);
            this.logger.log(`NLS TTS 已启动: taskId=${taskId}`);
            resolve({
              feedText: (text: string) => {
                if (ended) return;
                if (!wsReady) {
                  pendingText.push(text);
                  return;
                }
                sendCmd('RunSynthesis', { text });
              },
              end: () => {
                if (ended) return;
                ended = true;
                if (!wsReady) flushPending();
                sendCmd('StopSynthesis', {});
              },
              cancel: () => {
                if (ended) return;
                ended = true;
                ws.close();
              },
            });
          }

          if (name === 'SynthesisCompleted') {
            callbacks.onEnd();
            ws.close();
          }

          if (name === 'TaskFailed') {
            const errMsg = msg.payload?.status_text || msg.payload?.message || 'unknown';
            this.logger.error(`NLS TTS 任务失败: taskId=${taskId} — ${errMsg}`);
            callbacks.onError(new Error(`TTS 合成失败: ${errMsg}`));
            ws.close();
          }
        } catch { /* 解析失败忽略 */ }
      });

      ws.addEventListener('error', () => {
        this.logger.error(`NLS TTS WebSocket 错误: taskId=${taskId}`);
        settle(new Error('NLS TTS WebSocket 连接错误'));
      });

      ws.addEventListener('close', (event) => {
        if (!ended) {
          callbacks.onEnd();
        }
        this.logger.log(`NLS TTS WebSocket 关闭: taskId=${taskId} code=${event.code}`);
        settle(new Error(`NLS TTS WebSocket 连接关闭 (code=${event.code})`));
      });
    });
  }
}
