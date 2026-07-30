import { readFileSync } from 'fs';
import { join } from 'path';
import type { EvalCase, EvalResult } from './metrics';
import { calcAnswerRecall, isPassed } from './metrics';
import { printReport, printJSONReport } from './report';

const BASE_URL = process.env.API_URL || 'http://localhost:3001/api';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const OUTPUT_JSON = process.env.OUTPUT_JSON === 'true';

async function runEval() {
  const cases: EvalCase[] = JSON.parse(
    readFileSync(join(__dirname, 'test-cases.json'), 'utf-8'),
  ).filter((c: EvalCase) => c.enabled);

  if (!ADMIN_TOKEN) {
    console.error('请设置 ADMIN_TOKEN 环境变量');
    process.exit(1);
  }

  console.log(`开始评测 ${cases.length} 条用例...\n`);

  const results: EvalResult[] = [];

  for (const tc of cases) {
    process.stdout.write(`[${tc.id}] "${tc.query}" ... `);

    const startTime = Date.now();
    let firstTokenTime = 0;
    let fullAnswer = '';

    try {
      const response = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          message: tc.query,
          sessionId: `eval-${tc.id}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text' && parsed.content) {
              if (firstTokenTime === 0) firstTokenTime = Date.now();
              fullAnswer += parsed.content;
            }
          } catch { /* skip parse errors */ }
        }
      }
    } catch (err) {
      console.log(`❌ 请求失败: ${(err as Error).message}`);
      results.push({
        caseId: tc.id,
        query: tc.query,
        category: tc.category,
        answerRecall: 0,
        firstTokenLatencyMs: 0,
        totalLatencyMs: Date.now() - startTime,
        passed: false,
      });
      continue;
    }

    const totalLatency = Date.now() - startTime;
    const firstTokenLatency = firstTokenTime > 0 ? firstTokenTime - startTime : totalLatency;
    const answerRecall = calcAnswerRecall(tc.expectedKeywords, fullAnswer);
    const passed = isPassed(tc.expectedKeywords, fullAnswer);

    results.push({
      caseId: tc.id,
      query: tc.query,
      category: tc.category,
      answerRecall,
      firstTokenLatencyMs: firstTokenLatency,
      totalLatencyMs: totalLatency,
      passed,
    });

    const status = passed ? '✅' : '❌';
    console.log(`${status} 召回: ${(answerRecall * 100).toFixed(0)}% | ${totalLatency}ms`);
  }

  if (OUTPUT_JSON) {
    printJSONReport(results);
  } else {
    printReport(results);
  }

  // 有失败用例时返回非零退出码
  const hasFailures = results.some((r) => !r.passed);
  if (hasFailures) process.exit(1);
}

runEval().catch((err) => {
  console.error('评测脚本异常:', err);
  process.exit(2);
});
