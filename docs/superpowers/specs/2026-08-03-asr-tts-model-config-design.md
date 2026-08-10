# ASR/TTS 模型环境变量配置 + 音视频解析器实现

**日期**: 2026-08-03  
**状态**: 设计确认，待实施

---

## 背景

当前 ASR/TTS/OCR 模型名硬编码在代码中，无法灵活切换。音频和视频文档解析器为骨架代码。需改为环境变量配置，并实现音频/视频解析。

## 一、环境变量

```env
# ASR 语音识别模型（Chat 语音 + 文档解析共用）
ALIYUN_ASR_MODEL=fun-asr-mtl

# TTS 语音合成模型
ALIYUN_TTS_MODEL=cosyvoice-v1

# 图片 OCR 模型
ALIYUN_OCR_MODEL=qwen-vl-ocr
```

| 变量 | 用途 | 消费者 |
|------|------|--------|
| `ALIYUN_ASR_MODEL` | Chat 实时 ASR + 音频文档解析 | ali-dashscope.provider.ts, audio.parser.ts |
| `ALIYUN_TTS_MODEL` | Chat 语音合成输出 | tts.service.ts |
| `ALIYUN_OCR_MODEL` | 图片文字提取 | image.parser.ts |

## 二、改动范围

### 2.1 ASR 模型可配置

**asr-provider.factory.ts** — 从 ConfigService 读取 `ALIYUN_ASR_MODEL`，传给 Provider 构造函数。

**ali-dashscope.provider.ts** — 构造函数新增 `model` 参数，`start()` 中用 `this.model` 替代硬编码 `'paraformer-realtime-v2'`。

**tencent.provider.ts** — 同理新增 `model` 参数（腾讯云 ASR 模型配置）。

### 2.2 图片 OCR 模型

**image.parser.ts** — `config.get('ALIYUN_OCR_MODEL')` 默认值从 `qwen-vl-plus` 改为 `qwen-vl-ocr`。

### 2.3 音频文档解析器（重写）

**audio.parser.ts** — 当前骨架 → 真实实现：

调用 DashScope OpenAI 兼容音频转写 API：

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions
Authorization: Bearer {ALIYUN_API_KEY}
Content-Type: multipart/form-data
Body: file + model={ALIYUN_ASR_MODEL}
Response: { text: "..." }
```

流程：Buffer → 临时文件 → FormData POST → 拿到 text → 组装 Markdown

### 2.4 视频文档解析器（重写）

**video.parser.ts** — 当前骨架 → 真实实现：

ffmpeg 预处理管道：

```
视频文件
  ├─ ffmpeg 抽帧 (每分钟1帧, JPG) → ImageParser (OCR) ─┐
  └─ ffmpeg 抽音频 (16kHz mono WAV) → AudioParser (ASR) ─┤
                                                         └─→ 合并 Markdown
```

- 使用 `child_process.execFile('ffmpeg', [...])` ，系统已安装 ffmpeg
- 若 ffmpeg 不可用，降级输出提示信息

### 2.5 TTS 语音合成（重写）

**tts.service.ts** — 当前骨架 → 真实实现：

调用 DashScope OpenAI 兼容语音合成 API：

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech
Authorization: Bearer {ALIYUN_API_KEY}
Body: { model: "{ALIYUN_TTS_MODEL}", input: "文字", voice: "zh-CN-Xiaoxiao",
       response_format: "mp3" }
→ audio/mpeg binary
```

`synthesizeStream` 实现：
1. 按标点符号断句（`。！？；\n`）
2. 逐句 POST 到 TTS API，拿到 MP3 Buffer
3. 通过 AsyncGenerator 逐块 yield Buffer
4. 单句失败不中断流程，跳过继续

VoiceGateway 消费不变：`for await (const audioChunk of this.ttsService.synthesizeStream(text))` → `client.emit('audioChunk', audioChunk)`

## 三、文件清单

| # | 文件 | 操作 |
|---|------|------|
| 1 | `asr-provider.factory.ts` | 修改 — 读取 ALIYUN_ASR_MODEL 传给 Provider |
| 2 | `ali-dashscope.provider.ts` | 修改 — 构造函数 +model，替换硬编码 |
| 3 | `tencent.provider.ts` | 修改 — 同理 +model |
| 4 | `image.parser.ts` | 修改 — 默认值改为 qwen-vl-ocr |
| 5 | `audio.parser.ts` | 重写 — DashScope REST API 文件转写 |
| 6 | `video.parser.ts` | 重写 — ffmpeg + OCR + ASR |
| 7 | `tts.service.ts` | 重写 — DashScope REST API 语音合成 |

## 四、不在范围

- ffmpeg 安装（系统已安装）
- 前端改动
