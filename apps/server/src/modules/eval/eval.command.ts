import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { LangfuseEvalService } from '../rag/langfuse-eval.service';
import { ExcelParserService } from './excel-parser.service';
import { TestCase } from '../rag/langfuse-eval.service';
import * as path from 'path';

/**
 * 上传评测集命令
 */
@Injectable()
@Command({
  name: 'eval-upload',
  description: '上传 Excel 评测集到 LangFuse Dataset',
  arguments: '[file]',
})
export class EvalUploadCommand extends CommandRunner {
  private readonly logger = new Logger(EvalUploadCommand.name);

  constructor(
    private langfuseEvalService: LangfuseEvalService,
    private excelParser: ExcelParserService,
  ) {
    super();
  }

  @Option({
    flags: '--name [name]',
    description: 'Dataset 名称',
  })
  parseName(name: string): string {
    return name;
  }

  async run(inputs: string[], options?: Record<string, any>): Promise<void> {
    try {
      const filePath = inputs[0] || options?.file || path.join(process.cwd(), '../../评测集.xlsx');
      const now = new Date();
      const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const time = now.toTimeString().split(' ')[0]; // HH:mm:ss
      const timestamp = `${date} ${time}`;
      const datasetName = options?.name || `rag-eval-${timestamp}`;

      this.logger.log(`📂 读取评测集: ${filePath}`);

      // 1. 解析 Excel
      const parsedTestCases = await this.excelParser.parse(filePath);

      // 转换 ParsedTestCase → TestCase
      const testCases: TestCase[] = parsedTestCases.map(tc => ({
        input: tc.question,
        expectedOutput: tc.groundTruth,
        metadata: {
          category: tc.category,
          expectedRetrieved: tc.expectedRetrieved,
          contexts: tc.groundTruthContexts,
        },
      }));

      console.log(`✅ 解析成功: ${testCases.length} 条测试用例`);

      // 2. 上传到 LangFuse
      const result = await this.langfuseEvalService.uploadDataset(datasetName, testCases);

      console.log(`\n✅ 评测集上传成功`);
      console.log(`   Dataset ID: ${result.datasetId}`);
      console.log(`   Test Cases: ${result.itemIds.length}`);
      console.log(`\n💡 提示: 使用 \`pnpm run eval:run -- --dataset-name=${result.datasetId}\` 执行评测`);
    } catch (error) {
      this.logger.error(`上传失败: ${(error as Error).message}`);
      process.exit(1);
    }
  }
}

/**
 * 执行评测命令
 */
@Injectable()
@Command({
  name: 'eval-run',
  description: '上传并执行评测（或仅评测已有 Dataset）',
  arguments: '[file]',
})
export class EvalRunCommand extends CommandRunner {
  private readonly logger = new Logger(EvalRunCommand.name);

  constructor(
    private langfuseEvalService: LangfuseEvalService,
    private excelParser: ExcelParserService,
  ) {
    super();
  }

  @Option({
    flags: '--name <name>',
    description: 'Dataset 名称（上传时使用）',
    name: 'name',
  })
  parseName(name: string): string | undefined {
    return name;
  }

  @Option({
    flags: '--dataset-name <name>',
    description: '已有 Dataset 名称（跳过上传）',
    name: 'datasetName',
  })
  parseDatasetName(name: string): string | undefined {
    return name;
  }

  @Option({
    flags: '--batch-size <n>',
    description: '批量大小',
    name: 'batchSize',
  })
  parseBatchSize(n: string): string | undefined {
    return n;
  }

  @Option({
    flags: '--file <file>',
    description: '评测集 Excel 文件路径',
    name: 'file',
  })
  parseFile(file: string): string | undefined {
    return file;
  }

  async run(inputs: string[], options?: Record<string, any>): Promise<void> {
    try {
      const batchSize = parseInt(options?.batchSize || '5', 10);
      let datasetName = options?.datasetName; // 使用 dataset name

      // 1. 上传评测集（如果未提供 datasetName）
      if (!datasetName) {
        const filePath = options?.file || inputs[0] || path.join(process.cwd(), '../../评测集.xlsx');

        // 默认名称精确到时分秒，避免同一天多个测试集冲突
        const now = new Date();
        const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const time = now.toTimeString().split(' ')[0]; // HH:mm:ss
        const timestamp = `${date} ${time}`;
        datasetName = options?.name || `rag-eval-${timestamp}`;

        this.logger.log(`📂 读取评测集: ${filePath}`);
        const parsedTestCases = await this.excelParser.parse(filePath);

        // 转换 ParsedTestCase → TestCase
        const testCases: TestCase[] = parsedTestCases.map(tc => ({
          input: tc.question,
          expectedOutput: tc.groundTruth,
          metadata: {
            category: tc.category,
            expectedRetrieved: tc.expectedRetrieved,
            contexts: tc.groundTruthContexts,
          },
        }));

        console.log(`✅ 解析成功: ${testCases.length} 条测试用例`);

        const uploadResult = await this.langfuseEvalService.uploadDataset(datasetName, testCases);
        datasetName = uploadResult.datasetId; // 保存返回的 datasetId 用于评测

        console.log(`\n✅ 评测集上传成功`);
        console.log(`   Dataset ID: ${datasetName}`);
        console.log(`   Test Cases: ${testCases.length}\n`);
      } else {
        console.log(`📊 使用已有 Dataset: ${datasetName}\n`);
      }

      // 2. 执行评测
      console.log('🚀 开始评测...\n');

      const startTime = Date.now();
      const result = await this.langfuseEvalService.runEvaluationWithProgress(datasetName, {
        batchSize,
      });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

      // 3. 输出统计报告
      console.log('\n📊 评测结果汇总');

      const passedCount = result.scores.filter((s: any) => s.scores.length > 0).length;
      const passRate = ((passedCount / result.evaluatedCount) * 100).toFixed(1);

      console.log(`   通过: ${passedCount}/${result.evaluatedCount} (${passRate}%)`);
      console.log(`   总耗时: ${totalTime}s`);

      if (result.scores.length > 0) {
        const avgScores = this.calculateAverageScores(result.scores);
        for (const [name, value] of Object.entries(avgScores)) {
          console.log(`   平均 ${name}: ${value.toFixed(2)}`);
        }
      }

      console.log('\n✨ 评测完成');
    } catch (error) {
      this.logger.error(`评测失败: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  /**
   * 计算平均评分
   */
  private calculateAverageScores(scores: Array<{ scores: Array<{ name: string; value: number }> }>): Record<string, number> {
    const sums: Record<string, { total: number; count: number }> = {};

    for (const item of scores) {
      for (const score of item.scores) {
        if (!sums[score.name]) {
          sums[score.name] = { total: 0, count: 0 };
        }
        sums[score.name].total += score.value;
        sums[score.name].count++;
      }
    }

    const averages: Record<string, number> = {};
    for (const [name, { total, count }] of Object.entries(sums)) {
      averages[name] = total / count;
    }

    return averages;
  }
}

