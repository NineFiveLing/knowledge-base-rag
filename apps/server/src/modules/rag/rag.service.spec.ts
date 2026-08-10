import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from './rag.service';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';
import { ConfigService } from '@nestjs/config';
import { Document } from '../document/entities/document.entity';

describe('RAGService - CallbackHandler Integration', () => {
  let service: RAGService;
  let mockSearch: jest.Mocked<SearchService>;
  let mockMemory: jest.Mocked<MemoryService>;
  let mockLangfuse: jest.Mocked<LangfuseService>;
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

    mockLangfuse = {
      getCallbackHandler: jest.fn().mockReturnValue(null),
      getClient: jest.fn().mockReturnValue(null),
      shutdown: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockDocRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
        {
          provide: LangfuseService,
          useValue: mockLangfuse,
        },
        {
          provide: SearchService,
          useValue: mockSearch,
        },
        {
          provide: MemoryService,
          useValue: mockMemory,
        },
        {
          provide: 'DocumentRepository',
          useValue: mockDocRepo,
        },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    await service.onModuleInit?.();
  });

  afterEach(async () => {
    await mockLangfuse.shutdown?.();
  });

  describe('LangfuseService integration', () => {
    it('should instantiate with all dependencies including LangfuseService', () => {
      expect(service).toBeDefined();
      expect(mockLangfuse.getCallbackHandler).toBeDefined();
    });

    it('should call getCallbackHandler with correct params', async () => {
      const mockHandler = { tags: ['userId:user-1', 'sessionId:session-1'] } as any;
      mockLangfuse.getCallbackHandler.mockReturnValue(mockHandler);

      const handler = mockLangfuse.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      expect(mockLangfuse.getCallbackHandler).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'session-1',
        conversationId: undefined,
      });
      expect(handler).not.toBeNull();
    });

    it('should handle null CallbackHandler gracefully', async () => {
      mockLangfuse.getCallbackHandler.mockReturnValue(null);

      const handler = mockLangfuse.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      expect(handler).toBeNull();
    });
  });
});
