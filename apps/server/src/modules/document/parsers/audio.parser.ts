import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';

/** 音频解析器（ASR）：调用阿里云/腾讯云语音识别 */
@Injectable()
export class AudioParser implements DocumentParser {
  readonly supportedTypes = ['audio'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    // MVP：ASR 依赖外部 API，此处提供骨架
    // 实际实现需调用阿里云 ASR SDK (NlsClient) 或腾讯云 ASR
    const markdown = `# ${filename}\n\n> 音频文件，语音识别功能接入中。\n\n*时长: ${(buffer.length / 16000).toFixed(1)} 秒（估计）*`;
    return { markdown, images: [], metadata: { asr: 'pending' } };
  }
}
