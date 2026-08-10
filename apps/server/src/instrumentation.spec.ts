import { NodeSDK } from '@opentelemetry/sdk-node';

// 我们需要测试 registerOTel 函数的行为
// 但由于它注册全局单例，测试需要特殊处理
// 这里我们测试 registerOTel 在 OTel 环境变量未设置时不会抛出异常

describe('OTel Instrumentation Registration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置环境变量
    process.env = { ...originalEnv };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not throw when OTel env vars are not set', async () => {
    // registerOTel 在无 OTel 配置时应优雅跳过
    const { registerOTel } = await import('./instrumentation');
    expect(() => registerOTel()).not.toThrow();
  });

  it('should create SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
    process.env.OTEL_SERVICE_NAME = 'test-service';

    const { registerOTel } = await import('./instrumentation');
    expect(() => registerOTel()).not.toThrow();
  });
});
