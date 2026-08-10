import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedTestCase {
  question: string;
  groundTruth: string;
  groundTruthContexts: string[];
  category: string;
  expectedRetrieved: boolean;
  metadata: Record<string, any>;
}

/**
 * Excel 评测集解析器
 * 支持列名模糊匹配（中英文、大小写不敏感）
 */
@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);

  /**
   * 解析 Excel 评测集文件
   * @param filePath Excel 文件路径
   * @returns 解析后的测试用例数组
   */
  async parse(filePath: string): Promise<ParsedTestCase[]> {
    this.logger.log(`开始解析 Excel 评测集: ${filePath}`);

    try {
      // 读取 Excel 文件
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!worksheet) {
        throw new Error(`Excel 文件为空或格式错误: ${filePath}`);
      }

      // 转换为 JSON（第一行为表头）
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
      }) as any[][];

      if (rawData.length < 2) {
        throw new Error('Excel 文件至少需要包含表头和一行数据');
      }

      // 解析表头（支持模糊匹配）
      const headers = rawData[0].map((h) => String(h || '').trim().toLowerCase());
      const columnMap = this.matchColumns(headers);

      // 解析数据行
      const testCases: ParsedTestCase[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        const testCase = this.parseRow(row, columnMap, i + 1);
        testCases.push(testCase);
      }

      this.logger.log(`Excel 解析完成: ${testCases.length} 条测试用例`);
      return testCases;
    } catch (error) {
      this.logger.error(`Excel 解析失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 列名模糊匹配
   * 支持中英文、大小写不敏感、部分匹配
   */
  private matchColumns(headers: string[]): Record<string, number> {
    const columnMap: Record<string, number> = {};

    // 定义列名匹配规则（英文关键词 → 标准字段名）
    const columnRules: Record<string, string[]> = {
      question: ['question', '问题', 'query', 'querytext'],
      groundTruth: ['ground_truth', '参考答案', 'groundtruth', 'answer', 'expectedanswer'],
      groundTruthContexts: ['ground_truth_contexts', '需要检索到的文档', 'contexts', 'retrievalcontext'],
      category: ['category', '类型', '标签', 'tag'],
      expectedRetrieved: ['expected_retrieved', '预期检索', 'shouldretrieve'],
    };

    for (const [field, keywords] of Object.entries(columnRules)) {
      const index = headers.findIndex((header) =>
        keywords.some((keyword) => header.includes(keyword.toLowerCase())),
      );

      if (index !== -1) {
        columnMap[field] = index;
      }
    }

    // 验证必填字段
    if (!('question' in columnMap)) {
      throw new Error(
        `Excel 缺少必填列: question(问题)。可用列: ${headers.join(', ')}`,
      );
    }
    if (!('groundTruth' in columnMap)) {
      throw new Error(
        `Excel 缺少必填列: ground_truth(参考答案)。可用列: ${headers.join(', ')}`,
      );
    }

    return columnMap;
  }

  /**
   * 解析单行数据
   */
  private parseRow(row: any[], columnMap: Record<string, number>, rowNumber: number): ParsedTestCase {
    const getValue = (field: string): any => {
      const index = columnMap[field];
      if (index === undefined || index >= row.length) {
        return undefined;
      }
      return row[index];
    };

    const question = String(getValue('question') || '').trim();
    const groundTruth = String(getValue('groundTruth') || '').trim();

    if (!question) {
      throw new Error(`第 ${rowNumber} 行: question(问题) 不能为空`);
    }
    if (!groundTruth) {
      throw new Error(`第 ${rowNumber} 行: ground_truth(参考答案) 不能为空`);
    }

    // 解析 ground_truth_contexts（支持换行符或分号分隔）
    const contextsRaw = getValue('groundTruthContexts');
    let groundTruthContexts: string[] = [];
    if (contextsRaw) {
      const contextsStr = String(contextsRaw);
      groundTruthContexts = contextsRaw
        .split(/[\n;；]/)
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 0);
    }

    // 解析 category
    const category = String(getValue('category') || '未分类').trim();

    // 解析 expected_retrieved（布尔值）
    const expectedRetrievedRaw = getValue('expectedRetrieved');
    let expectedRetrieved = true;
    if (expectedRetrievedRaw !== undefined) {
      if (typeof expectedRetrievedRaw === 'boolean') {
        expectedRetrieved = expectedRetrievedRaw;
      } else {
        const val = String(expectedRetrievedRaw).toLowerCase().trim();
        expectedRetrieved = val === 'true' || val === '1' || val === '是' || val === 'yes';
      }
    }

    // 构建 metadata
    const metadata: Record<string, any> = {
      source: 'excel-upload',
      category,
      expectedRetrieved,
      questionLength: question.length,
      hasExpectedContext: groundTruthContexts.length > 0,
    };

    return {
      question,
      groundTruth,
      groundTruthContexts,
      category,
      expectedRetrieved,
      metadata,
    };
  }
}
