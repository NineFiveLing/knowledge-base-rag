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
