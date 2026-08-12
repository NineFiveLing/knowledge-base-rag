import { Injectable, Logger } from '@nestjs/common';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { RAGService } from './rag.service';
import { ExcelParserService } from '../eval/excel-parser.service';
import { ParsedTestCase } from '../eval/excel-parser.service';
import { EvalScorerService } from '../eval/eval-scorer.service';
import { CallbackHandler } from '@langfuse/langchain';

export interface TestCase {
  input: string;
  expectedOutput?: string;
  expectedRetrievalContext?: string[];
  metadata?: Record<string, any>;
}

export interface DatasetUploadResult {
  datasetId: string;
  itemIds: string[];
}

export interface EvaluationResult {
  datasetId: string;
  evaluatedCount: number;
  scores: Array<{
    itemId: string;
    scores: Array<{ name: string; value: number; comment?: string }>;
  }>;
}

/** LangFuse 评测服务：管理 Dataset 和批量评测 */
@Injectable()
export class LangfuseEvalService {
  private readonly logger = new Logger(LangfuseEvalService.name);

  constructor(
    private langfuseService: LangfuseService,
    private ragService: RAGService,
    private excelParser: ExcelParserService,
    private evalScorer: EvalScorerService,
  ) {}

  /**
   * 上传测试用例集到 LangFuse Dataset
   */
  async uploadDataset(name: string, testCases: TestCase[]): Promise<DatasetUploadResult> {
    const projectId = process.env.LANGFUSE_PROJECT_ID;
    if (!projectId) {
      throw new Error('LANGFUSE_PROJECT_ID is required for dataset operations');
    }

    const client = this.langfuseService.getClient();
    if (!client) {
      throw new Error('LangFuse client not initialized');
    }

    // v5 API: 创建 Dataset
    const dataset = await (client as any).datasets.create({
      name,
      metadata: { projectId },
    });

    const itemIds: string[] = [];

    // v5 API: 批量上传测试用例
    for (const testCase of testCases) {
      const item = await (client as any).datasetItems.create({
        datasetName: dataset.name,
        input: { question: testCase.input },
        expectedOutput: testCase.expectedOutput ? { answer: testCase.expectedOutput } : undefined,
        metadata: testCase.metadata,
      });
      itemIds.push(item.id);
    }

    this.logger.log(`Uploaded ${itemIds.length} test cases to dataset ${dataset.id}`);
    return { datasetId: dataset.id, itemIds };
  }

  /**
   * 从 Excel 文件上传评测集
   * @param filePath Excel 文件路径
   * @param datasetName Dataset 名称
   */
  async uploadDatasetFromExcel(filePath: string, datasetName: string): Promise<DatasetUploadResult> {
    this.logger.log(`从 Excel 文件上传评测集: ${filePath}`);

    // 1. 解析 Excel
    const parsedCases = await this.excelParser.parse(filePath);

    // 2. 转换为 TestCase 格式
    const testCases: TestCase[] = parsedCases.map((parsed) => ({
      input: parsed.question,
      expectedOutput: parsed.groundTruth,
      expectedRetrievalContext: parsed.groundTruthContexts,
      metadata: parsed.metadata,
    }));

    // 3. 上传到 LangFuse
    return this.uploadDataset(datasetName, testCases);
  }

  /**
   * 批量执行评测（带进度显示）
   * @param datasetNameOrId Dataset 名称或 ID
   * @param options 配置选项
   */
  async runEvaluationWithProgress(
    datasetNameOrId: string,
    options?: { batchSize?: number },
  ): Promise<EvaluationResult> {
    const client = this.langfuseService.getClient();
    if (!client) {
      throw new Error('LangFuse client not initialized');
    }

    const batchSize = options?.batchSize || 5;

    // v5 API: 先通过名称或 ID 查找 dataset，再用 datasetName 精确查询 items
    let items: any[] = [];
    let resolvedDatasetId: string = datasetNameOrId;

    // 步骤 1: 查找 dataset 信息
    let targetDataset: { id: string; name: string } | undefined;
    try {
      const datasets = await (client as any).datasets.list({ limit: 100 });
      targetDataset = (datasets?.data || []).find(
        (d: any) => d.id === datasetNameOrId || d.name === datasetNameOrId
      );

      if (targetDataset) {
        this.logger.log(`找到 Dataset: ${targetDataset.name} (${targetDataset.id})`);
        resolvedDatasetId = targetDataset.id;
      } else {
        this.logger.warn(`未找到匹配的 Dataset: ${datasetNameOrId}`);
      }
    } catch (listError) {
      this.logger.error(`列出 datasets 失败: ${(listError as Error).message}`);
    }

    if (!targetDataset) {
      throw new Error(`Dataset not found: ${datasetNameOrId}`);
    }

    // 步骤 2: 用 datasetName 精确查询 items（避免 datasetId 模糊匹配问题）
    try {
      this.logger.log(`查询 Dataset Items: ${targetDataset.name}`);
      const datasetItems = await (client as any).datasetItems.list({
        datasetName: targetDataset.name,
        limit: 100,
      });
      items = datasetItems?.data || [];
      this.logger.log(`✅ 找到 ${items.length} 条 items`);
    } catch (error) {
      this.logger.error(`查询 Dataset Items 失败: ${(error as Error).message}`);
      throw new Error(`Failed to fetch dataset items: ${(error as Error).message}`);
    }

    if (items.length === 0) {
      throw new Error(`Dataset is empty: ${datasetNameOrId}`);
    }

    this.logger.log(`获取到 ${items.length} 条测试用例`);

    const scores: EvaluationResult['scores'] = [];

    console.log(`📊 开始评测，共 ${items.length} 条用例\n`);

    // 分批执行（防止限流）
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j + 1;
        const question = (item.input as any)?.question || '';
        const groundTruth = (item.expectedOutput as any)?.answer || '';

        try {
          // 1. 跑 RAG（带 evalHandler 产生 trace）
          const evalHandler = new CallbackHandler({
            userId: 'eval-user',
            sessionId: `eval-${resolvedDatasetId}-${item.id}`,
            tags: [`datasetId:${resolvedDatasetId}`, `datasetItemId:${item.id}`],
            traceMetadata: {
              datasetId: resolvedDatasetId,
              datasetItemId: item.id,
              datasetName: targetDataset!.name,
              evalRun: true,
            },
          });

          let generatedAnswer = '';
          let retrievedChunks: string[] = [];
          let queryTraceId: string | undefined;
          try {
            const result = await this.ragService.queryWithContext(
              question,
              'eval-user',
              `eval-${resolvedDatasetId}-${item.id}`,
              [evalHandler],
            );
            generatedAnswer = result.answer;
            retrievedChunks = result.retrievedChunks;
            queryTraceId = result.traceId;
          } catch (ragError: any) {
            this.logger.warn(`RAG 执行失败 [${index}]: ${ragError.message}`);
            generatedAnswer = `[RAG Error] ${ragError.message.slice(0, 200)}`;
          }

          // 2. LLM 三维度评分
          const evalResult = await this.evalScorer.score({
            question,
            context: retrievedChunks,
            groundTruth,
            answer: generatedAnswer,
          });

          // 3. 关联实验 run（traceId 为空时跳过，不影响评分）
          let datasetRunId: string | undefined;
          const runItemTraceId =
            queryTraceId ||
            (evalHandler.last_trace_id &&
            evalHandler.last_trace_id !== '00000000-0000-0000-0000-000000000000'
              ? evalHandler.last_trace_id
              : undefined);
          if (runItemTraceId) {
            try {
              const runItem = await (client as any).datasetRunItems.create({
                runName: targetDataset!.name,
                datasetItemId: item.id,
                traceId: runItemTraceId,
              });
              datasetRunId = runItem.datasetRunId;
            } catch (runItemError: any) {
              this.logger.warn(`DatasetRunItem 创建失败: ${(runItemError as Error).message}`);
            }
          }

          // 4. 按维度推送 score（comment=理由，metadata=遗漏点）
          const dimensions = [evalResult.relevancy, evalResult.faithfulness, evalResult.credibility];
          for (const dim of dimensions) {
            try {
              const scoreTarget: any = {
                name: dim.name,
                value: dim.value,
                comment: dim.reason,
                metadata: { missingPoints: dim.missingPoints },
              };
              // 关联标识：有 run 时带 datasetRunId，否则回退到 sessionId（避免为空被 LangFuse 拒绝）
              if (datasetRunId) {
                scoreTarget.datasetRunId = datasetRunId;
              } else {
                scoreTarget.sessionId = `eval-${resolvedDatasetId}-${item.id}`;
              }
              await (client as any).scores.create(scoreTarget);
            } catch (scoreError: any) {
              this.logger.warn(`创建 score 失败 [${index}] ${dim.name}: ${(scoreError as Error).message}`);
            }
          }

          scores.push({
            itemId: item.id,
            scores: dimensions.map((d) => ({ name: d.name, value: d.value, comment: d.reason })),
          });

          const scoreStr = dimensions.map((s) => `${s.name}=${s.value.toFixed(2)}`).join(', ');
          console.log(`[${index}/${items.length}] ${question.substring(0, 30)}... | ${scoreStr}`);
        } catch (error) {
          this.logger.error(`评测失败 [${index}/${items.length}]: ${(error as Error).message}`);
          scores.push({ itemId: item.id, scores: [] });
        }
      }

      // 每批结束后短暂延迟（防止限流）
      if (i + batchSize < items.length) {
        await this.delay(1000);
      }
    }

    this.logger.log(`评测完成: ${scores.length}/${items.length} 条用例`);
    return { datasetId: resolvedDatasetId, evaluatedCount: scores.length, scores };
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 批量执行评测：遍历 Dataset 用例 → 调用 RAG 管道 → 评分
   * @deprecated 使用 runEvaluationWithProgress 替代
   */
  async runEvaluation(datasetNameOrId: string): Promise<EvaluationResult> {
    const client = this.langfuseService.getClient();
    if (!client) {
      throw new Error('LangFuse client not initialized');
    }

    // v5 API: 支持通过名称或 ID 查找 dataset
    let datasetId: string = datasetNameOrId; // 初始化为输入值，防止未赋值错误
    let items: any[] = [];

    // 方法 1: 尝试通过 ID 直接获取
    try {
      const datasetItems = await (client as any).datasetItems.list({
        datasetId: datasetNameOrId,
        limit: 1000,
      });
      items = datasetItems?.data || [];
      if (items.length > 0) {
        datasetId = datasetNameOrId;
        this.logger.log(`✅ 通过 ID 找到 ${items.length} 条 items`);
      }
    } catch (error) {
      // 方法 2: 通过名称查找
      const datasets = await (client as any).datasets.list({ limit: 100 });
      const dataset = (datasets?.data || []).find(
        (d: any) => d.id === datasetNameOrId || d.name === datasetNameOrId
      );

      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetNameOrId}`);
      }

      datasetId = dataset.id;
      const datasetItems = await (client as any).datasetItems.list({
        datasetName: dataset.name,
        limit: 1000,
      });
      items = datasetItems?.data || [];
    }

    const scores: EvaluationResult['scores'] = [];

    for (const item of items) {
      const question = (item.input as any)?.question || '';
      const expectedAnswer = (item.expectedOutput as any)?.answer || '';

      // 调用 RAG 管道执行
      const { answer: generatedAnswer } = await this.ragService.query(
        question,
        'eval-user',
        `eval-${datasetId}`,
      );

      // 计算评分指标
      const itemScores = await this.evaluateAnswer(
        question,
        expectedAnswer,
        generatedAnswer,
      );

      // 将评分推送到 LangFuse
      for (const score of itemScores) {
        await (client as any).scores.create({
          traceId: item.id,
          name: score.name,
          value: score.value,
          comment: score.comment,
        });
      }

      scores.push({
        itemId: item.id,
        scores: itemScores,
      });

      this.logger.log(`Evaluated item ${item.id}: ${itemScores.map(s => `${s.name}=${s.value}`).join(', ')}`);
    }

    return { datasetId, evaluatedCount: scores.length, scores };
  }

  /**
   * 评分逻辑：计算 answer-relevancy、faithfulness
   * 使用内置启发式方法
   */
  private async evaluateAnswer(
    question: string,
    expected: string,
    generated: string,
  ): Promise<Array<{ name: string; value: number; comment?: string }>> {
    const scores: Array<{ name: string; value: number; comment?: string }> = [];

    // answer-relevancy: 基于关键词重叠的简单启发式评分
    const relevancy = this.calculateRelevancy(question, generated);
    scores.push({ name: 'answer-relevancy', value: relevancy });

    // faithfulness: 检查生成答案是否包含期望答案的关键信息
    const faithfulness = this.calculateFaithfulness(expected, generated);
    scores.push({ name: 'faithfulness', value: faithfulness });

    return scores;
  }

  /**
   * 基于 bigram Jaccard 相似度计算相关性
   */
  private calculateRelevancy(question: string, answer: string): number {
    const qBigrams = this.getBigrams(question);
    const aBigrams = this.getBigrams(answer);
    if (qBigrams.size === 0) return 0;
    const intersection = new Set([...qBigrams].filter((x) => aBigrams.has(x)));
    return intersection.size / qBigrams.size;
  }

  /**
   * faithfulness: 检查期望答案的关键词是否在生成答案中
   * 使用 n-gram 相似度（对中文更友好）
   */
  private calculateFaithfulness(expected: string, generated: string): number {
    // 对中文使用字符级 trigram，对英文使用单词级匹配
    const expectedNgrams = this.getNgrams(expected, 3);
    const generatedNgrams = this.getNgrams(generated.toLowerCase(), 3);

    if (expectedNgrams.size === 0) return 0;

    const intersection = new Set([...expectedNgrams].filter((x) => generatedNgrams.has(x)));
    return intersection.size / expectedNgrams.size;
  }

  /**
   * 提取文本的 n-gram（支持中英文）
   */
  private getNgrams(text: string, n: number): Set<string> {
    const ngrams = new Set<string>();

    // 中文：按字符
    // 英文：按单词
    const isChinese = /[一-鿿]/.test(text);

    if (isChinese) {
      // 中文：直接按字符生成 n-gram
      for (let i = 0; i <= text.length - n; i++) {
        ngrams.add(text.slice(i, i + n).toLowerCase());
      }
    } else {
      // 英文：按单词生成 n-gram
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(' ');
        ngrams.add(ngram.toLowerCase());
      }
    }

    return ngrams;
  }

  private getBigrams(text: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.slice(i, i + 2).toLowerCase());
    }
    return bigrams;
  }
}
