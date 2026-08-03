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
