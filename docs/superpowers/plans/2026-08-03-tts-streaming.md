# TTS 流式语音输出 & 暂停播放 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI 回答流式输出文字的同时，通过 WebSocket 并行流式输出语音，支持延迟启动和暂停/恢复播放

**Architecture:** 服务端编排方案 — SSE 文字流内部桥接阿里云 NLS 流式 TTS WebSocket，音频 chunk 通过 `/voice` WebSocket 下发前端。TTS 采用与 ASR 一致的 Provider 模式

**Tech Stack:** NestJS + Socket.IO + 阿里云智能语音交互 NLS WebSocket API + React AudioContext

**Spec:** `docs/superpowers/specs/2026-08-03-tts-streaming-design.md`

## Global Constraints

- 按现有 ASR Provider 模式镜像实现 TTS Provider（接口、工厂、服务三层）
- 支付宝 NLS 流式 TTS WebSocket 协议：`FlowingSpeechSynthesizer` namespace
- 音频格式：PCM 16kHz 16bit 单声道
- 环境变量 `ALIYUN_NLS_ACCESS_KEY_ID/SECRET/APP_KEY` 已在 `.env` 中预留
- 前端用 AudioContext 播放 PCM，不依赖 `<audio>` 标签

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `services/tts/tts-provider.interface.ts` | TTS Provider 接口 + Session 接口 | **新建** |
| `services/tts/ali-nls.provider.ts` | 阿里云 NLS 流式 TTS WebSocket Provider | **新建** |
| `services/tts/tts-provider.factory.ts` | TTS Provider 工厂（aliyun/tencent 可切换） | **新建** |
| `services/tts.service.ts` | TTS 编排服务（多会话管理） | **重写** |
| `voice.gateway.ts` | 新增 pauseTts/resumeTts 事件 | **修改** |
| `chat.service.ts` | SSE 流内集成 TTS 并行输出 | **修改** |
| `chat.module.ts` | 注册新 Provider | **修改** |
| `hooks/useTtsPlayer.ts` | 前端 TTS 播放 Hook | **新建** |

---

### Task 1: TTS Provider 接口定义

**Files:**
- Create: `apps/server/src/modules/chat/services/tts/tts-provider.interface.ts`

**Interfaces:**
- Produces: `TtsCallbacks`, `TtsSession`, `TtsProvider` — 供 Task 2/3/4 使用

```ts
// apps/server/src/modules/chat/services/tts/tts-provider.interface.ts
import { Buffer } from 'buffer';

/** TTS 合成结果回调 */
export interface TtsCallbacks {
  /** 音频分片（PCM 16kHz 16bit 单声道） */
  onAudioChunk: (buffer: Buffer) => void;
  /** 全部合成完成 */
  onEnd: () => void;
  /** 合成过程中的错误 */
  onError: (error: Error) => void;
}

/** 单个 TTS 合成会话 */
export interface TtsSession {
  /** 送入文本（可多次调用实现流式输入） */
  feedText(text: string): void;
  /** 结束文本输入，服务端合成剩余缓存后触发 onEnd */
  end(): void;
  /** 立即取消（暂停用，不触发 onEnd） */
  cancel(): void;
}

/** TTS 提供商抽象接口 */
export interface TtsProvider {
  /** 创建合成会话，连接 TTS 服务端 WebSocket */
  start(callbacks: TtsCallbacks): Promise<TtsSession>;
}
```

- [ ] **Step 1: 创建接口文件**

- [ ] **Step 2: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/services/tts/tts-provider.interface.ts
git commit -m "feat(tts): 定义 TTS Provider 接口 (TtsSession/TtsProvider/TtsCallbacks)"
```

---

### Task 2: 阿里云 NLS 流式 TTS Provider 实现

**Files:**
- Create: `apps/server/src/modules/chat/services/tts/ali-nls.provider.ts`

**Interfaces:**
- Consumes: `TtsProvider`, `TtsSession`, `TtsCallbacks` from Task 1
- Produces: `AliNlsTtsProvider` — 供 Task 3 工厂使用

**说明:**
- NLS Token 通过 HMAC-SHA1 签名调用 `https://nls-meta.cn-beijing.aliyuncs.com/pop/2018-05-18/tokens` 获取
- WebSocket 端点: `wss://nls-gateway-cn-beijing.aliyuncs.com/ws/v1?token=TOKEN`
- 协议: `FlowingSpeechSynthesizer` namespace
- 流程: WebSocket 建连 → StartSynthesis → 等 SynthesisStarted → RunSynthesis (可多次) → StopSynthesis → 等 SynthesisCompleted
- Binary frame = PCM 音频数据
- `message_id` 和 `task_id` 用 32 位 hex（无 `-`）

```ts
// apps/server/src/modules/chat/services/tts/ali-nls.provider.ts
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
    return data.Token?.Id || data.token?.id || data.Token;
  }

  async start(callbacks: TtsCallbacks): Promise<TtsSession> {
    const token = await this.fetchToken();
    const taskId = randomUUID().replace(/-/g, '');

    const ws = new WebSocket(`${this.wsEndpoint}?token=${encodeURIComponent(token)}`);

    let wsReady = false;
    let ended = false;
    const pendingText: string[] = [];

    const sendCmd = (name: string, payload: Record<string, any> = {}) => {
      const msg = JSON.stringify({
        header: {
          message_id: randomUUID().replace(/-/g, ''),
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
        // Binary frame = 音频数据
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
            // 非成功状态码（TaskFailed 单独处理）
            return;
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
                if (!wsReady) {
                  // 还没就绪就结束了：先 flush 再 stop
                  flushPending();
                }
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
```

- [ ] **Step 1: 创建 Provider 文件**

- [ ] **Step 2: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/services/tts/ali-nls.provider.ts
git commit -m "feat(tts): 实现阿里云 NLS 流式 TTS Provider (FlowingSpeechSynthesizer)"
```

---

### Task 3: TTS Provider 工厂

**Files:**
- Create: `apps/server/src/modules/chat/services/tts/tts-provider.factory.ts`

**Interfaces:**
- Consumes: `TtsProvider` from Task 1, `AliNlsTtsProvider` from Task 2
- Produces: `createTtsProvider()` — 供 Task 4 TtsService 使用

```ts
// apps/server/src/modules/chat/services/tts/tts-provider.factory.ts
import { ConfigService } from '@nestjs/config';
import type { TtsProvider } from './tts-provider.interface';
import { AliNlsTtsProvider } from './ali-nls.provider';

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
    default:
      throw new Error(`未知 TTS 提供商: ${provider}，可选值: aliyun`);
  }
}
```

- [ ] **Step 1: 创建工厂文件**

- [ ] **Step 2: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/services/tts/tts-provider.factory.ts
git commit -m "feat(tts): 添加 TTS Provider 工厂"
```

---

### Task 4: 重写 TtsService（Provider 模式 + 多会话管理）

**Files:**
- Modify: `apps/server/src/modules/chat/services/tts.service.ts`

**Interfaces:**
- Consumes: `createTtsProvider` from Task 3, `TtsProvider`, `TtsSession`, `TtsCallbacks` from Task 1
- Produces: `TtsService.startSession()`, `TtsService.feedText()`, `TtsService.endSession()`, `TtsService.cancelSession()` — 供 Task 5/6 使用

```ts
// apps/server/src/modules/chat/services/tts.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TtsProvider, TtsSession, TtsCallbacks } from './tts/tts-provider.interface';
import { createTtsProvider } from './tts/tts-provider.factory';

/**
 * TTS 编排服务
 *
 * 管理多会话 TTS 生命周期，通过 Provider 模式支持阿里云 NLS 流式合成。
 * 会话以 sessionId 为 key（与 chat session 对应）。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly provider: TtsProvider;
  private readonly sessions = new Map<string, TtsSession>();

  constructor(private readonly config: ConfigService) {
    this.provider = createTtsProvider(config);
  }

  /** 开始合成会话，返回 session 供内部使用 */
  async startSession(sessionId: string, callbacks: TtsCallbacks): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`TTS 会话 ${sessionId} 已存在，先结束旧会话`);
      await this.cancelSession(sessionId);
    }

    try {
      const session = await this.provider.start(callbacks);
      this.sessions.set(sessionId, session);
      this.logger.log(`TTS 会话开始: ${sessionId}`);
    } catch (err) {
      this.logger.error(`TTS 会话启动失败: ${sessionId} — ${(err as Error).message}`);
      throw err;
    }
  }

  /** 送入文本（流式 feed） */
  feedText(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.feedText(text);
  }

  /** 结束合成 */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.end();
    this.sessions.delete(sessionId);
    this.logger.log(`TTS 会话结束: ${sessionId}`);
  }

  /** 取消合成（暂停用） */
  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.cancel();
    this.sessions.delete(sessionId);
    this.logger.log(`TTS 会话取消: ${sessionId}`);
  }
}
```

- [ ] **Step 1: 重写 tts.service.ts**

- [ ] **Step 2: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/services/tts.service.ts
git commit -m "refactor(tts): 重写 TtsService 为 Provider 模式，支持 NLS 流式合成"
```

---

### Task 5: Voice Gateway 新增 pauseTts/resumeTts + getVoiceSocket

**Files:**
- Modify: `apps/server/src/modules/chat/voice.gateway.ts`

**Interfaces:**
- Consumes: `TtsService` from Task 4
- Produces: WebSocket 事件 `pauseTts`/`resumeTts`；`getVoiceSocket(sessionId)` 供 ChatService 查找 socket

**关键设计:**
前端语音聊天时 `sessionId` = Socket.IO `client.id`（见现有 `useVoiceChat` 中 `triggerChat` 的 `sessionId: client.id`），因此 ChatService 可通过 `sessionId` 从 VoiceGateway 查 socket。

```ts
// 完整的 voice.gateway.ts 变更

// 1. 新增注入 TtsService（之前只有 AsrService）
constructor(
  private readonly asrService: AsrService,
  private readonly ttsService: TtsService,
) {}

// 2. 新增公开方法：供 ChatService 获取 voice socket
getVoiceSocket(sessionId: string): Socket | undefined {
  return this.server?.sockets?.sockets?.get(sessionId);
}

// 3. 新增事件处理（替换旧 handleTts）
/** 暂停 TTS 合成 */
@SubscribeMessage('pauseTts')
handlePauseTts(client: Socket): void {
  this.logger.log(`TTS 暂停: ${client.id}`);
  this.ttsService.cancelSession(client.id);
  client.emit('ttsPaused', {});
}

/** 恢复 TTS 合成 */
@SubscribeMessage('resumeTts')
handleResumeTts(client: Socket): void {
  this.logger.log(`TTS 恢复: ${client.id}`);
  client.emit('ttsResumed', {});
}
```

**删除旧 `handleTts` 方法**（`ttsRequest` 事件不再使用，TTS 由 ChatService 驱动）。

- [ ] **Step 1: 修改 voice.gateway.ts**

- [ ] **Step 2: 更新 chat.module.ts**

`VoiceGateway` 构造函数新增 `TtsService` 依赖（之前只有 `AsrService`）：

```ts
// chat.module.ts — providers 数组不变，NestJS 自动注入
```

- [ ] **Step 3: 编译验证**

- [ ] **Step 4: Commit**

- [ ] **Step 1: 修改 voice.gateway.ts**

删除 `handleTts` 方法，新增 `handlePauseTts` 和 `handleResumeTts`

- [ ] **Step 2: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/voice.gateway.ts
git commit -m "feat(tts): voice gateway 新增 pauseTts/resumeTts，移除旧 ttsRequest"
```

---

### Task 6: ChatService 集成 TTS 并行流式输出

**Files:**
- Modify: `apps/server/src/modules/chat/chat.service.ts`

**Interfaces:**
- Consumes: `TtsService` from Task 4, `VoiceGateway.getVoiceSocket()` from Task 5
- Produces: SSE 文字流的同时，音频通过 VoiceGateway WebSocket 并行下发

**前置条件:** 前端发起 POST /chat/stream 时 `sessionId` = Socket.IO voice socket 的 `client.id`（语音聊天场景天然满足；文字聊天场景无需语音，查不到 socket 时跳过 TTS）

**核心变更：在 streamAnswer 的 SSE 流循环中集成 TTS**

```ts
// chat.service.ts

// 1. 注入新依赖
constructor(
  private rag: RAGService,
  public memory: MemoryService,
  private langfuse: LangfuseService,
  private tts: TtsService,            // 新增
  private voiceGateway: VoiceGateway, // 新增
  @InjectRepository(Conversation) private convRepo: Repository<Conversation>,
  @InjectRepository(Message) private msgRepo: Repository<Message>,
) {}

// 2. streamAnswer 中，SSE 流循环开始前初始化 TTS 状态
async *streamAnswer(message: string, userId: string, sessionId: string, conversationId?: string) {
  // ... 现有代码不变（记住xxx、记录用户消息、创建对话、yield conversation）...

  // ── TTS 状态 ──
  let ttsStarted = false;
  let ttsActive = false;
  let ttsPaused = false;
  let textBuffer = '';
  const TTS_DELAY_CHARS = 5;
  const voiceSocket = this.voiceGateway.getVoiceSocket(sessionId);

  // 3. 在现有 SSE 流循环中，处理文本 token 时同步 feed TTS
  for await (const event of stream) {
    // ... 现有节点追踪、token yield 逻辑保持不变 ...

    // 处理来自最终答案节点的流式 token
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
      const token = event.data.chunk.content;
      if (typeof token !== 'string') continue;
      if (!currentNode || !ANSWER_NODES.has(currentNode)) continue;

      // TTS 延迟启动 + 流式 feed
      if (voiceSocket) {
        if (!ttsStarted) {
          textBuffer += token;
          if (textBuffer.length >= TTS_DELAY_CHARS) {
            ttsStarted = true;
            ttsActive = true;
            this.startTtsStream(sessionId, textBuffer, voiceSocket);
          }
        } else if (ttsActive && !ttsPaused) {
          this.tts.feedText(sessionId, token);
        }
      }
    }

    // ... 现有 yield 逻辑保持不变 ...
  }

  // 4. SSE 流结束后结束 TTS
  if (ttsActive) {
    this.tts.endSession(sessionId);
  }

  // ... 现有代码（记录助手消息到 Redis/Postgres）保持不变 ...
}

// 5. 新增 private 方法
private async startTtsStream(sessionId: string, initialText: string, voiceSocket: Socket) {
  try {
    await this.tts.startSession(sessionId, {
      onAudioChunk: (buffer: Buffer) => {
        if (voiceSocket.connected) {
          voiceSocket.emit('audioChunk', buffer);
        }
      },
      onEnd: () => {
        if (voiceSocket.connected) {
          voiceSocket.emit('audioEnd');
        }
      },
      onError: (err: Error) => {
        this.logger.warn(`TTS 错误 [${sessionId}]: ${err.message}`);
        if (voiceSocket.connected) {
          voiceSocket.emit('ttsError', { message: err.message });
        }
      },
    });
    // 发送累积的缓冲文本
    this.tts.feedText(sessionId, initialText);
  } catch (err) {
    this.logger.warn(`TTS 启动失败 [${sessionId}]: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 1: 修改 chat.module.ts 注册 TtsService**

在 `ChatModule.providers` 中已含 `TtsService`，需确认 `VoiceGateway` 已注入 `TtsService`

- [ ] **Step 2: 修改 chat.service.ts**

注入 `TtsService` 和 `VoiceGateway`，在 SSE 流循环中添加 TTS 并行输出逻辑

- [ ] **Step 3: 编译验证**

Run: `cd apps/server && npx nest build`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/chat/chat.service.ts apps/server/src/modules/chat/chat.module.ts
git commit -m "feat(tts): SSE 文字流集成 TTS 并行流式输出（延迟5字启动）"
```

---

### Task 7: 前端 useTtsPlayer Hook

**Files:**
- Create: `apps/web/src/hooks/useTtsPlayer.ts`

**Interfaces:**
- Consumes: Socket.IO client (从调用方传入)
- Produces: `{ isPlaying, isPaused, startPlayer, pause, resume, stopPlayer }`

```ts
// apps/web/src/hooks/useTtsPlayer.ts
import { useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

export type TtsPlayerState = 'idle' | 'playing' | 'paused';

export function useTtsPlayer(socket: Socket | null) {
  const [state, setState] = useState<TtsPlayerState>('idle');
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 音频分片队列
  const chunksRef = useRef<Array<{ buffer: AudioBuffer; scheduledAt: number }>>([]);
  const nextStartRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  /** 获取或创建 AudioContext */
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
    }
    return audioCtxRef.current;
  }, []);

  /** PCM Int16 Buffer → AudioBuffer */
  const pcmToAudioBuffer = useCallback(async (pcm: ArrayBuffer): Promise<AudioBuffer> => {
    const ctx = getAudioCtx();
    const int16 = new Int16Array(pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuffer = ctx.createBuffer(1, float32.length, 16000);
    audioBuffer.getChannelData(0).set(float32);
    return audioBuffer;
  }, [getAudioCtx]);

  /** 调度一个 AudioBuffer 播放 */
  const scheduleChunk = useCallback((audioBuffer: AudioBuffer) => {
    const ctx = getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextStartRef.current);
    source.start(startTime);
    nextStartRef.current = startTime + audioBuffer.duration;
    chunksRef.current.push({ buffer: audioBuffer, scheduledAt: startTime });
  }, [getAudioCtx]);

  /** 清空播放队列 */
  const clearQueue = useCallback(() => {
    chunksRef.current = [];
    nextStartRef.current = 0;
  }, []);

  /** 注册 Socket 事件 */
  const startPlayer = useCallback(() => {
    if (!socket) return;
    clearQueue();
    setState('playing');

    socket.on('audioChunk', async (data: ArrayBuffer) => {
      if (state === 'paused') return;
      try {
        const audioBuffer = await pcmToAudioBuffer(data);
        scheduleChunk(audioBuffer);
      } catch { /* 音频解码失败跳过 */ }
    });

    socket.on('audioEnd', () => {
      setState('idle');
      nextStartRef.current = 0;
    });

    socket.on('ttsError', (data: { message: string }) => {
      console.warn('TTS 错误:', data.message);
    });
  }, [socket, clearQueue, pcmToAudioBuffer, scheduleChunk]);

  /** 暂停 */
  const pause = useCallback(() => {
    if (!socket) return;
    setState('paused');
    clearQueue();
    socket.emit('pauseTts');
  }, [socket, clearQueue]);

  /** 恢复 */
  const resume = useCallback(() => {
    if (!socket) return;
    setState('playing');
    clearQueue();
    socket.emit('resumeTts');
  }, [socket, clearQueue]);

  /** 停止 */
  const stopPlayer = useCallback(() => {
    setState('idle');
    clearQueue();
    socket?.off('audioChunk');
    socket?.off('audioEnd');
    socket?.off('ttsError');
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, [socket, clearQueue]);

  return {
    state,
    isPlaying: state === 'playing',
    isPaused: state === 'paused',
    startPlayer,
    pause,
    resume,
    stopPlayer,
  };
}
```

- [ ] **Step 1: 创建 Hook 文件**

- [ ] **Step 2: 编译验证**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useTtsPlayer.ts
git commit -m "feat(tts): 添加 useTtsPlayer Hook (PCM AudioContext 播放 + 暂停/恢复)"
```
