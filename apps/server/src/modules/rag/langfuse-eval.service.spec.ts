import { Test, TestingModule } from '@nestjs/testing';
import { LangfuseEvalService } from './langfuse-eval.service';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { RAGService } from './rag.service';
import { ExcelParserService } from '../eval/excel-parser.service';
import { EvalScorerService } from '../eval/eval-scorer.service';

describe('LangfuseEvalService', () => {
  let service: LangfuseEvalService;
  let mockLangfuseService: jest.Mocked<LangfuseService>;
  let mockRagService: jest.Mocked<RAGService>;
  let mockExcelParser: jest.Mocked<ExcelParserService>;
  let mockEvalScorer = { score: jest.fn() } as any;

  beforeEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key';
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key';
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';
    process.env.LANGFUSE_PROJECT_ID = 'test-project';

    mockLangfuseService = {
      getClient: jest.fn(),
      shutdown: jest.fn(),
    } as any;

    mockRagService = {
      queryWithContext: jest.fn(),
    } as any;

    mockExcelParser = {
      parse: jest.fn(),
    } as any;

    mockEvalScorer = {
      score: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangfuseEvalService,
        { provide: LangfuseService, useValue: mockLangfuseService },
        { provide: RAGService, useValue: mockRagService },
        { provide: ExcelParserService, useValue: mockExcelParser },
        { provide: EvalScorerService, useValue: mockEvalScorer },
      ],
    }).compile();

    service = module.get<LangfuseEvalService>(LangfuseEvalService);
  });

  describe('uploadDataset', () => {
    it('should upload test cases to LangFuse Dataset', async () => {
      const mockClient = {
        datasets: {
          create: jest.fn().mockResolvedValue({
            id: 'dataset-123',
            name: 'test-dataset',
          }),
        },
        datasetItems: {
          create: jest.fn().mockResolvedValue({
            id: 'item-1',
            input: { question: 'Q1' },
          }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);

      const testCases = [
        { input: '问题1', expectedOutput: '答案1' },
        { input: '问题2', expectedOutput: '答案2' },
      ];

      const result = await service.uploadDataset('test-dataset', testCases);

      expect(result.datasetId).toBe('dataset-123');
      expect(mockClient.datasets.create).toHaveBeenCalledWith({
        name: 'test-dataset',
        metadata: { projectId: 'test-project' },
      });
      expect(mockClient.datasetItems.create).toHaveBeenCalledTimes(2);
    });

    it('should return error when LANGFUSE_PROJECT_ID is not set', async () => {
      delete process.env.LANGFUSE_PROJECT_ID;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LangfuseEvalService,
          { provide: LangfuseService, useValue: mockLangfuseService },
          { provide: RAGService, useValue: mockRagService },
          { provide: ExcelParserService, useValue: mockExcelParser },
          { provide: EvalScorerService, useValue: mockEvalScorer },
        ],
      }).compile();
      const newService = module.get<LangfuseEvalService>(LangfuseEvalService);

      await expect(
        newService.uploadDataset('test', [{ input: 'Q' }]),
      ).rejects.toThrow('LANGFUSE_PROJECT_ID is required');
    });
  });

  describe('uploadDatasetFromExcel', () => {
    it('应该从 Excel 文件解析并上传评测集', async () => {
      const mockClient = {
        datasets: {
          create: jest.fn().mockResolvedValue({
            id: 'dataset-123',
            name: 'test-dataset',
          }),
        },
        datasetItems: {
          create: jest.fn().mockResolvedValue({
            id: 'item-1',
            input: { question: 'Q1' },
          }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);
      mockExcelParser.parse.mockResolvedValue([
        {
          question: '问题1',
          groundTruth: '答案1',
          groundTruthContexts: ['文档1'],
          category: 'HR',
          expectedRetrieved: true,
          metadata: { source: 'excel-upload' },
        },
        {
          question: '问题2',
          groundTruth: '答案2',
          groundTruthContexts: [],
          category: 'IT',
          expectedRetrieved: false,
          metadata: { source: 'excel-upload' },
        },
      ]);

      const result = await service.uploadDatasetFromExcel('test.xlsx', 'test-dataset');

      expect(mockExcelParser.parse).toHaveBeenCalledWith('test.xlsx');
      expect(result.datasetId).toBe('dataset-123');
      expect(result.itemIds).toHaveLength(2);
      expect(mockClient.datasetItems.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('runEvaluationWithProgress', () => {
    it('应该分批执行评测，显式创建 eval trace 并关联，分数挂 traceId', async () => {
      const mockClient = {
        datasets: {
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'dataset-123', name: 'test-dataset' }],
          }),
          getRuns: jest.fn().mockResolvedValue({ data: [] }),
        },
        datasetItems: {
          list: jest.fn().mockResolvedValue({
            data: [
              { id: 'item-1', input: { question: 'Q1' }, expectedOutput: { answer: 'A1' } },
              { id: 'item-2', input: { question: 'Q2' }, expectedOutput: { answer: 'A2' } },
              { id: 'item-3', input: { question: 'Q3' }, expectedOutput: { answer: 'A3' } },
            ],
          }),
        },
        ingestion: {
          batch: jest.fn().mockResolvedValue({ successes: [], errors: [] }),
        },
        datasetRunItems: {
          create: jest.fn().mockResolvedValue({ id: 'run-item-1', datasetRunId: 'run-1' }),
        },
        scores: {
          create: jest.fn().mockResolvedValue({ id: 'score-1' }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);
      mockRagService.queryWithContext.mockResolvedValue({
        answer: 'generated answer',
        retrievedChunks: ['上下文1', '上下文2'],
        traceId: 'trace-1',
      });
      mockEvalScorer.score.mockResolvedValue({
        relevancy: { name: 'relevancy', value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { name: 'faithfulness', value: 0.8, reason: '有据', missingPoints: [] },
        credibility: { name: 'credibility', value: 0.7, reason: '覆盖关键点', missingPoints: ['未提及报销比例'] },
      });

      const result = await service.runEvaluationWithProgress('dataset-123', { batchSize: 2 });

      expect(mockRagService.queryWithContext).toHaveBeenCalledTimes(3);
      expect(mockEvalScorer.score).toHaveBeenCalledTimes(3);

      // 每条用例显式创建 eval trace（trace-create），不再依赖 CallbackHandler
      expect(mockClient.ingestion.batch).toHaveBeenCalledTimes(3);
      const traceBody = mockClient.ingestion.batch.mock.calls[0][0].batch[0];
      expect(traceBody.type).toBe('trace-create');
      expect(traceBody.body.input).toBe('Q1');
      expect(traceBody.body.output).toBe('generated answer');
      expect(traceBody.body.sessionId).toBe('eval-dataset-123-item-1');

      // run item 关联到显式创建的 eval traceId（不是 RAG 返回的 queryTraceId）
      expect(mockClient.datasetRunItems.create).toHaveBeenCalledTimes(3);
      const runCall = mockClient.datasetRunItems.create.mock.calls[0][0];
      expect(runCall.traceId).toBe(traceBody.body.id);
      expect(runCall.traceId).not.toBe('trace-1');

      // 三个维度分数挂在 traceId 上（保证实验页逐条可见）
      expect(mockClient.scores.create).toHaveBeenCalledTimes(9); // 3 用例 × 3 维度
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'credibility',
        value: 0.7,
        traceId: expect.any(String),
        comment: '覆盖关键点',
        metadata: { missingPoints: ['未提及报销比例'] },
      }));
      expect(mockClient.scores.create).not.toHaveBeenCalledWith(expect.objectContaining({ datasetRunId: 'run-1' }));

      expect(result.evaluatedCount).toBe(3);
      expect(result.scores).toHaveLength(3);
    });

    it('应该在评测失败时继续执行剩余用例，失败项仍建 trace 并打 failed 标记', async () => {
      const mockClient = {
        datasets: {
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'dataset-123', name: 'test-dataset' }],
          }),
          getRuns: jest.fn().mockResolvedValue({ data: [] }),
        },
        datasetItems: {
          list: jest.fn().mockResolvedValue({
            data: [
              { id: 'item-1', input: { question: 'Q1' }, expectedOutput: { answer: 'A1' } },
              { id: 'item-2', input: { question: 'Q2' }, expectedOutput: { answer: 'A2' } },
              { id: 'item-3', input: { question: 'Q3' }, expectedOutput: { answer: 'A3' } },
            ],
          }),
        },
        ingestion: {
          batch: jest.fn().mockResolvedValue({ successes: [], errors: [] }),
        },
        datasetRunItems: {
          create: jest.fn().mockResolvedValue({ id: 'run-item-1', datasetRunId: 'run-1' }),
        },
        scores: {
          create: jest.fn().mockResolvedValue({ id: 'score-1' }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);
      mockRagService.queryWithContext
        .mockResolvedValueOnce({ answer: 'answer 1', retrievedChunks: [], traceId: 'trace-1' })
        .mockRejectedValueOnce(new Error('API 限流'))
        .mockResolvedValueOnce({ answer: 'answer 3', retrievedChunks: [], traceId: 'trace-3' });
      mockEvalScorer.score.mockResolvedValue({
        relevancy: { name: 'relevancy', value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { name: 'faithfulness', value: 0.8, reason: '有据', missingPoints: [] },
        credibility: { name: 'credibility', value: 0.7, reason: '覆盖关键点', missingPoints: ['未提及报销比例'] },
      });

      const result = await service.runEvaluationWithProgress('dataset-123', { batchSize: 10 });

      expect(mockRagService.queryWithContext).toHaveBeenCalledTimes(3);
      expect(result.evaluatedCount).toBe(3); // 3 条用例都处理了
      expect(result.scores[0].scores.length).toBeGreaterThan(0); // item-1 有评分
      expect(result.scores[1].scores.length).toBeGreaterThan(0); // item-2 RAG 失败但落入兜底文本继续评分
      expect(result.scores[2].scores.length).toBeGreaterThan(0); // item-3 有评分

      // 失败标记断言：item-2 带 failed: true，成功项不带 failed 字段（为 falsy）
      expect(result.scores[1].failed).toBe(true);
      expect(result.scores[0].failed).toBeFalsy();
      expect(result.scores[2].failed).toBeFalsy();

      // 失败项 score 推送携带失败标记（metadata.failed: true）
      expect(mockClient.scores.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ failed: true }) }),
      );

      // 所有项（含 RAG 失败项）都显式建 trace 并关联 run，分数统一挂 traceId
      expect(mockClient.ingestion.batch).toHaveBeenCalledTimes(3);
      const failedTraceBody = mockClient.ingestion.batch.mock.calls[1][0].batch[0];
      expect(failedTraceBody.body.output).toContain('[RAG Error]');
      expect(failedTraceBody.body.metadata.failed).toBe(true);
      expect(mockClient.datasetRunItems.create).toHaveBeenCalledTimes(3);

      expect(mockClient.scores.create).toHaveBeenCalledTimes(9); // 3 项 × 3 维度
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({ traceId: expect.any(String) }));
      expect(mockClient.scores.create).not.toHaveBeenCalledWith(expect.objectContaining({ datasetRunId: 'run-1' }));
      expect(mockClient.scores.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'eval-dataset-123-item-2' }),
      );
    });

    it('创建 eval trace 失败时回退 sessionId 关联分数，且不中断', async () => {
      const mockClient = {
        datasets: {
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'dataset-123', name: 'test-dataset' }],
          }),
          getRuns: jest.fn().mockResolvedValue({ data: [] }),
        },
        datasetItems: {
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'item-1', input: { question: 'Q1' }, expectedOutput: { answer: 'A1' } }],
          }),
        },
        ingestion: {
          batch: jest.fn().mockRejectedValue(new Error('ingestion 失败')),
        },
        datasetRunItems: {
          create: jest.fn().mockResolvedValue({ id: 'run-item-1', datasetRunId: 'run-1' }),
        },
        scores: {
          create: jest.fn().mockResolvedValue({ id: 'score-1' }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);
      mockRagService.queryWithContext.mockResolvedValue({
        answer: 'generated answer',
        retrievedChunks: [],
        traceId: 'trace-1',
      });
      mockEvalScorer.score.mockResolvedValue({
        relevancy: { name: 'relevancy', value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { name: 'faithfulness', value: 0.8, reason: '有据', missingPoints: [] },
        credibility: { name: 'credibility', value: 0.7, reason: '覆盖关键点', missingPoints: [] },
      });

      const result = await service.runEvaluationWithProgress('dataset-123', { batchSize: 10 });

      expect(result.evaluatedCount).toBe(1);
      // trace 创建失败 → 跳过 run 关联，分数回退 sessionId 仍正常推送
      expect(mockClient.datasetRunItems.create).not.toHaveBeenCalled();
      expect(mockClient.scores.create).toHaveBeenCalledTimes(3);
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'eval-dataset-123-item-1',
      }));
    });

    it('应该在未初始化 LangFuse 时抛出错误', async () => {
      mockLangfuseService.getClient.mockReturnValue(null);

      await expect(service.runEvaluationWithProgress('dataset-123')).rejects.toThrow('LangFuse client not initialized');
    });
  });
});
