/**
 * LLM 调用指数退避重试工具
 * 仅对可重试错误重试：429（rate limit）、5xx（服务端错误）、网络错误（ECONNRESET / ETIMEDOUT / ECONNREFUSED）
 */
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;

      // 仅对可重试错误重试：429, 5xx, 网络错误
      const status = err?.status || err?.response?.status;
      const isRetryable =
        status === 429 ||
        (status && status >= 500) ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'ECONNREFUSED';

      if (!isRetryable) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s → 2s → 4s
      console.warn(`[LLM Retry] 第 ${attempt} 次重试，等待 ${delay}ms: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('unreachable');
}
