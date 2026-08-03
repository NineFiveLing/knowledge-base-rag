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
