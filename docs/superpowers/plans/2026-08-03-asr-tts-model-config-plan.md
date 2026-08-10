# ASR/TTS 模型配置 + 音视频解析器 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ASR/TTS/OCR 模型改为环境变量可配置，音频/视频文档解析器从骨架改为真实实现，TTS 语音合成从骨架改为 DashScope API 调用。

**Architecture:** ASR Provider 构造函数增加 `model` 参数由 factory 从 ConfigService 注入；AudioParser 调用 DashScope `/audio/transcriptions` REST API；VideoParser 使用 ffmpeg 抽帧+抽音频后委托 ImageParser/AudioParser；TtsService 逐句调用 `/audio/speech` 流式返回。

**Tech Stack:** NestJS + TypeScript + ffmpeg (child_process) + DashScope OpenAI 兼容 API

## Global Constraints

- 所有模型名从 ConfigService（即 `.env`）读取，提供合理默认值
- DashScope API 统一通过 `ALIYUN_API_KEY` + `ALIYUN_BASE_URL` 鉴权和寻址
- `ALIYUN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- 编译验证：`cd apps/server && npx tsc --noEmit`
- 系统已安装 ffmpeg（`ffmpeg` 命令可用）
- 代码风格遵循现有模式：NestJS DI、Logger、try/catch 降级

---

## File Structure Map

```
apps/server/src/modules/
  chat/services/
    asr/
      asr-provider.factory.ts              [MODIFY] 读取 ALIYUN_ASR_MODEL
      ali-dashscope.provider.ts            [MODIFY] 构造函数 +model 参数
      tencent.provider.ts                  [MODIFY] 构造函数 +model 参数
    tts.service.ts                          [MODIFY] 重写为 DashScope API 调用
  document/parsers/
    image.parser.ts                         [MODIFY] 默认值 qwen-vl-ocr
    audio.parser.ts                         [MODIFY] 重写为 DashScope 文件转写
    video.parser.ts                         [MODIFY] 重写为 ffmpeg + OCR + ASR
```

---

### Task 1: ASR Provider 模型注入

**Files:**
- Modify: `apps/server/src/modules/chat/services/asr/asr-provider.factory.ts`
- Modify: `apps/server/src/modules/chat/services/asr/ali-dashscope.provider.ts`
- Modify: `apps/server/src/modules/chat/services/asr/tencent.provider.ts`

**Interfaces:**
- Produces: `AliDashScopeAsrProvider(apiKey, model)` — 构造函数签名变更
- Produces: `TencentAsrProvider(secretId, secretKey, appId, model)` — 构造函数签名变更

- [ ] **Step 1: 修改 asr-provider.factory.ts — 读取 ALIYUN_ASR_MODEL**

在 `createAsrProvider` 函数开头读取模型名：

```typescript
export function createAsrProvider(config: ConfigService): AsrProvider {
  const provider = (config.get('DEFAULT_ASR_PROVIDER') || 'aliyun').toLowerCase();

  switch (provider) {
    case 'aliyun': {
      const apiKey = config.get('ALIYUN_API_KEY') || '';
      if (!apiKey) throw new Error('ALIYUN_API_KEY 未配置，阿里云 ASR 不可用');
      const model = config.get('ALIYUN_ASR_MODEL', 'fun-asr-mtl');
      return new AliDashScopeAsrProvider(apiKey, model);
    }
    case 'tencent': {
      const secretId = config.get('TENCENT_SECRET_ID') || '';
      const secretKey = config.get('TENCENT_SECRET_KEY') || '';
      const appId = config.get('TENCENT_APP_ID') || '';
      if (!secretId || !secretKey) throw new Error('TENCENT_SECRET_ID/SECRET_KEY 未配置，腾讯云 ASR 不可用');
      if (!appId) throw new Error('TENCENT_APP_ID 未配置，腾讯云 ASR 需要 AppID');
      const model = config.get('ALIYUN_ASR_MODEL', 'fun-asr-mtl');  // 腾讯云也读这个作为模型标识
      return new TencentAsrProvider(secretId, secretKey, appId, model);
    }
    default:
      throw new Error(`未知 ASR 提供商: ${provider}`);
  }
}
```

- [ ] **Step 2: 修改 ali-dashscope.provider.ts — 构造函数 +model**

在构造函数添加 `model` 参数，类中添加 `private readonly model` 字段。`start()` 中硬编码 `'paraformer-realtime-v2'` 改为 `this.model`：

```typescript
export class AliDashScopeAsrProvider implements AsrProvider {
  private readonly logger = new Logger(AliDashScopeAsrProvider.name);
  private readonly endpoint = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async start(sessionId: string, callbacks: AsrCallbacks): Promise<AsrSession> {
    // ...
    const startCmd = JSON.stringify({
      // ...
      payload: {
        // ...
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          disfluency_removal_enabled: false,
        },
        model: this.model,  // 替代硬编码 'paraformer-realtime-v2'
        input: {},
      },
    });
    // ...
  }
}
```

注意：DashScope WebSocket run-task 命令中 model 应放在 `payload.model` 字段而非 `payload.parameters` 中。

- [ ] **Step 3: 修改 tencent.provider.ts — 构造函数 +model**

```typescript
export class TencentAsrProvider implements AsrProvider {
  private readonly logger = new Logger(TencentAsrProvider.name);
  private readonly endpoint = 'asr.cloud.tencent.com';

  constructor(
    private readonly secretId: string,
    private readonly secretKey: string,
    private readonly appId: string,
    private readonly model: string,  // 新增
  ) {}
```

在 `buildSignature` 的 params 中传递：

```typescript
const params: Record<string, string> = {
  // ...
  engine_model_type: model === 'fun-asr-mtl' ? '16k_zh' : '16k_zh',
  // ...
};
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/modules/chat/services/asr/
git commit -m "feat: ASR Provider 模型名从环境变量 ALIYUN_ASR_MODEL 读取"
```

---

### Task 2: Image OCR 模型默认值

**Files:**
- Modify: `apps/server/src/modules/document/parsers/image.parser.ts:15`

**Interfaces:**
- 无变更 — `ImageParser` 接口不变

- [ ] **Step 1: 修改默认值**

将第 15 行：
```typescript
model: config.get('ALIYUN_OCR_MODEL'),
```
改为：
```typescript
model: config.get('ALIYUN_OCR_MODEL', 'qwen-vl-ocr'),
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/document/parsers/image.parser.ts
git commit -m "fix: Image OCR 模型默认值改为 qwen-vl-ocr"
```

---

### Task 3: Audio Parser — DashScope 文件转写

**Files:**
- Modify: `apps/server/src/modules/document/parsers/audio.parser.ts`

**Interfaces:**
- Consumes: ConfigService（新增依赖）— 读取 `ALIYUN_API_KEY`, `ALIYUN_BASE_URL`, `ALIYUN_ASR_MODEL`
- Produces: `ParseResult` — 标准解析结果

- [ ] **Step 1: 重写 AudioParser**

完整替换 `audio.parser.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentParser, ParseResult } from './parser.interface';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

/** 音频解析器：调用 DashScope 兼容 API 进行文件转写 */
@Injectable()
export class AudioParser implements DocumentParser {
  readonly supportedTypes = ['audio'];
  private readonly logger = new Logger(AudioParser.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get('ALIYUN_API_KEY') || '';
    this.baseUrl = config.get('ALIYUN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = config.get('ALIYUN_ASR_MODEL', 'fun-asr-mtl');
  }

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const ext = filename.split('.').pop()?.toLowerCase() || 'wav';
    const tmpFile = join(tmpdir(), `asr_${randomUUID()}.${ext}`);

    try {
      // 写入临时文件
      writeFileSync(tmpFile, buffer);

      // 构造 FormData
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', readFileSync(tmpFile), { filename, contentType: this.getMimeType(ext) });
      form.append('model', this.model);

      // 调用 DashScope 音频转写 API
      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        body: form as any,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`DashScope ASR API 错误 (${response.status}): ${errBody.slice(0, 200)}`);
      }

      const result = await response.json() as { text: string };
      const text = result.text || '';

      this.logger.log(`音频转写完成: ${filename}, 文本长度: ${text.length}`);

      const markdown = `# ${filename}\n\n${text || '> 音频文件中未检测到语音内容。'}`;
      return { markdown, images: [], metadata: { asr: true, model: this.model } };
    } catch (err) {
      this.logger.error(`音频转写失败: ${filename} — ${(err as Error).message}`);
      // 降级：返回提示信息
      const markdown = `# ${filename}\n\n> 音频转写失败: ${(err as Error).message}\n\n*文件大小: ${(buffer.length / 1024).toFixed(1)} KB*`;
      return { markdown, images: [], metadata: { asr: 'failed' } };
    } finally {
      // 清理临时文件
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  private getMimeType(ext: string): string {
    const map: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
      m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
      wma: 'audio/x-ms-wma', webm: 'audio/webm',
    };
    return map[ext] || 'audio/wav';
  }
}
```

注意：`form-data` 包需要确认是否已安装。若未安装，需 `pnpm add form-data`。

- [ ] **Step 2: 检查 form-data 依赖**

```bash
cd apps/server && grep -q "form-data" package.json || pnpm add form-data
```

- [ ] **Step 3: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/modules/document/parsers/audio.parser.ts apps/server/package.json
git commit -m "feat: AudioParser 接入 DashScope 文件转写 API"
```

---

### Task 4: Video Parser — ffmpeg 预处理管道

**Files:**
- Modify: `apps/server/src/modules/document/parsers/video.parser.ts`

**Interfaces:**
- Consumes: `ImageParser`, `AudioParser`（通过构造函数注入）— 用于 OCR 和 ASR 子任务
- Consumes: `ffmpeg`（系统命令，`child_process.execFile`）
- Produces: `ParseResult`

- [ ] **Step 1: 重写 VideoParser**

完整替换 `video.parser.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { DocumentParser, ParseResult } from './parser.interface';
import { ImageParser } from './image.parser';
import { AudioParser } from './audio.parser';

const execFileP = promisify(execFile);

/** 视频解析器：ffmpeg 抽帧+抽音频 → OCR + ASR → 合并 Markdown */
@Injectable()
export class VideoParser implements DocumentParser {
  readonly supportedTypes = ['video'];
  private readonly logger = new Logger(VideoParser.name);

  constructor(
    private readonly imageParser: ImageParser,
    private readonly audioParser: AudioParser,
  ) {}

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const workDir = join(tmpdir(), `video_parse_${randomUUID()}`);
    const inputFile = join(workDir, filename);

    try {
      mkdirSync(workDir, { recursive: true });
      writeFileSync(inputFile, buffer);

      let ocrText = '';
      let asrText = '';

      // 1. 抽帧（每分钟1帧）→ OCR
      try {
        const framesDir = join(workDir, 'frames');
        mkdirSync(framesDir, { recursive: true });
        await execFileP('ffmpeg', [
          '-i', inputFile,
          '-vf', 'fps=1/60',      // 每分钟 1 帧
          '-q:v', '2',
          '-f', 'image2',
          join(framesDir, 'frame_%04d.jpg'),
        ], { timeout: 120000 });

        // OCR 每一帧（最多 10 帧）
        const frames = readdirSync(framesDir).filter((f: string) => f.endsWith('.jpg'));
        const frameTexts: string[] = [];

        for (let i = 0; i < Math.min(frames.length, 10); i++) {
          try {
            const frameBuf = readFileSync(join(framesDir, frames[i]));
            const result = await this.imageParser.parse(frameBuf, frames[i]);
            if (result.markdown) {
              frameTexts.push(`### 帧 ${i + 1}\n\n${result.markdown}`);
            }
          } catch (err) {
            this.logger.warn(`帧 OCR 失败: ${frames[i]} — ${(err as Error).message}`);
          }
        }
        ocrText = frameTexts.join('\n\n');
      } catch (err) {
        this.logger.warn(`视频抽帧/OCR 失败: ${(err as Error).message}`);
      }

      // 2. 抽音频 → ASR
      try {
        const audioFile = join(workDir, 'audio.wav');
        await execFileP('ffmpeg', [
          '-i', inputFile,
          '-vn',                       // 不要视频流
          '-acodec', 'pcm_s16le',      // PCM 16bit
          '-ar', '16000',              // 16kHz
          '-ac', '1',                  // 单声道
          audioFile,
        ], { timeout: 120000 });

        const audioBuf = readFileSync(audioFile);
        if (audioBuf.length > 44) {  // > WAV header
          const result = await this.audioParser.parse(audioBuf, 'audio.wav');
          asrText = result.markdown || '';
        }
      } catch (err) {
        this.logger.warn(`视频抽音频/ASR 失败: ${(err as Error).message}`);
      }

      // 3. 合并
      const sections: string[] = [`# ${filename}`];
      if (!asrText.includes('转写失败') && !asrText.includes('暂不支持')) {
        sections.push(`## 语音内容\n\n${asrText}`);
      } else {
        sections.push(`> 音频 ASR 未成功`);
      }
      if (ocrText) {
        sections.push(`## 画面文字 (OCR)\n\n${ocrText}`);
      }

      const markdown = sections.join('\n\n');
      return { markdown, images: [], metadata: { video: true, ocrFrames: ocrText ? true : false, asr: asrText ? true : false } };

    } catch (err) {
      this.logger.error(`视频解析失败: ${filename} — ${(err as Error).message}`);
      const markdown = `# ${filename}\n\n> 视频解析失败: ${(err as Error).message}\n\n*文件大小: ${(buffer.length / 1024 / 1024).toFixed(1)} MB*`;
      return { markdown, images: [], metadata: { video: 'failed' } };
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/document/parsers/video.parser.ts
git commit -m "feat: VideoParser 接入 ffmpeg 抽帧+抽音频 + OCR/ASR 管道"
```

---

### Task 5: TTS 语音合成 — DashScope API

**Files:**
- Modify: `apps/server/src/modules/chat/services/tts.service.ts`

**Interfaces:**
- Consumes: ConfigService — 读取 `ALIYUN_API_KEY`, `ALIYUN_BASE_URL`, `ALIYUN_TTS_MODEL`
- Modifies: `synthesizeStream(text)` — 从空 Buffer yield 改为真实 MP3 Buffer yield

- [ ] **Step 1: 重写 TtsService**

完整替换 `tts.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 阿里云 DashScope 语音合成服务
 * 调用 OpenAI 兼容 /audio/speech API，按句子切分流式合成。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get('ALIYUN_API_KEY') || '';
    this.baseUrl = config.get('ALIYUN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = config.get('ALIYUN_TTS_MODEL', 'cosyvoice-v1');
  }

  /** 将文字转为 MP3 音频 Buffer（逐句流式返回） */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    // 按标点断句，保持句末标点附着在句子上
    const sentences = text
      .split(/(?<=[。！？；\n])/g)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const sentence of sentences) {
      try {
        const response = await fetch(`${this.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input: sentence,
            voice: 'zh-CN-Xiaoxiao',
            response_format: 'mp3',
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`TTS API 错误 (${response.status}): ${errText.slice(0, 200)}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);

        if (audioBuffer.length > 0) {
          this.logger.log(`TTS 合成: "${sentence.slice(0, 30)}..." (${audioBuffer.length} bytes)`);
          yield audioBuffer;
        }
      } catch (err) {
        this.logger.error(`TTS 合成失败: "${sentence.slice(0, 30)}..." — ${(err as Error).message}`);
        // 单句失败不中断，跳过继续
      }
    }
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/modules/chat/services/tts.service.ts
git commit -m "feat: TtsService 接入 DashScope 语音合成 API，逐句流式返回"
```

---

## Task Dependencies

```
Task 1 (ASR model)       ── 独立，无依赖
Task 2 (OCR model)        ── 独立，无依赖
Task 3 (Audio parser)     ── 独立，无依赖
Task 4 (Video parser)     ── 依赖 Task 3（注入 AudioParser）
Task 5 (TTS service)      ── 独立，无依赖
```

建议执行顺序：1 → 2 → 3 → 4 → 5（Task 4 必须在 Task 3 之后，其他可任意排列）
