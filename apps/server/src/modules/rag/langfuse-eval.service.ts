import { Injectable, Logger } from '@nestjs/common';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { RAGService } from './rag.service';
import { ExcelParserService } from '../eval/excel-parser.service';
import { EvalScorerService } from '../eval/eval-scorer.service';

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
    /** 该用例评测是否失败（RAG 异常兜底或整体评测异常），CLI 统计时排除 */
    failed?: boolean;
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

        // 标记该用例 RAG 是否失败（失败仍保留兜底分数供参考，但统计时排除）
        let ragFailed = false;

        try {
          // 1. 跑 RAG（评测 trace 由步骤 3 显式创建，不依赖 CallbackHandler）
          let generatedAnswer = '';
          let retrievedChunks: string[] = [];
          try {
            const result = await this.ragService.queryWithContext(
              question,
              'eval-user',
              `eval-${resolvedDatasetId}-${item.id}`,
            );
            generatedAnswer = result.answer;
            retrievedChunks = result.retrievedChunks;
          } catch (ragError: any) {
            this.logger.warn(`RAG 执行失败 [${index}]: ${ragError.message}`);
            generatedAnswer = `[RAG Error] ${ragError.message.slice(0, 200)}`;
            ragFailed = true;
          }

          // 2. LLM 三维度评分
          const evalResult = await this.evalScorer.score({
            question,
            context: retrievedChunks,
            groundTruth,
            answer: generatedAnswer,
          });

          // 3. 显式创建 eval trace（input=问题, output=回答），保证实验详情有真实 trace 可渲染
          let evalTraceId: string | undefined;
          try {
            const newTraceId = crypto.randomUUID();
            await (client as any).ingestion.batch({
              batch: [
                {
                  type: 'trace-create',
                  id: crypto.randomUUID(),
                  timestamp: new Date().toISOString(),
                  body: {
                    id: newTraceId,
                    name: `eval-${item.id.slice(0, 8)}`,
                    userId: 'eval-user',
                    sessionId: `eval-${resolvedDatasetId}-${item.id}`,
                    input: question || null,
                    output: generatedAnswer || null,
                    tags: [`datasetId:${resolvedDatasetId}`, `datasetItemId:${item.id}`, `eval-run`],
                    metadata: {
                      datasetId: resolvedDatasetId,
                      datasetItemId: item.id,
                      datasetName: targetDataset!.name,
                      evalRun: true,
                      ...(ragFailed ? { failed: true } : {}),
                    },
                    environment: process.env.NODE_ENV || 'development',
                  },
                },
              ],
            });
            // 只有 ingestion 成功后才认为 trace 已创建，避免关联到不存在的 trace
            evalTraceId = newTraceId;
          } catch (traceError: any) {
            this.logger.warn(`创建 eval trace 失败 [${index}]: ${(traceError as Error).message}`);
          }

          // 4. 关联实验 run（用真实 evalTraceId；trace 创建失败时跳过，不影响评分）
          if (evalTraceId) {
            try {
              await (client as any).datasetRunItems.create({
                runName: targetDataset!.name,
                datasetItemId: item.id,
                traceId: evalTraceId,
              });
            } catch (runItemError: any) {
              this.logger.warn(`DatasetRunItem 创建失败: ${(runItemError as Error).message}`);
            }
          }

          // 5. 按维度推送 score（comment=理由，metadata=遗漏点），挂到 traceId 保证实验页逐条可见
          const dimensions = [evalResult.relevancy, evalResult.faithfulness, evalResult.credibility];
          for (const dim of dimensions) {
            try {
              const scoreTarget: any = {
                name: dim.name,
                value: dim.value,
                comment: dim.reason,
                metadata: ragFailed
                  ? { missingPoints: dim.missingPoints, failed: true }
                  : { missingPoints: dim.missingPoints },
              };
              // 关联标识：优先 traceId（run item 可见）；trace 创建失败时回退 sessionId
              if (evalTraceId) {
                scoreTarget.traceId = evalTraceId;
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
            ...(ragFailed ? { failed: true } : {}),
          });

          const scoreStr = dimensions.map((s) => `${s.name}=${s.value.toFixed(2)}`).join(', ');
          console.log(`[${index}/${items.length}] ${question.substring(0, 30)}... | ${scoreStr}`);
        } catch (error) {
          this.logger.error(`评测失败 [${index}/${items.length}]: ${(error as Error).message}`);
          scores.push({ itemId: item.id, scores: [], failed: true });
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
}
