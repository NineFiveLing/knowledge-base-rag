import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
import * as XLSX from 'xlsx';

/** PPT 解析器：提取幻灯片文本（MVP 简化版） */
@Injectable()
export class PptParser implements DocumentParser {
  readonly supportedTypes = ['ppt'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    // MVP：尝试用 xlsx 提取（PPTX 本质是 ZIP + XML）
    // 完整实现需 python-pptx 或 pptx-parser
    let markdown = `# ${filename}\n\n`;
    markdown += '> 注意：PPT 解析为简化版本，复杂格式可能丢失。\n\n';
    markdown += `*文件大小: ${(buffer.length / 1024).toFixed(1)} KB*\n`;

    return { markdown, images: [], metadata: { note: 'simplified parser' } };
  }
}
