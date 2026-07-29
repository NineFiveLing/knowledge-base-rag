import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
const mammoth = require('mammoth');

/** Word 文档解析器：doc/docx → Markdown */
@Injectable()
export class WordParser implements DocumentParser {
  readonly supportedTypes = ['word'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const result = await mammoth.convertToMarkdown({ buffer });
    const markdown = `# ${filename}\n\n${result.value}`;
    return {
      markdown,
      images: [],
      metadata: { warnings: result.messages.map((m: { message: string }) => m.message) },
    };
  }
}
