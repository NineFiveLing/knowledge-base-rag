# 腾讯云 TTS Provider 设计

**日期**: 2026-08-03  
**状态**: 设计确认

---

## 背景

当前 TTS 工厂仅支持 `aliyun`（阿里云 NLS 流式 TTS），无法切换到腾讯云。需实现 `TencentTtsProvider` 补充 `tencent` 分支，与 ASR 保持对称。

## 一、架构

```
TtsProvider (接口)
  ├─ AliNlsTtsProvider   ← 已实现（阿里云 NLS WebSocket）
  └─ TencentTtsProvider  ← 新增（腾讯云流式 TTS v2 WebSocket）
```

工厂 `createTtsProvider(config)` 根据 `DEFAULT_TTS_PROVIDER` 选择实现（`aliyun` | `tencent`）。

## 二、腾讯云 TTS 协议（v2）

- **端点**: `wss://tts.cloud.tencent.com/stream_wsv2`
- **Action**: `TextToStreamAudioWSv2`
- **鉴权**: HMAC-SHA1 签名（与 ASR 共用相同的 SecretId/SecretKey/AppId）
- **文本输入**: WebSocket 消息体 `ACTION_SYNTHESIS`（流式），非 URL 参数
- **音频输出**: 二进制 PCM 16kHz 16bit 单声道帧

### 交互流程

```
客户端                                    服务端
  |---------- WS 连接 + 签名参数 ----------->|
  |<--------- { code: 0 } 鉴权成功 ----------|
  |<--------- { ready: 1 } 可开始输入 -------|  → resolve TtsSession
  |                                         |
  |-- ACTION_SYNTHESIS { data: "文本" } ---->|
  |<--------- 二进制 PCM 音频帧 --------------|  → onAudioChunk × N
  |                                         |
  |-- ACTION_COMPLETE --------------------->|
  |<--------- { final: 1 } 合成完毕 ---------|  → onEnd → close
```

### 消息格式

**发送（JSON 文本帧）**：
```json
{
  "session_id": "...",
  "message_id": "...",
  "action": "ACTION_SYNTHESIS",
  "data": "需要合成的文本"
}
```

**接收音频（二进制帧）**：直接 `Buffer.from(event.data)` → `onAudioChunk`

**接收事件（JSON 文本帧）**：
- `{ code: 0, message: "success" }` — 鉴权成功
- `{ ready: 1 }` — 可以开始输入文本
- `{ heartbeat: 1 }` — 心跳（忽略）
- `{ final: 1 }` — 合成完毕
- `{ code: <非0>, message: "错误信息" }` — 错误 → `onError`

## 三、签名鉴权

与 `TencentAsrProvider.buildSignature()` 相同的 HMAC-SHA1 流程：

```
1. 参数按 key 字典序排序，& 拼接
2. signStr = "GET" + 域名(tts.cloud.tencent.com/stream_wsv2) + "?" + 参数串
3. signature = Base64(HmacSha1(signStr, SecretKey))
4. signature URL 编码后追加到 URL
```

**TTS 特有参数**：

| 参数 | 值 | 说明 |
|------|-----|------|
| Action | `TextToStreamAudioWSv2` | 固定 |
| AppId | 从配置读取 | 腾讯云 AppId |
| SecretId | 从配置读取 | 密钥 ID |
| Timestamp | 当前 UNIX 秒 | 签名时间 |
| Expired | Timestamp + 86400 | 24h 后过期 |
| SessionId | randomUUID | 会话标识 |
| Codec | `pcm` | 音频编码 |
| SampleRate | `16000` | 采样率 |
| VoiceType | `101001` | 音色（智瑜标准女声） |
| Speed | `0` | 语速（0=1.0倍） |
| Volume | `5` | 音量 |

## 四、TtsSession 接口映射

```typescript
interface TtsSession {
  feedText(text: string): void;  // → ACTION_SYNTHESIS（ready 前积压）
  end(): void;                   // → ACTION_COMPLETE，等 final 后 onEnd
  cancel(): void;                // → 直接 close WS，不触发 onEnd
}
```

- `feedText`: 收到 `ready=1` 后即时发送；未 ready 时积压到 `pendingText[]`
- `end`: 发送 `ACTION_COMPLETE`，服务端合成完缓存文本后回 `final=1`，触发 `onEnd()` 并关闭连接
- `cancel`: 立即关闭 WebSocket，不触发 `onEnd`（用于暂停场景）
- 连接超时 10s，超时或异常关闭 reject Promise

## 五、文件变更

| # | 文件 | 操作 |
|---|------|------|
| 1 | `apps/server/src/modules/chat/services/tts/tencent.provider.ts` | **新建** |
| 2 | `apps/server/src/modules/chat/services/tts/tts-provider.factory.ts` | **修改** — 新增 `case 'tencent'` |
| 3 | `.env.example` | **修改** — TTS 注释说明支持 aliyun/tencent |

## 六、不在范围

- 音色/语速/音量通过环境变量配置（当前硬编码默认值，后续可扩展）
- 前端改动
- ASR 改动
