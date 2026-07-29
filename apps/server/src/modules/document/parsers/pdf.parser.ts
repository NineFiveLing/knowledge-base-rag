import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
const pdfParse = require('pdf-parse');

/** PDF 解析器：提取文本内容转为 Markdown */
@Injectable()
export class PdfParser implements DocumentParser {
  readonly supportedTypes = ['pdf'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const data = await pdfParse(buffer);
    const paragraphs = data.text
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .join('\n\n');

    const markdown = `# ${filename}\n\n${paragraphs}`;
    return { markdown, images: [], metadata: { pageCount: data.numpages } };
  }
}
