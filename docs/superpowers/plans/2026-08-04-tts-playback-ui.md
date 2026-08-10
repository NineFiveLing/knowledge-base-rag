# TTS 消息级播放控制 UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每条 AI 消息提供独立的 TTS 播放/暂停控制，支持全局自动播放开关（持久化 localStorage），实现多对话音频隔离。

**Architecture:** 重写 `useTtsPlayer` Hook 支持 per-message 状态管理 + messageId 路由，后端新增 `POST /chat/tts` 端点支持历史消息回放，前端新增 `MessageTtsButton` 和 `TtsGlobalControl` 组件。

**Tech Stack:** React 19 + TypeScript + Socket.IO client + Ant Design + NestJS + Tencent Cloud TTS

---

## Global Constraints

- 每条 AI 消息独立播放/暂停控制，同时只有一条消息在播放
- 最新消息自动播放，全局开关可关闭，偏好存 localStorage（key: `tts-auto-play`）
- 切换对话时 `stopAll()` 停止旧对话所有音频
- 后端同一 sessionId 同时只有一个活跃 TTS 会话，新请求自动取消旧会话
- 所有 audioChunk/audioEnd/ttsError 携带 `messageId` 用于前端路由
- `TtsService.cancelSession` 内部吞异常（不抛给调用方）
- 前端不展示调试信息（promptContext），仅后端日志输出

---

### Task 1: 后端 `POST /chat/tts` 端点 + `TtsService.cancelSession` 安全化

**Files:**
- Modify: `apps/server/src/modules/chat/chat.controller.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/server/src/modules/chat/services/tts.service.ts`

**Interfaces:**
- Consumes: `VoiceGateway.getVoiceSocket(sessionId)` (existing)
- Produces: `POST /chat/tts` endpoint — `ChatService.ttsSynthesize(text, messageId, sessionId): Promise<void>`
- Modifies: `TtsService.cancelSession(sessionId)` — 内部 catch, never throws

- [ ] **Step 1: 修改 `TtsService.cancelSession` 不抛异常**

编辑 `apps/server/src/modules/chat/services/tts.service.ts`，将 `cancelSession` 方法改为内部 try-catch：

```typescript
cancelSession(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;
  try {
    session.cancel();
  } catch {} // 忽略取消时的错误
  this.sessions.delete(sessionId);
  this.logger.log(`TTS 会话取消: ${sessionId}`);
}
```

- [ ] **Step 2: 在 `ChatService` 中新增 `ttsSynthesize` 方法**

编辑 `apps/server/src/modules/chat/chat.service.ts`，新增方法：

```typescript
async ttsSynthesize(text: string, messageId: string, sessionId: string): Promise<void> {
  // 取消同 session 的旧 TTS
  this.tts.cancelSession(sessionId);

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

- [ ] **Step 3: 在 Controller 中新增 `POST /chat/tts` 端点**

编辑 `apps/server/src/modules/chat/chat.controller.ts`，新增路由：

```typescript
@Post('tts')
@UseGuards(JwtAuthGuard)
async synthesizeTts(
  @Body() dto: { text: string; messageId: string; sessionId: string },
  @CurrentUser() user: { id: string },
) {
  await this.chatService.ttsSynthesize(dto.text, dto.messageId, dto.sessionId);
  return { success: true };
}
```

- [ ] **Step 4: 流式 TTS 回调改为带 messageId 的 payload**

编辑 `apps/server/src/modules/chat/chat.service.ts`，修改 `startTtsStream` 和 `streamAnswer` 中的 TTS 回调，使 emit 携带 `messageId`。

在 `streamAnswer` 中流式开始时生成 `sseMessageId`，传给 `startTtsStream`：

```typescript
// streamAnswer 中，TT 流式输出部分的 TTS 启动处（约行 161），传入 streamMessageId
const streamMessageId = `stream-${Date.now()}-${randomUUID().slice(0, 8)}`;
// ...
this.startTtsStream(sessionId, textBuffer, streamMessageId).then(() => {
```

修改 `startTtsStream` 签名和回调：

```typescript
private async startTtsStream(sessionId: string, initialText: string, messageId: string) {
  try {
    this.logger.log(`🔊 TTS 开始连接: session=${sessionId} msgId=${messageId}`);
    await this.tts.startSession(sessionId, {
      onAudioChunk: (buffer: Buffer) => {
        const socket = this.voiceGateway.getVoiceSocket(sessionId);
        if (socket?.connected) {
          socket.emit('audioChunk', { messageId, buffer });
        }
      },
      onEnd: () => {
        this.logger.log(`🔊 TTS 合成完成: session=${sessionId}`);
        const socket = this.voiceGateway.getVoiceSocket(sessionId);
        if (socket?.connected) {
          socket.emit('audioEnd', { messageId });
        }
      },
      onError: (err: Error) => {
        this.logger.error(`TTS 错误 [${sessionId}]: ${err.message}`);
        const socket = this.voiceGateway.getVoiceSocket(sessionId);
        if (socket?.connected) {
          socket.emit('ttsError', { messageId, message: err.message });
        }
      },
    });
    this.logger.log(`🔊 TTS 已就绪: session=${sessionId} initialText="${initialText.slice(0, 30)}"`);
    this.tts.feedText(sessionId, initialText);
  } catch (err) {
    this.logger.error(`TTS 启动失败 [${sessionId}]: ${(err as Error).message}`);
  }
}
```

同时在 `streamAnswer` 结束时的 `endSession` 调用处确认所有 emit 使用 messageId payload 格式。

- [ ] **Step 5: 编译验证并 commit**

```bash
cd apps/server && npx nest build
git add apps/server/src/modules/chat/chat.controller.ts apps/server/src/modules/chat/chat.service.ts apps/server/src/modules/chat/services/tts.service.ts
git commit -m "feat: 新增 POST /chat/tts 端点支持消息级TTS回放，cancelSession安全化，流式TTS回调带messageId"
```

---

### Task 2: 重写 `useTtsPlayer` Hook 支持 per-message 播放 + 自动播放 localStorage

**Files:**
- Modify: `apps/web/src/hooks/useTtsPlayer.ts`

**Interfaces:**
- Produces: `useTtsPlayer(socket: Socket | null, getSessionId: () => string)` → returns `{ messageStates: Record<string, MessagePlayState>, activeMessageId: string | null, autoPlayEnabled: boolean, playMessage: (id, text) => void, pauseMessage: (id) => void, resumeMessage: (id) => void, stopAll: () => void, toggleAutoPlay: () => void }`
- Consumes: Socket.IO events `audioChunk` / `audioEnd` / `ttsError` — 新 payload 格式 `{ messageId: string, buffer?: ArrayBuffer, message?: string }`
- HTTP: `POST /api/chat/tts` — `{ text, messageId, sessionId }`

- [ ] **Step 1: 写入新 Hook 完整实现**

替换 `apps/web/src/hooks/useTtsPlayer.ts` 的全部内容：

```typescript
import { useState, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';

export type MessagePlayState = 'idle' | 'loading' | 'playing' | 'paused';

interface MessageAudioState {
  state: MessagePlayState;
  audioCtx: AudioContext;
  nextStartTime: number;
  eventCleanup: () => void;
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
    if (info) {
      info.eventCleanup();
      info.audioCtx.close().catch(() => {});
      messageAudioMapRef.current.delete(messageId);
    }
    if (activeMessageIdRef.current === messageId) {
      activeMessageIdRef.current = null;
      setActiveMessageId(null);
    }
    updateMessageState(messageId, 'idle');
  }, [updateMessageState]);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    if (!socket?.connected) return;
    if (!text) return;

    // 停止当前活跃的消息
    if (activeMessageIdRef.current && activeMessageIdRef.current !== messageId) {
      stopMessage(activeMessageIdRef.current);
    }

    updateMessageState(messageId, 'loading');
    activeMessageIdRef.current = messageId;
    setActiveMessageId(messageId);

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    let nextStartTime = 0;

    const onAudioChunk = async (payload: { messageId: string; buffer: ArrayBuffer }) => {
      if (payload.messageId !== messageId) return;
      updateMessageState(messageId, 'playing');
      try {
        const int16 = new Int16Array(payload.buffer);
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
      } catch { /* 解码失败跳过 */ }
    };

    const onAudioEnd = (payload: { messageId: string }) => {
      if (payload.messageId !== messageId) return;
      stopMessage(messageId);
    };

    const onTtsError = (payload: { messageId: string; message: string }) => {
      if (payload.messageId !== messageId) return;
      stopMessage(messageId);
      console.warn('TTS 错误:', payload.message);
    };

    socket.on('audioChunk', onAudioChunk);
    socket.on('audioEnd', onAudioEnd);
    socket.on('ttsError', onTtsError);

    const eventCleanup = () => {
      socket.off('audioChunk', onAudioChunk);
      socket.off('audioEnd', onAudioEnd);
      socket.off('ttsError', onTtsError);
    };

    messageAudioMapRef.current.set(messageId, {
      state: 'loading',
      audioCtx,
      nextStartTime,
      eventCleanup,
    });

    // 请求后端合成
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, messageId, sessionId: getSessionId() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'TTS 请求失败' }));
        socket.emit('ttsError', { messageId, message: err.message || 'TTS 请求失败' });
      }
    } catch (err) {
      stopMessage(messageId);
      console.warn('TTS 请求失败:', (err as Error).message);
    }
  }, [socket, getSessionId, stopMessage, updateMessageState]);

  const pauseMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info || info.state !== 'playing') return;
    info.audioCtx.suspend().then(() => {
      updateMessageState(messageId, 'paused');
    }).catch(() => {});
  }, [updateMessageState]);

  const resumeMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info || info.state !== 'paused') return;
    info.audioCtx.resume().then(() => {
      updateMessageState(messageId, 'playing');
    }).catch(() => {});
  }, [updateMessageState]);

  const stopAll = useCallback(() => {
    const ids = Array.from(messageAudioMapRef.current.keys());
    ids.forEach(id => stopMessage(id));
    messageAudioMapRef.current.clear();
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
  }, [stopMessage]);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled(prev => {
      const next = !prev;
      localStorage.setItem('tts-auto-play', String(next));
      return next;
    });
  }, []);

  return {
    messageStates,
    activeMessageId,
    autoPlayEnabled,
    playMessage,
    pauseMessage,
    resumeMessage,
    stopAll,
    toggleAutoPlay,
  };
}
```

- [ ] **Step 2: 编译验证并 commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/hooks/useTtsPlayer.ts
git commit -m "feat: 重写 useTtsPlayer 支持 per-message 播放控制、localStorage 自动播放偏好"
```

---

### Task 3: `MessageTtsButton` + `TtsGlobalControl` 组件

**Files:**
- Create: `apps/web/src/components/chat/MessageTtsButton.tsx`
- Create: `apps/web/src/components/chat/TtsGlobalControl.tsx`

**Interfaces:**
- Consumes: `useTtsPlayer` return values
- `MessageTtsButton`: Props `{ messageId, text, state: MessagePlayState, onPlay, onPause, onResume }`
- `TtsGlobalControl`: Props `{ autoPlayEnabled, onToggle }`

- [ ] **Step 1: 创建 `MessageTtsButton` 组件**

新建 `apps/web/src/components/chat/MessageTtsButton.tsx`：

```tsx
import { Button } from 'antd';
import { SoundOutlined, PauseCircleOutlined, PlayCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import type { MessagePlayState } from '../../hooks/useTtsPlayer';

interface Props {
  messageId: string;
  text: string;
  state: MessagePlayState;
  onPlay: (messageId: string, text: string) => void;
  onPause: (messageId: string) => void;
  onResume: (messageId: string) => void;
}

export default function MessageTtsButton({ messageId, text, state, onPlay, onPause, onResume }: Props) {
  const handleClick = () => {
    if (state === 'playing') onPause(messageId);
    else if (state === 'paused') onResume(messageId);
    else onPlay(messageId, text);
  };

  const icon =
    state === 'loading' ? <LoadingOutlined spin /> :
    state === 'playing' ? <SoundOutlined /> :
    state === 'paused' ? <PauseCircleOutlined /> :
    <PlayCircleOutlined />;

  const title =
    state === 'loading' ? '语音加载中…' :
    state === 'playing' ? '暂停播放' :
    state === 'paused' ? '继续播放' :
    '播放语音';

  return (
    <Button
      type="text"
      size="small"
      className={`tts-btn tts-${state}`}
      icon={icon}
      title={title}
      onClick={handleClick}
      disabled={state === 'loading'}
    />
  );
}
```

- [ ] **Step 2: 创建 `TtsGlobalControl` 组件**

新建 `apps/web/src/components/chat/TtsGlobalControl.tsx`：

```tsx
import { Switch, Space } from 'antd';
import { SoundOutlined } from '@ant-design/icons';

interface Props {
  autoPlayEnabled: boolean;
  onToggle: () => void;
}

export default function TtsGlobalControl({ autoPlayEnabled, onToggle }: Props) {
  return (
    <Space className="tts-global-control" size="small">
      <SoundOutlined />
      <span style={{ fontSize: 13, color: '#666' }}>自动播放</span>
      <Switch checked={autoPlayEnabled} onChange={onToggle} size="small" />
    </Space>
  );
}
```

- [ ] **Step 3: 编译验证并 commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/components/chat/MessageTtsButton.tsx apps/web/src/components/chat/TtsGlobalControl.tsx
git commit -m "feat: 新增 MessageTtsButton 和 TtsGlobalControl 组件"
```

---

### Task 4: ChatPage 集成 —— Hook 替换 + 组件插入 + 流式 TTS 绑定

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`

**Interfaces:**
- Consumes: `useTtsPlayer` (new version), `MessageTtsButton`, `TtsGlobalControl`
- Changes: 替换旧的 `useTtsPlayer` 调用，插入按钮/开关 UI，`handleSelectConv` 中调用 `stopAll()`，SSE `onDone` 中自动播放新消息

- [ ] **Step 1: 替换 `useTtsPlayer` 导入和调用**

编辑 `apps/web/src/pages/chat/ChatPage.tsx` 顶部导入：

```typescript
// 旧导入
import { useTtsPlayer } from '../../hooks/useTtsPlayer';
// 新导入
import { useTtsPlayer, type MessagePlayState } from '../../hooks/useTtsPlayer';
import MessageTtsButton from '../../components/chat/MessageTtsButton';
import TtsGlobalControl from '../../components/chat/TtsGlobalControl';
```

替换 Hook 调用（约行 38）：

```typescript
// 旧：const { startPlayer, stopPlayer } = useTtsPlayer(voiceSocket);
// 新：
const { messageStates, activeMessageId, autoPlayEnabled, playMessage, pauseMessage, resumeMessage, stopAll, toggleAutoPlay } = useTtsPlayer(voiceSocket, () => sessionId);
```

- [ ] **Step 2: 替换 voice socket 生命周期管理**

编辑约行 137-149，连接 voice socket 后不再启动旧版 TTS player：

```typescript
useEffect(() => {
  const socket = connect(sessionId);
  return () => {
    stopAll();
    socket?.disconnect();
  };
}, []); // eslint-disable-line

// 删除旧的 useEffect(() => { if (voiceSocket) startPlayer(); }, [voiceSocket, startPlayer]);
```

- [ ] **Step 3: `handleSelectConv` 中调用 `stopAll()`**

在 `handleSelectConv` 函数开头（`if (convId === activeConvRef.current) return;` 之后）添加：

```typescript
// 停止旧对话的所有 TTS 音频播放
stopAll();
```

- [ ] **Step 4: SSE `onDone` 中自动播放新消息**

在 `onDone` 回调中，当消息成功持久化且 `autoPlayEnabled` 为 true 时自动播放：

```typescript
// onDone 回调末尾，chatStore.convLiveMap.delete(key) 之后，if (isForeground() && chatDispatch) 之后
if (autoPlayEnabled && finalText) {
  // 注意：此时 assistant 消息尚未加入 messages 数组（在 chatDispatch.setMessages 中才加入）
  // 因此需要在 setMessages 执行后调用 playMessage，用 setTimeout 延迟到下个 tick
  setTimeout(() => {
    playMessage(`${key}-last`, finalText);
  }, 100);
}
```

但是这里有个问题：`autoPlayEnabled` 在 `handleSend` 的闭包中。由于 `handleSend` 的依赖只有 `[sendMessage, sessionId]`，`autoPlayEnabled` 不会被更新。需要使用 ref 读取最新值。在 `handleSend` 外部创建 ref：

```typescript
const autoPlayRef = useRef(autoPlayEnabled);
autoPlayRef.current = autoPlayEnabled;
```

然后在 `onDone` 中使用 `autoPlayRef.current`：

```typescript
if (autoPlayRef.current && finalText) {
  const msgId = `${key}-assistant-${Date.now()}`;
  setTimeout(() => playMessage(msgId, finalText), 100);
}
```

- [ ] **Step 5: 在消息气泡旁插入 `MessageTtsButton`**

在消息列表渲染部分（消息气泡内），为每条 AI 消息添加播放按钮。找到消息渲染的 `.chat-bubble-wrapper` 区域（约行 389-404），在 AI 消息的文字下方添加：

```tsx
{m.role === 'assistant' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
    <MessageTtsButton
      messageId={`${activeConvId}-msg-${i}`}
      text={m.content}
      state={messageStates[`${activeConvId}-msg-${i}`] || 'idle'}
      onPlay={playMessage}
      onPause={pauseMessage}
      onResume={resumeMessage}
    />
  </div>
)}
```

流式区域（`displayStreaming` 行 418-437）也添加按钮（流式期间可能还未收到完整文本，按钮仅展示 loading 状态）：

```tsx
{displayStreaming && (
  <div className="chat-message-tts">
    <MessageTtsButton
      messageId={`${activeConvId}-streaming`}
      text={displayStreaming}
      state={messageStates[`${activeConvId}-streaming`] || 'idle'}
      onPlay={playMessage}
      onPause={pauseMessage}
      onResume={resumeMessage}
    />
  </div>
)}
```

- [ ] **Step 6: 在聊天区顶部插入 `TtsGlobalControl`**

在 `.chat-messages` 开头（空状态提示之前）添加全局控制：

```tsx
<TtsGlobalControl autoPlayEnabled={autoPlayEnabled} onToggle={toggleAutoPlay} />
```

放在 `.chat-messages` div 内部顶部，紧接在 `{loadingHistory && ...}` 之后。

- [ ] **Step 7: 编译验证并 commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/chat/ChatPage.tsx
git commit -m "feat: ChatPage 集成 per-message TTS 控制、全局自动播放开关、stopAll"
```

---

### Task 5: 流式 SSE TTS 的 messageId 绑定 + chatStore 流式 ID 管理

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`
- Modify: `apps/web/src/stores/chat.store.ts`

**Interfaces:**
- Produces: `chatStore.setStreamMessageId(convId, messageId)` / `chatStore.getStreamMessageId(convId)`
- Consumes: `streamAnswer` 中 emit 的 `{ messageId }` payload

- [ ] **Step 1: chatStore 新增流式 messageId 管理**

编辑 `apps/web/src/stores/chat.store.ts`，在 `ChatStore` 类中新增：

```typescript
/** 每对话的流式 TTS messageId 映射（用于前后台切换时匹配音频） */
streamMessageIdMap = new Map<string, string>();

setStreamMessageId(convId: string, messageId: string) {
  this.streamMessageIdMap.set(convId, messageId);
}

getStreamMessageId(convId: string): string | undefined {
  return this.streamMessageIdMap.get(convId);
}
```

- [ ] **Step 2: `handleSend` 中生成长流式 messageId 并写入 chatStore**

在 `handleSend` 中，`sseConvId` 确定后生成流式 messageId：

```typescript
const streamMsgId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
if (sseConvId) {
  chatStore.setStreamMessageId(sseConvId, streamMsgId);
} else {
  // 新对话：onConversation 回调中再绑定
  // 将 streamMsgId 暂存到临时变量，onConversation 时 setStreamMessageId
}
```

等一下，由于 SSE 后端 `streamAnswer` 生成 `streamMessageId`，但前端也需要知道这个 ID 以匹配 audioChunk。设计文档 §3.2 和 §4.5 说前端在 `POST /chat/stream` 时生成 `streamMessageId` 作为请求参数传入后端。需要修改 `POST /chat/stream` 传参。

先看看 ChatDto 是否需要新增字段。按 spec 要求：前端发 SSE 请求时带上 `streamMessageId`。需要：

1. `ChatDto` 新增 `streamMessageId?: string`
2. 前端 `sendMessage` 传入 `streamMessageId`
3. 后端 `streamAnswer` 接收 `streamMessageId` 用于 TTS emit

但这样会增加耦合。更简单的方案：后端生成 `streamMessageId`，通过 SSE 的 `conversation` 事件或第一个 `text` 事件传给前端。但实际上后端已经生成了 `streamMessageId` —— 在上一个 task (Task 1 Step 4) 中。

让我重新考虑：最简单的方案是前端生成，因为前端需要知道这个 ID 来匹配按钮和 audioChunk。按 spec §4.5：

```ts
const streamMessageId = `stream-${Date.now()}`;
await sendMessage(text, sessionId, {
  streamMessageId,
  ...
});
```

所以：
- ChatDto 加 `streamMessageId?: string`
- useSSE 的 `sendMessage` 签名加 `streamMessageId?: string`
- 后端 `streamAnswer` 用前端传来的 `streamMessageId`

修改 `ChatDto`：
```typescript
@IsOptional()
@IsString()
streamMessageId?: string;
```

修改后端 controller 传递 `dto.streamMessageId` 给 `streamAnswer`。

修改 `streamAnswer` 签名加 `streamMessageId?: string` 参数。

- [ ] **Step 1 修订: 修改 ChatDto + Controller + Service + useSSE + ChatPage**

**ChatDto** (`apps/server/src/modules/chat/dto/chat.dto.ts`)：

```typescript
@IsOptional()
@IsString()
streamMessageId?: string;
```

**Controller** 传参：

```typescript
const stream = this.chatService.streamAnswer(
  dto.message, user.id, sessionId, dto.conversationId, dto.streamMessageId
);
```

**`streamAnswer` 签名** 改为：

```typescript
async *streamAnswer(
  message: string, userId: string, sessionId: string,
  conversationId?: string, streamMessageId?: string
)
```

在 `startTtsStream` 调用处使用 `streamMessageId || `stream-${Date.now()}`` 作为 fallback：

```typescript
const actualStreamMsgId = streamMessageId || `stream-${Date.now()}`;
// ...
this.startTtsStream(sessionId, textBuffer, actualStreamMsgId).then(() => {
```

**`useSSE`** (`apps/web/src/hooks/useSSE.ts`) 的 `sendMessage` 签名新增 `streamMessageId?: string`：

```typescript
async (
  message: string,
  sessionId: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onSources?: ...,
  conversationId?: string | null,
  onConversation?: ...,
  onPromptContext?: ...,
  streamMessageId?: string,  // 新增
) => {
  const body: any = { message, sessionId };
  if (conversationId) body.conversationId = conversationId;
  if (streamMessageId) body.streamMessageId = streamMessageId;  // 新增
```

**ChatPage** `handleSend` 中生成长 `streamMessageId` 并传入：

```typescript
const streamMsgId = `stream-${Date.now()}`;
chatStore.setStreamMessageId(sseConvId || '__new__', streamMsgId);
```

`sendMessage` 调用末尾加入 `streamMsgId` 参数。

- [ ] **Step 2: 编译验证并 commit**

```bash
cd apps/server && npx nest build && cd ../web && npx tsc --noEmit
git add apps/server/src/modules/chat/dto/chat.dto.ts apps/server/src/modules/chat/chat.controller.ts apps/server/src/modules/chat/chat.service.ts apps/web/src/hooks/useSSE.ts apps/web/src/pages/chat/ChatPage.tsx apps/web/src/stores/chat.store.ts
git commit -m "feat: SSE流式TTS挂载streamMessageId，前后端全链路messageId路由"
```

---

### Task 6: 端到端验证

**Files:** 无新建，手动验证

- [ ] **Step 1: 启动后端**

```bash
cd apps/server && npm run start:dev
```

确认日志无编译错误，`POST /chat/tts` 路由已注册。

- [ ] **Step 2: 启动前端**

```bash
cd apps/web && npm run dev
```

- [ ] **Step 3: 验证场景清单**

| # | 场景 | 预期 |
|---|------|------|
| 1 | 发送消息 → AI 回复 | 自动播放按钮出现在 AI 消息旁，状态为 `playing` |
| 2 | 点击播放按钮 | 停止当前消息 → 开始播放新消息（loading → playing） |
| 3 | 点击暂停 | 状态变为 `paused`，音频暂停 |
| 4 | 点击恢复 | 状态变为 `playing`，音频继续 |
| 5 | 关闭自动播放开关 | 新消息不自动播放，按钮状态 `idle` |
| 6 | 刷新页面 | 自动播放开关状态记忆（localStorage） |
| 7 | 切换对话 | 旧对话音频停止，按钮恢复 `idle` |
| 8 | 对话 A 播放中切换到对话 B | 对话 A 的音频停止，对话 B 无残留播放 |
| 9 | 快速连续点击两条消息的播放 | 只有最后一条播放，前一条自动停止 |
| 10 | 流式输出期间查看播放按钮 | 流式区域显示按钮（含 loading 状态），流式结束后可手动播放 |
| 11 | 声音 socket 断开 | `POST /chat/tts` 返回错误 "语音连接不可用" |

---

## 变更文件清单

| 文件 | 变更类型 | Task |
|------|---------|------|
| `apps/server/src/modules/chat/chat.controller.ts` | 修改 | 1 |
| `apps/server/src/modules/chat/chat.service.ts` | 修改 | 1, 5 |
| `apps/server/src/modules/chat/services/tts.service.ts` | 修改 | 1 |
| `apps/server/src/modules/chat/dto/chat.dto.ts` | 修改 | 5 |
| `apps/web/src/hooks/useTtsPlayer.ts` | 重写 | 2 |
| `apps/web/src/components/chat/MessageTtsButton.tsx` | 新建 | 3 |
| `apps/web/src/components/chat/TtsGlobalControl.tsx` | 新建 | 3 |
| `apps/web/src/pages/chat/ChatPage.tsx` | 修改 | 4, 5 |
| `apps/web/src/hooks/useSSE.ts` | 修改 | 5 |
| `apps/web/src/stores/chat.store.ts` | 修改 | 5 |
