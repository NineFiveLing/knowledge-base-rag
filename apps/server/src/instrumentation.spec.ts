describe('OTel Instrumentation Registration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not start SDK when LANGFUSE_PUBLIC_KEY is not set', async () => {
    const { getOTelSdk } = await import('./instrumentation');
    expect(getOTelSdk()).toBeNull();
  });

  it('should not start SDK when LANGFUSE_PUBLIC_KEY is empty string', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = '';
    const { getOTelSdk } = await import('./instrumentation');
    expect(getOTelSdk()).toBeNull();
  });

  it('should start SDK when LANGFUSE_PUBLIC_KEY is set', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = 'http://localhost:19999';

    const { getOTelSdk, shutdownOTel } = await import('./instrumentation');
    expect(getOTelSdk()).not.toBeNull();
    await shutdownOTel();
  });
});
