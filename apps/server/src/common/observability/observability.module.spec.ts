import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityModule } from './observability.module';
import { LangfuseService } from './langfuse.service';

describe('ObservabilityModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    // 确保 LangFuse 环境变量为空，避免初始化
    process.env.LANGFUSE_PUBLIC_KEY = '';
    process.env.LANGFUSE_SECRET_KEY = '';

    module = await Test.createTestingModule({
      imports: [ObservabilityModule],
    }).compile();
  });

  afterEach(async () => {
    const service = module.get<LangfuseService>(LangfuseService);
    if ((service as any).shutdown) {
      await (service as any).shutdown();
    }
    await module.close();
  });

  it('should provide LangfuseService', () => {
    const service = module.get<LangfuseService>(LangfuseService);
    expect(service).toBeDefined();
    expect(service.getCallbackHandler).toBeDefined();
  });

  it('should export LangfuseService for other modules', () => {
    const service = module.get<LangfuseService>(LangfuseService, { strict: false });
    expect(service).toBeDefined();
  });
});
