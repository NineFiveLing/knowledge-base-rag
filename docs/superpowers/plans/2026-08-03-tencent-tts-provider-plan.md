# 腾讯云 TTS Provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现腾讯云流式 TTS Provider（TencentTtsProvider），通过 WebSocket v2 协议对接腾讯云实时语音合成服务

**Architecture:** 遵循现有 TtsProvider 接口模式，与 AliNlsTtsProvider 并行。HMAC-SHA1 签名鉴权复用 TencentAsrProvider 的签名模式。通过 tts-provider.factory.ts 的 `DEFAULT_TTS_PROVIDER` 切换

**Tech Stack:** NestJS + TypeScript + WebSocket (built-in) + HMAC-SHA1 签名

## Global Constraints

- 签名算法：HMAC-SHA1，域名 `tts.cloud.tencent.com`，路径 `/stream_wsv2`
- 音频格式：PCM 16kHz 16bit 单声道（与 TtsCallbacks.onAudioChunk 一致）
- 默认音色 `101001`、语速 `0`、音量 `5`
- 连接超时 10s，超时或异常关闭 reject Promise
- 代码风格遵循 AliNlsTtsProvider 和 TencentAsrProvider 现有模式
- 编译验证：`cd apps/server && npx tsc --noEmit`
- 不提交（后续一起提交）

---

### Task 1: 腾讯云 TTS Provider + 工厂注册

**Files:**
- Create: `apps/server/src/modules/chat/services/tts/tencent.provider.ts`
- Modify: `apps/server/src/modules/chat/services/tts/tts-provider.factory.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `TencentTtsProvider implements TtsProvider` — 构造函数 `(secretId, secretKey, appId)`，调用 `start(callbacks): Promise<TtsSession>`
- Produces: `createTtsProvider` 新增 `case 'tencent'` 分支，读取 `TENCENT_SECRET_ID/SECRET_KEY/APP_ID`

- [ ] **Step 1: 创建 tencent.provider.ts**

完整代码（新建文件）：

```typescript
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
  private buildUrl(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400;
    const sessionId = randomUUID();

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
    const url = this.buildUrl();
    const ws = new WebSocket(url);
    const sessionId = randomUUID();

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
        this.logger.log(`腾讯云 TTS WebSocket 已连接: session=${sessionId}`);
      });

      ws.addEventListener('message', (event) => {
        // 二进制帧 = PCM 音频数据
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

          // 鉴权成功
          if (msg.code === 0 && msg.message === 'success') {
            return;
          }

          // 服务端就绪，可开始输入文本
          if (msg.ready === 1) {
            clearTimeout(timeout);
            this.logger.log(`腾讯云 TTS 就绪: session=${sessionId}`);
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
          // 解析失败忽略
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
```

- [ ] **Step 2: 修改 tts-provider.factory.ts — 新增 tencent 分支**

当前 `tts-provider.factory.ts` 完整内容替换为：

```typescript
import { ConfigService } from '@nestjs/config';
import type { TtsProvider } from './tts-provider.interface';
import { AliNlsTtsProvider } from './ali-nls.provider';
import { TencentTtsProvider } from './tencent.provider';

/** 根据 DEFAULT_TTS_PROVIDER 配置创建对应的 TTS 提供商实例 */
export function createTtsProvider(config: ConfigService): TtsProvider {
  const provider = (config.get('DEFAULT_TTS_PROVIDER') || 'aliyun').toLowerCase();

  switch (provider) {
    case 'aliyun': {
      const accessKeyId = config.get('ALIYUN_NLS_ACCESS_KEY_ID') || '';
      const accessKeySecret = config.get('ALIYUN_NLS_ACCESS_KEY_SECRET') || '';
      const appKey = config.get('ALIYUN_NLS_APP_KEY') || '';
      if (!accessKeyId || !accessKeySecret || !appKey) {
        throw new Error('ALIYUN_NLS_ACCESS_KEY_ID/SECRET/APP_KEY 未配置，NLS TTS 不可用');
      }
      return new AliNlsTtsProvider(accessKeyId, accessKeySecret, appKey);
    }
    case 'tencent': {
      const secretId = config.get('TENCENT_SECRET_ID') || '';
      const secretKey = config.get('TENCENT_SECRET_KEY') || '';
      const appId = config.get('TENCENT_APP_ID') || '';
      if (!secretId || !secretKey) {
        throw new Error('TENCENT_SECRET_ID/SECRET_KEY 未配置，腾讯云 TTS 不可用');
      }
      if (!appId) {
        throw new Error('TENCENT_APP_ID 未配置，腾讯云 TTS 需要 AppID');
      }
      return new TencentTtsProvider(secretId, secretKey, appId);
    }
    default:
      throw new Error(`未知 TTS 提供商: ${provider}，可选值: aliyun, tencent`);
  }
}
```

- [ ] **Step 3: 更新 .env.example — TTS 注释说明**

`.env.example` 中 TTS 相关部分：

```env
# 默认 TTS/ASR 提供商: aliyun | tencent
DEFAULT_ASR_PROVIDER=aliyun
DEFAULT_TTS_PROVIDER=aliyun
```

注释已包含 `aliyun | tencent`，无需额外修改。确认 `.env.example` 第 67 行注释清晰即可。

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 确认不提交**

本任务变更暂不提交，后续与 TTS 模型配置一起提交。

---

## Task Dependencies

```
Task 1 (TencentTtsProvider + factory) — 独立，无依赖
```
