import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';

/** Markdown 解析器：格式校验后透传 */
@Injectable()
export class MarkdownParser implements DocumentParser {
  readonly supportedTypes = ['markdown'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const raw = buffer.toString('utf-8').trim();
    if (!raw) throw new Error('Markdown 文件内容为空');

    // 检测是否包含有效 Markdown 元素
    const hasMarkdown = /^#{1,6}\s|\[.*\]\(.*\)|```|[-*+]\s/.test(raw);
    const markdown = hasMarkdown ? raw : `# ${filename}\n\n${raw}`;
    return { markdown, images: [], metadata: { lineCount: raw.split('\n').length } };
  }
}
