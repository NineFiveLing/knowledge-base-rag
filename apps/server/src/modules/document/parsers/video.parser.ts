import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';

/** 视频解析器：ffmpeg 抽帧+抽音频 → OCR/ASR → 合并 Markdown */
@Injectable()
export class VideoParser implements DocumentParser {
  readonly supportedTypes = ['video'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    // MVP：视频处理需 ffmpeg 子进程调用，此处提供骨架
    // 流程: ffmpeg -i <input> → 抽帧(JPG) → ImageParser(OCR) + 抽音频(WAV) → AudioParser(ASR) → 合并
    const markdown = `# ${filename}\n\n> 视频文件，智能解析功能接入中。\n\n*文件大小: ${(buffer.length / 1024 / 1024).toFixed(1)} MB*`;
    return { markdown, images: [], metadata: { video: 'pending' } };
  }
}
