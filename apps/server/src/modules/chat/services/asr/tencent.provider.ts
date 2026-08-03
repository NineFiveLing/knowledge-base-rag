import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import type { AsrProvider, AsrSession, AsrCallbacks } from './asr-provider.interface';

/**
 * 腾讯云实时语音识别 Provider
 *
 * 通过 WebSocket 连接腾讯云 ASR v2 接口，使用 HMAC-SHA1 签名鉴权。
 * 需要 TENCENT_SECRET_ID、TENCENT_SECRET_KEY、TENCENT_APP_ID 环境变量。
 *
 * API 文档参考: https://cloud.tencent.com/document/product/1093/48982
 */
export class TencentAsrProvider implements AsrProvider {
  private readonly logger = new Logger(TencentAsrProvider.name);
  private readonly endpoint = 'asr.cloud.tencent.com';

  constructor(
    private readonly secretId: string,
    private readonly secretKey: string,
    private readonly appId: string,
    private readonly model: string,
  ) {}

  /** 生成腾讯云 ASR WebSocket 鉴权签名 */
  private buildSignature(): { url: string; signature: string } {
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400; // 24h 后过期
    const voiceId = randomUUID();
    // voice_format: 1 = PCM 16bit
    const params: Record<string, string> = {
      secretid: this.secretId,
      timestamp: String(timestamp),
      expired: String(expired),
      voice_id: voiceId,
      voice_format: '1',
      // 默认模型 fun-asr-mtl 映射为 16k_zh（16kHz 中文），其他模型名原样透传为 engine_model_type
      engine_model_type: this.model === 'fun-asr-mtl' ? '16k_zh' : this.model,
      needvad: '1',                       // 启用服务端 VAD
      filter_dirty: '0',
      filter_modal: '0',
      filter_punc: '0',
      convert_num_mode: '1',
      word_info: '0',
    };

    // 按 key 排序
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
    const path = `/asr/v2/${this.appId}`;
    const signStr = `${this.endpoint}${path}?${queryString}`;

    const signature = createHmac('sha1', this.secretKey)
      .update(signStr)
      .digest('base64');

    // 对 signature 做 URL 编码
    const encodedSig = encodeURIComponent(signature);

    const url = `wss://${this.endpoint}${path}?${queryString}&signature=${encodedSig}`;

    return { url, signature };
  }

  async start(sessionId: string, callbacks: AsrCallbacks): Promise<AsrSession> {
    const { url } = this.buildSignature();
    const ws = new WebSocket(url);
    let accumulatedText = '';
    // 腾讯云实时 ASR 使用二进制帧，不需要启动命令

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };

      const timeout = setTimeout(() => {
        settle(new Error('腾讯云 ASR WebSocket 连接超时（10s）'));
      }, 10000);

      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        this.logger.log(`腾讯云 ASR 会话已连接: ${sessionId}`);

        resolve({
          feedAudio: async (buffer: Buffer) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(buffer);
          },
          end: async (): Promise<string> => {
            // 发送结束标记（空帧或特定 JSON）
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'end' }));
            }
            // 等待服务端确认（最多 3 秒）
            await new Promise((r) => setTimeout(r, 3000));
            ws.close();
            return accumulatedText;
          },
        });
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          // 腾讯云 ASR 响应结构:
          // { code: 0, message: "success", voice_id: "...",
          //   result: { slice_type: 0|1|2, voice_text_str: "...", ... } }
          if (msg.code !== 0) {
            this.logger.error(`腾讯云 ASR 错误: ${msg.code} — ${msg.message}`);
            callbacks.onError(new Error(`腾讯云 ASR 识别失败: ${msg.message || 'code ' + msg.code}`));
            return;
          }

          const result = msg.result;
          if (!result) return;

          const text: string = result.voice_text_str || '';
          const sliceType: number = result.slice_type;

          // slice_type: 0=开始, 1=中间结果, 2=最终结果
          if (sliceType === 2 && text) {
            accumulatedText += text;
            callbacks.onFinalResult(text);
          } else if (sliceType === 1 && text) {
            callbacks.onPartialResult(text);
          }
          // slice_type === 0 不处理
        } catch (err) {
          this.logger.warn(`腾讯云 ASR 消息解析失败: ${(err as Error).message}`);
        }
      });

      ws.addEventListener('error', () => {
        this.logger.error(`腾讯云 ASR WebSocket 错误: ${sessionId}`);
        settle(new Error('腾讯云 ASR WebSocket 连接错误'));
      });

      ws.addEventListener('close', (event) => {
        this.logger.log(`腾讯云 ASR WebSocket 关闭: ${sessionId} code=${event.code}`);
        settle(new Error(`腾讯云 ASR WebSocket 连接关闭 (code=${event.code})`));
      });
    });
  }
}
