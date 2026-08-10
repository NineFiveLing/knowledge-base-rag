# TTS 流式语音输出 & 暂停播放 设计文档

**日期**: 2026-08-03
**状态**: 待评审

---

## 1. 背景与目标

当前 TTS 基于百炼 CosyVoice HTTP 逐句合成，不支持真流式，且语音输出与 AI 文字回答是串行的（等文字全部输出后才触发 TTS）。需要实现：

- AI SSE 流式输出文字的同时，WebSocket 并行流式输出语音
- 延迟启动（积累 3-5 字后开始 TTS）
- 暂停/恢复播放，暂停时服务端停止 TTS 合成避免浪费

---

## 2. TTS 选型

| 维度 | 百炼 CosyVoice (当前) | 智能语音交互 流式 TTS (目标) |
|------|----------------------|--------------------------|
| 协议 | HTTP 逐句请求 | WebSocket 双向流 |
| 流式 | ❌ 整句合成后才返回 | ✅ 逐字合成逐 chunk 下发 |
| 首音延迟 | 500ms-2s/句 | ~200ms |
| 音色 | CosyVoice 更自然 | 20+ 预置音色 |
| 凭证 | 复用 ALIYUN_API_KEY | 需独立 AccessKey + AppKey |

**决定**: TTS 切到阿里云智能语音交互 WebSocket 流式接口。ASR 保持百炼 Paraformer 不变。

**新增环境变量**:
```
ALIYUN_NLS_ACCESS_KEY_ID=xxx
ALIYUN_NLS_ACCESS_KEY_SECRET=xxx
ALIYUN_NLS_APP_KEY=xxx
```

---

## 3. 架构设计

### 3.1 方案：服务端编排

服务端内部桥接 SSE → TTS → `/voice` WebSocket 音频下发。前端只加播放器。

### 3.2 数据流

```
POST /chat/stream (SSE)
       │
       ├── SSE: { type: "text", content: "报销" }
       ├── SSE: { type: "text", content: "流程" }
       ├── SSE: { type: "text", content: "如下" }   ← 积累≥5字，触发 TTS
       │         │
       │         └── TTS WebSocket (流式合成) ──→ /voice: audioChunk ──→ 前端播放
       ├── SSE: { type: "text", content: "：" }
       │         │
       │         └── 继续 feed TTS ──→ /voice: audioChunk
       ├── SSE: { type: "text", content: "第一步" }
       │         ...
       ├── SSE: { type: "sources", sources: [...] }
       └── SSE: [DONE]
                  │
                  └── finish TTS ──→ /voice: audioEnd
```

### 3.3 延迟启动

- 累积文字缓冲区，初始阈值 **5 个字符**
- 达到阈值 → 建立 TTS WebSocket → 发送缓冲文字 → 开始流式下发音频
- 之后每收到 SSE text token 立即 feed TTS，不再缓冲

### 3.4 并行输出

- SSE text → 前端渲染（不变）
- TTS audioChunk → 前端 `<audio>` 或 AudioContext 播放
- 两路独立、同时进行

---

## 4. 暂停/恢复

### 4.1 协议

| 方向 | 事件 | payload | 说明 |
|------|------|---------|------|
| 前端→服务端 | `pauseTts` | `{ sessionId }` | 请求暂停 |
| 服务端→前端 | `ttsPaused` | `{ position }` | 确认暂停，返回已合成字符位置 |
| 前端→服务端 | `resumeTts` | `{ sessionId, position }` | 从断点恢复 |
| 服务端→前端 | `ttsResumed` | `{}` | 恢复确认，后续继续 audioChunk |

### 4.2 服务端行为

**暂停**:
1. 关闭当前 TTS WebSocket 连接
2. 记录 `pausedPosition` = 已 feed TTS 的字符数
3. 丢弃 TTS 连接关闭前未发出的音频缓冲

**恢复**:
1. 从 `pausedPosition` 后的文字位置重建 TTS WebSocket
2. 重新 feed 断点后的文本
3. 继续流式下发 audioChunk

### 4.3 前端行为

**暂停**:
1. 停止 AudioContext 播放
2. 记录当前播放时间偏移
3. 发送 `pauseTts`

**恢复**:
1. 发送 `resumeTts`
2. 收到 `ttsResumed` → 重新开始接收 audioChunk → 播放

---

## 5. 接口设计

### 5.1 TTS Provider 接口

```ts
// tts-provider.interface.ts
interface TtsCallbacks {
  onAudioChunk: (buffer: Buffer) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
}

interface TtsSession {
  feedText(text: string): void;
  end(): Promise<void>;
  cancel(): void;  // 暂停时快速取消
}

interface TtsProvider {
  start(callbacks: TtsCallbacks): Promise<TtsSession>;
}
```

### 5.2 WebSocket 事件（`/voice` 命名空间新增）

**客户端→服务端**:
- `pauseTts` — 暂停 TTS 合成
- `resumeTts` — 恢复 TTS 合成

**服务端→客户端**:
- `audioChunk` — Buffer，TTS 音频分片（已有，保留）
- `audioEnd` — TTS 合成完成（已有，保留）
- `ttsPaused` — 已暂停确认
- `ttsResumed` — 已恢复确认
- `ttsError` — TTS 错误

### 5.3 ChatService 集成点

`ChatService.streamAnswer()` 内，SSE 流循环中：

```ts
// 伪代码
const ttsSession = await ttsProvider.start({ onAudioChunk, onEnd, onError });
let textBuffer = '';
let ttsStarted = false;
const DELAY_CHARS = 5;

for await (const event of sseStream) {
  // 原有 SSE text yield
  if (event.type === 'text') {
    yield event;

    textBuffer += event.content;

    if (!ttsStarted && textBuffer.length >= DELAY_CHARS) {
      ttsStarted = true;
      ttsSession.feedText(textBuffer); // 发送缓冲
    } else if (ttsStarted) {
      ttsSession.feedText(event.content); // 逐 token feed
    }
  }
}
ttsSession.end(); // SSE 结束
```

---

## 6. 前端变更

### 6.1 新增 `useTtsPlayer` Hook

```ts
function useTtsPlayer(socket: Socket) {
  // 状态：idle | playing | paused
  // 方法：play(), pause(), resume()
  // 内部：AudioContext 播放队列，收到 audioChunk → 入队 → 调度播放
}
```

### 6.2 UI 组件

- 语音回答旁新增播放/暂停按钮
- 播放时显示音频波形或进度指示

---

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| TTS WebSocket 连接失败 | `/voice` 发 `ttsError`，前端显示"语音不可用"，文字正常输出 |
| TTS 合成中途异常 | 丢弃该段音频，文字不受影响 |
| 暂停后长时间不恢复（>5min） | 服务端超时清理 TTS 断点，恢复时从头开始 |
| 网络断开 | Socket.IO 自动重连，重连后状态重置为 idle |

---

## 8. 变更范围

| 文件 | 变更 |
|------|------|
| `services/tts-provider.interface.ts` | **新增** TTS Provider 接口 |
| `services/tts/ali-nls.provider.ts` | **新增** 阿里云 NLS 流式 TTS Provider |
| `services/tts-provider.factory.ts` | **新增** TTS Provider 工厂 |
| `services/tts.service.ts` | **重写** 从 CosyVoice HTTP 改为 Provider 模式 |
| `voice.gateway.ts` | **修改** 新增 pauseTts/resumeTts 事件 + TTS 流式下行 |
| `chat.service.ts` | **修改** 集成 TTS 并行流式输出 |
| `chat.module.ts` | **修改** 注册新 Provider |
| `hooks/useTtsPlayer.ts` | **新增** 前端 TTS 播放 Hook |
| `.env.example` | **修改** 新增 NLS 环境变量 |

---

## 9. 自审

- [x] 无 TBD/TODO
- [x] 架构与功能描述一致
- [x] 范围聚焦，可单次实现
- [x] 接口定义明确无歧义
