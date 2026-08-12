import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from './rag.service';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';
import { ConfigService } from '@nestjs/config';
import { Document } from '../document/entities/document.entity';

describe('RAGService - CallbackHandler Integration', () => {
  let service: RAGService;
  let mockSearch: jest.Mocked<SearchService>;
  let mockMemory: jest.Mocked<MemoryService>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key';
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key';
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';

    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'ALIYUN_API_KEY': return 'test-api-key';
          case 'ALIYUN_BASE_URL': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
          case 'MODEL_NAME': return 'deepseek-v4-flash-0731';
          case 'EMBEDDING_MODEL': return 'text-embedding-v2';
          default: return undefined;
        }
      }),
    } as any;

    mockSearch = {
      hybridSearch: jest.fn(),
      searchWithThreshold: jest.fn(),
    } as any;

    mockMemory = {
      buildPromptContext: jest.fn().mockResolvedValue({
        summary: '',
        history: '',
        systemContext: '',
      }),
      onMessage: jest.fn(),
    } as any;

    const mockDocRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: SearchService, useValue: mockSearch },
        { provide: MemoryService, useValue: mockMemory },
        { provide: 'DocumentRepository', useValue: mockDocRepo },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    await service.onModuleInit?.();
  });

  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  describe('createLangfuseHandler', () => {
    it('should create handler with tags when keys are set', () => {
      const handler = (service as any).createLangfuseHandler({
        userId: 'user-1',
        sessionId: 'session-1',
        conversationId: 'conv-1',
      });

      expect(handler).not.toBeNull();
      expect((handler as any).tags).toContain('userId:user-1');
      expect((handler as any).tags).toContain('sessionId:session-1');
      expect((handler as any).tags).toContain('conversationId:conv-1');
    });

    it('should return null when keys are not set', () => {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;

      const handler = (service as any).createLangfuseHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      expect(handler).toBeNull();
    });
  });

  describe('queryWithContext', () => {
    it('应返回剥离 SOURCES 标签的答案与检索上下文', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        finalAnswer: '年假通过OA系统申请。\n<!-- SOURCES:[{"index":1}] -->',
        retrievedChunks: [
          { chunk_text: '员工可通过OA系统提交年假申请', score: 0.9 },
          { chunk_text: '提前3个工作日提交', score: 0.8 },
        ],
      });
      (service as any).graph = { invoke: mockInvoke };

      const result = await service.queryWithContext('年假怎么申请？', 'user-1', 'session-1');

      expect(result.answer).toBe('年假通过OA系统申请。');
      expect(result.retrievedChunks).toEqual([
        '员工可通过OA系统提交年假申请',
        '提前3个工作日提交',
      ]);
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('无 SOURCES 标签时原样返回答案', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        finalAnswer: '直接回答',
        retrievedChunks: [],
      });
      (service as any).graph = { invoke: mockInvoke };

      const result = await service.queryWithContext('你好', 'user-1', 'session-1');

      expect(result.answer).toBe('直接回答');
      expect(result.retrievedChunks).toEqual([]);
    });

    it('应透传外部 CallbackHandler 的 traceId', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        finalAnswer: '回答',
        retrievedChunks: [],
      });
      (service as any).graph = { invoke: mockInvoke };
      const fakeHandler = { last_trace_id: 'trace-abc' } as any;

      const result = await service.queryWithContext('Q', 'user-1', 'session-1', [fakeHandler]);

      expect(result.traceId).toBe('trace-abc');
    });
  });
});
