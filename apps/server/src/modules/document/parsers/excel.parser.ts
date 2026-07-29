import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
import * as XLSX from 'xlsx';

/** Excel 解析器：每个 Sheet → Markdown Table */
@Injectable()
export class ExcelParser implements DocumentParser {
  readonly supportedTypes = ['excel'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [`# ${filename}`];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1 });
      if (json.length === 0) continue;

      parts.push(`\n## ${sheetName}`);
      const headers = json[0] as string[];
      if (headers && headers.length > 0) {
        parts.push(`| ${headers.join(' | ')} |`);
        parts.push(`| ${headers.map(() => '---').join(' | ')} |`);
        for (let i = 1; i < json.length; i++) {
          const row = json[i] as string[];
          if (row.some((cell) => cell !== undefined && cell !== null && cell !== '')) {
            parts.push(`| ${headers.map((_, j) => String(row[j] ?? '')).join(' | ')} |`);
          }
        }
      }
    }

    return { markdown: parts.join('\n'), images: [], metadata: { sheetCount: wb.SheetNames.length } };
  }
}
