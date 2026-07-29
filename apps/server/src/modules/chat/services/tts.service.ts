import { Injectable, Logger } from '@nestjs/common';

/**
 * 阿里云 NLS 语音合成服务（Placeholder）
 * 当前为骨架实现，后续接入阿里云 NLS 流式 TTS。
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  /** 将文字转为 PCM 音频 Buffer（流式返回） */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    const sentences = text.split(/(?<=[。！？，；\n])/g).filter(s => s.trim());
    for (const sentence of sentences) {
      this.logger.log(`TTS 合成: ${sentence.slice(0, 20)}...`);
      yield Buffer.alloc(0); // Placeholder
    }
  }
}
