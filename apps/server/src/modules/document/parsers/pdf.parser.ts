import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
const { PDFParse } = require('pdf-parse');

/** PDF 解析器：提取文本内容转为 Markdown */
@Injectable()
export class PdfParser implements DocumentParser {
  readonly supportedTypes = ['pdf'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    // pdf-parse v2 API: new PDFParse({ data: buffer }).load() → getText()
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    const textResult = await parser.getText();
    const allText = textResult.text || '';

    const paragraphs = allText
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .join('\n\n');

    const markdown = `# ${filename}\n\n${paragraphs || '> PDF 文本内容为空或不可提取'}`;
    return { markdown, images: [], metadata: { pageCount: textResult.total || 1 } };
  }
}
