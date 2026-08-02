import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AsrProvider, AsrSession, AsrCallbacks } from './asr-provider.interface';

/**
 * 阿里云百炼（DashScope）实时语音识别 Provider
 *
 * 使用 DashScope Paraformer realtime-v2 模型，通过 WebSocket 双向流式通信。
 * 复用已有的 ALIYUN_API_KEY 凭证。
 *
 * API 文档参考: https://help.aliyun.com/zh/model-studio/real-time-speech-recognition
 */
export class AliDashScopeAsrProvider implements AsrProvider {
  private readonly logger = new Logger(AliDashScopeAsrProvider.name);
  private readonly endpoint = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

  constructor(private readonly apiKey: string) {}

  async start(sessionId: string, callbacks: AsrCallbacks): Promise<AsrSession> {
    // DashScope 实时 ASR 通过 URL query 参数传递 API Key 鉴权
    // Node.js 内置 WebSocket 不支持自定义 header
    const ws = new WebSocket(`${this.endpoint}?token=${encodeURIComponent(this.apiKey)}`);

    const taskId = randomUUID();
    let finalText = '';
    let wsReady = false;
    const pendingChunks: Buffer[] = [];

    const sendStartCommand = () => {
      wsReady = true;
      // DashScope 实时识别启动命令
      const startCmd = JSON.stringify({
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'paraformer-realtime-v2',
          parameters: {
            format: 'pcm',
            sample_rate: 16000,
            // 单声道
            disfluency_removal_enabled: false,
          },
          input: {},
        },
      });
      ws.send(startCmd);
      // 发送积压的音频数据
      for (const chunk of pendingChunks) {
        ws.send(chunk);
      }
      pendingChunks.length = 0;
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('阿里云 ASR WebSocket 连接超时（10s）'));
      }, 10000);

      ws.addEventListener('open', () => {
        sendStartCommand();
        this.logger.log(`DashScope ASR 会话已连接: ${sessionId} taskId=${taskId}`);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          const header = msg.header;
          const payload = msg.payload;

          if (header?.event === 'task-started') {
            clearTimeout(timeout);
            this.logger.log(`DashScope 任务已启动: ${sessionId}`);
            resolve({
              feedAudio: async (buffer: Buffer) => {
                if (!wsReady || ws.readyState !== WebSocket.OPEN) {
                  pendingChunks.push(buffer);
                  return;
                }
                ws.send(buffer);
              },
              end: async (): Promise<string> => {
                // 发送 finish-task 命令
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    header: { action: 'finish-task', task_id: taskId },
                    payload: {},
                  }));
                }
                // 等待最终结果（最多 3 秒）
                await new Promise((r) => setTimeout(r, 3000));
                ws.close();
                return finalText;
              },
            });
            return;
          }

          if (header?.event === 'result-generated' && payload?.output?.sentence) {
            const sentence = payload.output.sentence;
            const text: string = sentence.text || '';
            const isFinal: boolean = sentence.is_final === true || sentence.end_time !== undefined;

            if (text) {
              if (isFinal) {
                finalText += text;
                callbacks.onFinalResult(text);
              } else {
                callbacks.onPartialResult(text);
              }
            }
            return;
          }

          if (header?.event === 'task-failed') {
            const errMsg = payload?.output?.message || payload?.message || 'unknown error';
            this.logger.error(`DashScope 任务失败: ${sessionId} — ${errMsg}`);
            callbacks.onError(new Error(`阿里云 ASR 识别失败: ${errMsg}`));
          }
        } catch (err) {
          this.logger.warn(`DashScope 消息解析失败: ${(err as Error).message}`);
        }
      });

      ws.addEventListener('error', (event) => {
        clearTimeout(timeout);
        this.logger.error(`DashScope WebSocket 错误: ${sessionId}`);
        callbacks.onError(new Error('阿里云 ASR WebSocket 连接错误'));
        reject(new Error('阿里云 ASR WebSocket 连接错误'));
      });

      ws.addEventListener('close', (event) => {
        this.logger.log(`DashScope WebSocket 关闭: ${sessionId} code=${event.code}`);
      });
    });
  }
}
