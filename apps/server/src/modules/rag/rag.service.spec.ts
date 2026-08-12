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
});
