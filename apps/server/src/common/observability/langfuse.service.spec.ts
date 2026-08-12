import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';
import { LangfuseAPIClient } from '@langfuse/core';

// Mock @langfuse/core
jest.mock('@langfuse/core', () => ({
  LangfuseAPIClient: jest.fn().mockImplementation(() => ({
    datasets: {
      list: jest.fn(),
      create: jest.fn(),
      getRuns: jest.fn(),
      getRun: jest.fn(),
    },
    datasetItems: {
      list: jest.fn(),
      create: jest.fn(),
    },
    scores: {
      create: jest.fn(),
    },
  })),
}));

describe('LangfuseService', () => {
  let service: LangfuseService;

  const createModule = async (envOverrides: Record<string, string | undefined> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangfuseService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => envOverrides[key]),
          },
        },
      ],
    }).compile();

    return module.get<LangfuseService>(LangfuseService);
  };

  beforeEach(async () => {
    // 先关闭可能遗留的实例
    const prev = await createModule({});
    if ((prev as any).shutdown) await (prev as any).shutdown();

    service = await createModule({
      LANGFUSE_PUBLIC_KEY: undefined,
      LANGFUSE_SECRET_KEY: undefined,
      LANGFUSE_BASE_URL: undefined,
      LANGFUSE_PROJECT_ID: undefined,
    });
  });

  afterEach(async () => {
    if ((service as any).shutdown) {
      await (service as any).shutdown();
    }
  });

  describe('getClient', () => {
    it('should return null when LANGFUSE_PUBLIC_KEY is not set', async () => {
      const svc = await createModule({});
      const client = svc.getClient();
      expect(client).toBeNull();
      if ((svc as any).shutdown) await (svc as any).shutdown();
    });

    it('should return null when LANGFUSE_PUBLIC_KEY is empty string', async () => {
      const svc = await createModule({ LANGFUSE_PUBLIC_KEY: '' });
      const client = svc.getClient();
      expect(client).toBeNull();
      if ((svc as any).shutdown) await (svc as any).shutdown();
    });

    it('should return LangFuse instance when env vars are configured', async () => {
      const newService = await createModule({
        LANGFUSE_PUBLIC_KEY: 'test-public-key',
        LANGFUSE_SECRET_KEY: 'test-secret-key',
        LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      });

      const client = newService.getClient();

      expect(client).not.toBeNull();
      expect(LangfuseAPIClient).toHaveBeenCalled();

      if ((newService as any).shutdown) await (newService as any).shutdown();
    });

    it('should use default baseUrl when LANGFUSE_BASE_URL is not set', async () => {
      const newService = await createModule({
        LANGFUSE_PUBLIC_KEY: 'test-public-key',
        LANGFUSE_SECRET_KEY: 'test-secret-key',
      });

      const client = newService.getClient();

      expect(client).not.toBeNull();
      expect(LangfuseAPIClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: undefined,
        }),
      );

      if ((newService as any).shutdown) await (newService as any).shutdown();
    });
  });
});
