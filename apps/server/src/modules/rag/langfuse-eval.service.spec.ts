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
    it('应该分批执行评测并返回评分结果', async () => {
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
      expect(mockClient.datasetRunItems.create).toHaveBeenCalledTimes(3);
      expect(mockClient.scores.create).toHaveBeenCalledTimes(9); // 3 用例 × 3 维度
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'credibility',
        value: 0.7,
        datasetRunId: 'run-1',
        comment: '覆盖关键点',
        metadata: { missingPoints: ['未提及报销比例'] },
      }));
      expect(result.evaluatedCount).toBe(3);
      expect(result.scores).toHaveLength(3);
    });

    it('应该在评测失败时继续执行剩余用例', async () => {
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
      expect(result.scores[1].scores.length).toBeGreaterThan(0); // item-2 RAG 失败但落入兜底文本继续评分（不跳过）
      expect(result.scores[2].scores.length).toBeGreaterThan(0); // item-3 有评分

      // 失败路径断言：item-2 RAG 失败无 traceId，跳过 run 关联；评分与 score 推送不受影响
      expect(mockClient.datasetRunItems.create).toHaveBeenCalledTimes(2); // 仅 item-1、item-3 关联 run
      expect(mockClient.scores.create).toHaveBeenCalledTimes(9); // 3 项 × 3 维度，含失败项 3 维
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'eval-dataset-123-item-2', // 失败项走 sessionId 回退分支
      }));
      expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
        datasetRunId: 'run-1', // 成功项仍走 datasetRunId 分支
      }));
    });

    it('应该在未初始化 LangFuse 时抛出错误', async () => {
      mockLangfuseService.getClient.mockReturnValue(null);

      await expect(service.runEvaluationWithProgress('dataset-123')).rejects.toThrow('LangFuse client not initialized');
    });
  });
});
