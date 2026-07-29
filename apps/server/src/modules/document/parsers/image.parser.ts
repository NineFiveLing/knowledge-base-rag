import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { ConfigService } from '@nestjs/config';

/** 图片解析器（OCR）：阿里云多模态模型提取文字 */
@Injectable()
export class ImageParser implements DocumentParser {
  readonly supportedTypes = ['image'];
  private llm: ChatOpenAI;

  constructor(config: ConfigService) {
    this.llm = new ChatOpenAI({
      model: 'qwen-vl-plus',
      apiKey: config.get('ALIYUN_API_KEY'),
      configuration: { baseURL: config.get('ALIYUN_BASE_URL') },
    });
  }

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const base64 = buffer.toString('base64');
    const mimeType = this.getMimeType(filename);
    const msg = new HumanMessage({
      content: [
        { type: 'text', text: '请提取图片中的所有文字内容，以 Markdown 格式输出。' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    });

    const res = await this.llm.invoke([msg]);
    const markdown = `# ${filename}\n\n${res.content as string}`;
    return { markdown, images: [], metadata: { ocr: true } };
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
    return map[ext || ''] || 'image/png';
  }
}
