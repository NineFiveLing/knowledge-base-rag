import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';

/** 纯文本解析器：UTF-8 解码 + 规范化为 Markdown */
@Injectable()
export class TextParser implements DocumentParser {
  readonly supportedTypes = ['text'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const text = buffer.toString('utf-8').trim();
    const markdown = `# ${filename}\n\n${text}`;
    return { markdown, images: [], metadata: { charCount: text.length } };
  }
}
