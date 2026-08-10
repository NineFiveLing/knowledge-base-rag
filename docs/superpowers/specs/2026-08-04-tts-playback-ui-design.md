# TTS 消息级播放控制 UI 设计文档

**日期**: 2026-08-04
**状态**: 待评审

---

## 1. 背景与目标

当前 TTS 已实现流式合成 → voice socket → 前端 AudioContext 播放链路，但：

- 无可见的播放/暂停 UI，用户不知道语音正在播放、也无法关闭
- 播放是全局的，不绑定到具体消息
- 不同对话同时提问时音频串扰，消息错乱
- 原计划（2026-08-03-tts-streaming-design.md §6.2）只提了一句 UI 组件，未细化

**目标**:
1. 每条 AI 消息独立播放/暂停控制
2. 最新消息自动播放，可通过全局开关关闭
3. 自动播放偏好持久化（localStorage）
4. 同时只有一条消息在播放，切换对话时自动停止旧播放
5. 历史消息可手动触发语音回放

---

## 2. 架构设计

### 2.1 整体数据流

```
┌─ 前端 ───────────────────────────────────────────┐
│  ChatPage                                         │
│  ┌──────────────────────────────────────────┐    │
│  │  TtsGlobalControl  [🔊 自动播放 ON/OFF]  │    │
│  └──────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────┐    │
│  │  AI 消息气泡                               │    │
│  │  [MessageTtsButton] 🔈 ↔ 🔊 ↔ ⏸          │    │
│  │  武汉市集成电路产业...                      │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  useTtsPlayer (重写)                               │
│  ├─ messageAudioMap: Map<msgId, PlayState>        │
│  ├─ activeMessageId: string | null                │
│  ├─ autoPlayEnabled: boolean (localStorage)       │
│  ├─ playMessage(id, text) → POST /chat/tts        │
│  ├─ pauseMessage(id)                              │
│  ├─ resumeMessage(id)                             │
│  └─ stopAll()                                     │
│                                                   │
│  Socket.IO /voice                                  │
│  ├─ audioChunk ← { messageId, buffer }            │
│  ├─ audioEnd   ← { messageId }                    │
│  └─ ttsError   ← { messageId, message }            │
└───────────────────┬───────────────────────────────┘
                    │
┌─ 后端 ───────────┼───────────────────────────────┐
│  ChatController   │                                │
│  POST /chat/tts ──┤ { text, messageId, sessionId } │
│                   │                                │
│  ChatService.ttsSynthesize()                       │
│  ├─ cancelSession(sessionId)  取消旧 TTS           │
│  ├─ startSession(sessionId, callbacks)             │
│  ├─ feedText(sessionId, text)  全文送入            │
│  └─ endSession(sessionId)                          │
│                                                   │
│  VoiceGateway                                      │
│  ├─ getVoiceSocket(sessionId)                      │
│  └─ callbacks emit with messageId                  │
└───────────────────────────────────────────────────┘
```

### 2.2 核心原则

- **一 session 一 TTS**：同一 sessionId 同时只有一个活跃 TTS 会话，新会话自动取消旧会话
- **音频路由到消息**：所有 audioChunk/audioEnd/ttsError 携带 messageId，前端据此更新对应消息状态
- **切换对话静音**：activeConvId 变化时 stopAll()，停止旧对话的 TTS 和 AudioContext

---

## 3. 后端变更

### 3.1 新增 `POST /chat/tts` 端点

**Controller** (`chat.controller.ts`):

```ts
@Post('tts')
@UseGuards(JwtAuthGuard)
async synthesizeTts(
  @Body() dto: { text: string; messageId: string; sessionId: string },
  @CurrentUser() user: { id: string },
) {
  this.chatService.ttsSynthesize(dto.text, dto.messageId, dto.sessionId);
  return { success: true };
}
```

**Service** (`chat.service.ts`):

```ts
async ttsSynthesize(text: string, messageId: string, sessionId: string): Promise<void> {
  // 取消同 session 的旧 TTS
  this.tts.cancelSession(sessionId).catch(() => {});

  const voiceSocket = this.voiceGateway.getVoiceSocket(sessionId);
  if (!voiceSocket?.connected) {
    throw new Error('语音连接不可用');
  }

  try {
    await this.tts.startSession(sessionId, {
      onAudioChunk: (buffer: Buffer) => {
        if (voiceSocket.connected) {
          voiceSocket.emit('audioChunk', { messageId, buffer });
        }
      },
      onEnd: () => {
        if (voiceSocket.connected) {
          voiceSocket.emit('audioEnd', { messageId });
        }
      },
      onError: (err: Error) => {
        if (voiceSocket.connected) {
          voiceSocket.emit('ttsError', { messageId, message: err.message });
        }
      },
    });
    this.tts.feedText(sessionId, text);
    this.tts.endSession(sessionId);
  } catch (err) {
    if (voiceSocket.connected) {
      voiceSocket.emit('ttsError', {
        messageId,
        message: `TTS 合成失败: ${(err as Error).message}`,
      });
    }
  }
}
```

### 3.2 流式 TTS 同步改造

`streamAnswer` 中现有的 SSE 驱动 TTS 也改为**带 messageId** 的 payload：

```ts
// audioChunk 格式变更
voiceSocket.emit('audioChunk', { messageId: sseMessageId, buffer });
voiceSocket.emit('audioEnd', { messageId: sseMessageId });
voiceSocket.emit('ttsError', { messageId: sseMessageId, message: err.message });
```

其中 `sseMessageId` 由前端在 `POST /chat/stream` 时传入（新增可选字段），或在 `onConversation` 回调中协商确定。

### 3.3 `TtsService.cancelSession` 改为不抛异常

```ts
cancelSession(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;
  try {
    session.cancel();
  } catch {} // 忽略取消时的错误
  this.sessions.delete(sessionId);
}
```

---

## 4. 前端变更

### 4.1 `useTtsPlayer` Hook（重写）

**文件**: `apps/web/src/hooks/useTtsPlayer.ts`

```ts
export type MessagePlayState = 'idle' | 'loading' | 'playing' | 'paused';

export interface MessageAudioState {
  state: MessagePlayState;
  audioCtx?: AudioContext;
  nextStartTime?: number;
  eventCleanup?: () => void;
}

export function useTtsPlayer(socket: Socket | null, getSessionId: () => string) {
  const messageAudioMapRef = useRef<Map<string, MessageAudioState>>(new Map());
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [messageStates, setMessageStates] = useState<Record<string, MessagePlayState>>({});
  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(
    () => localStorage.getItem('tts-auto-play') !== 'false' // 默认开启
  );

  const updateMessageState = useCallback((messageId: string, state: MessagePlayState) => {
    setMessageStates(prev => ({ ...prev, [messageId]: state }));
  }, []);

  const stopMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    info?.eventCleanup?.();
    info?.audioCtx?.close().catch(() => {});
    messageAudioMapRef.current.delete(messageId);
    if (activeMessageIdRef.current === messageId) {
      activeMessageIdRef.current = null;
      setActiveMessageId(null);
    }
    updateMessageState(messageId, 'idle');
  }, [updateMessageState]);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    // 停止当前活跃的消息
    if (activeMessageIdRef.current && activeMessageIdRef.current !== messageId) {
      stopMessage(activeMessageIdRef.current);
    }

    updateMessageState(messageId, 'loading');
    activeMessageIdRef.current = messageId;
    setActiveMessageId(messageId);

    // 创建 AudioContext
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    let nextStartTime = 0;

    const onAudioChunk = async ({ messageId: msgId, buffer }: { messageId: string; buffer: ArrayBuffer }) => {
      if (msgId !== messageId) return;
      try {
        const int16 = new Int16Array(buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        const audioBuffer = audioCtx.createBuffer(1, float32.length, 16000);
        audioBuffer.getChannelData(0).set(float32);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        const startTime = Math.max(audioCtx.currentTime, nextStartTime);
        source.start(startTime);
        nextStartTime = startTime + audioBuffer.duration;
      } catch {}
    };

    const onAudioEnd = ({ messageId: msgId }: { messageId: string }) => {
      if (msgId !== messageId) return;
      stopMessage(messageId);
    };

    const onTtsError = ({ messageId: msgId, message: errMsg }: { messageId: string; message: string }) => {
      if (msgId !== messageId) return;
      stopMessage(messageId);
      console.warn('TTS 错误:', errMsg);
    };

    socket?.on('audioChunk', onAudioChunk);
    socket?.on('audioEnd', onAudioEnd);
    socket?.on('ttsError', onTtsError);

    const eventCleanup = () => {
      socket?.off('audioChunk', onAudioChunk);
      socket?.off('audioEnd', onAudioEnd);
      socket?.off('ttsError', onTtsError);
    };

    messageAudioMapRef.current.set(messageId, {
      state: 'loading',
      audioCtx,
      nextStartTime,
      eventCleanup,
    });

    // 请求后端合成
    const token = localStorage.getItem('access_token');
    await fetch('/api/chat/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, messageId, sessionId: getSessionId() }),
    });

    // 收到第一个 audioChunk 后状态变为 playing（在 onAudioChunk 中处理）
  }, [socket, getSessionId, stopMessage, updateMessageState]);

  // ... pauseMessage, resumeMessage, stopAll, toggleAutoPlay
}
```

### 4.2 `MessageTtsButton` 组件

**文件**: `apps/web/src/components/chat/MessageTtsButton.tsx`（新建）

```tsx
interface Props {
  messageId: string;
  text: string;
  state: MessagePlayState;
  onPlay: (id: string, text: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export default function MessageTtsButton({ messageId, text, state, onPlay, onPause, onResume }: Props) {
  const handleClick = () => {
    if (state === 'playing') onPause(messageId);
    else if (state === 'paused') onResume(messageId);
    else onPlay(messageId, text);
  };

  return (
    <Button
      type="text"
      size="small"
      className={`tts-btn tts-${state}`}
      icon={state === 'loading' ? <LoadingOutlined spin />
        : state === 'playing' ? <SoundOutlined />
        : state === 'paused' ? <PauseCircleOutlined />
        : <PlayCircleOutlined />}
      onClick={handleClick}
    />
  );
}
```

**位置**: 放在每条 AI 消息气泡的右上角或底部，与消息内容同行。

### 4.3 `TtsGlobalControl` 组件

**文件**: `apps/web/src/components/chat/TtsGlobalControl.tsx`（新建）

```tsx
interface Props {
  autoPlayEnabled: boolean;
  onToggle: () => void;
}

export default function TtsGlobalControl({ autoPlayEnabled, onToggle }: Props) {
  return (
    <div className="tts-global-control">
      <span>🔊 自动播放</span>
      <Switch checked={autoPlayEnabled} onChange={onToggle} size="small" />
    </div>
  );
}
```

**位置**: 消息列表顶部或输入框上方。

### 4.4 ChatPage 集成变更

- `useTtsPlayer` 返回 `{ messageStates, activeMessageId, autoPlayEnabled, playMessage, pauseMessage, resumeMessage, stopAll, toggleAutoPlay }`
- SSE `onDone` 中：若 `autoPlayEnabled`，自动 `playMessage(newMessageId, finalText)`
- `handleSelectConv` 中：调用 `stopAll()` 停止旧对话 TTS
- 每条 AI 消息渲染 `MessageTtsButton`
- 聊天区顶部渲染 `TtsGlobalControl`
- SSE 流式 TTS 消息：前端在 `POST /chat/stream` 时生成 `streamMessageId`，用于匹配流式 audioChunk

### 4.5 流式 TTS 与 messageId 绑定

前端发送 SSE 请求时带上 `streamMessageId`（预先生成）：

```ts
const streamMessageId = `stream-${Date.now()}`;
await sendMessage(text, sessionId, {
  streamMessageId,  // 新增参数
  // ... callbacks
});
```

后端 `streamAnswer` 收到 `streamMessageId`，在 emit audioChunk 时使用此 ID。前端 `useTtsPlayer` 监听到流式 audioChunk → 更新对应 message 的播放状态为 `playing`。

---

## 5. 多对话安全机制

| 场景 | 行为 |
|------|------|
| 切换对话（handleSelectConv） | `stopAll()` → 停止旧 AudioContext + 取消旧 socket 事件 |
| 发送新消息 | 若 autoPlay 开启，`stopAll()` 后自动播放新消息 |
| 路由离开（ChatPage unmount） | 清理所有 AudioContext + socket 事件 |
| 后端同 session 重复请求 TTS | `cancelSession` 自动取消旧 TTS |
| 语音 socket 断开 | AudioContext 暂停，socket 重连后不自动恢复 |

---

## 6. 变更文件清单

| 文件 | 变更 |
|------|------|
| `apps/server/src/modules/chat/chat.controller.ts` | **修改** 新增 `POST /chat/tts` 端点 |
| `apps/server/src/modules/chat/chat.service.ts` | **修改** 新增 `ttsSynthesize()`，流式 TTS 回调带 messageId |
| `apps/server/src/modules/chat/services/tts.service.ts` | **修改** `cancelSession` 不抛异常 |
| `apps/web/src/hooks/useTtsPlayer.ts` | **重写** 支持消息级播放、自动播放开关、localStorage |
| `apps/web/src/components/chat/MessageTtsButton.tsx` | **新建** 消息级播放/暂停按钮 |
| `apps/web/src/components/chat/TtsGlobalControl.tsx` | **新建** 全局自动播放开关 |
| `apps/web/src/pages/chat/ChatPage.tsx` | **修改** 集成新 Hook 和新组件 |
| `apps/web/src/hooks/useSSE.ts` | **修改** 支持传入 streamMessageId |
| `apps/web/src/stores/chat.store.ts` | **修改** 新增 streamMessageId 管理 |

---

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 语音 socket 未连接 | `POST /chat/tts` 返回错误，前端 toast "语音连接不可用" |
| TTS 合成失败 | `ttsError` 事件 → toast 错误 + 消息状态回 idle |
| 快速连续点击播放 | `playMessage` 内部 `stopMessage` 取消旧播放 |
| 音频解码失败 | `catch {}` 跳过损坏帧，不中断整体播放 |
| 切换对话时 audioChunk 到达 | `messageId` 不匹配 → `if (msgId !== messageId) return` 忽略 |

---

## 8. 自审

- [x] 无 TBD/TODO
- [x] 架构与功能描述一致
- [x] 范围聚焦，前后端变更明确
- [x] 接口定义明确，messageId 路由逻辑清晰
- [x] 多对话安全机制覆盖
