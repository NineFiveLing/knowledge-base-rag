import type { EvalResult } from './metrics';

/** 打印终端评测报告 */
export function printReport(results: EvalResult[]): void {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const passRate = results.length > 0 ? (passed.length / results.length * 100).toFixed(1) : '0.0';

  console.log('\n========== RAG 评测报告 ==========');
  console.log(`总计: ${results.length} | 通过: ${passed.length} | 失败: ${failed.length}`);
  console.log(`通过率: ${passRate}%\n`);

  // 平均召回率
  const avgRecall = results.reduce((s, r) => s + r.answerRecall, 0) / (results.length || 1);
  console.log(`平均答案召回率: ${(avgRecall * 100).toFixed(1)}%`);

  // 延迟统计
  const validLatency = results.filter((r) => r.totalLatencyMs > 0);
  if (validLatency.length > 0) {
    const avgFirst = validLatency.reduce((s, r) => s + r.firstTokenLatencyMs, 0) / validLatency.length;
    const avgTotal = validLatency.reduce((s, r) => s + r.totalLatencyMs, 0) / validLatency.length;
    console.log(`平均首 Token 延迟: ${avgFirst.toFixed(0)}ms`);
    console.log(`平均总延迟: ${avgTotal.toFixed(0)}ms`);
  }

  // 按分类统计
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
  }
  console.log('\n--- 分类统计 ---');
  for (const [cat, stat] of Object.entries(byCategory).sort()) {
    console.log(`  ${cat}: ${stat.passed}/${stat.total} (${(stat.passed/stat.total*100).toFixed(0)}%)`);
  }

  // 失败用例详情
  if (failed.length > 0) {
    console.log('\n--- 失败用例 ---');
    for (const r of failed) {
      console.log(`  ${r.caseId} [${r.category}]: "${r.query}"`);
      console.log(`    召回率: ${(r.answerRecall * 100).toFixed(0)}% | 延迟: ${r.totalLatencyMs}ms`);
    }
  }

  console.log('====================================\n');
}

/** 输出 JSON 格式报告（用于 CI 集成） */
export function printJSONReport(results: EvalResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  console.log(JSON.stringify({
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      avgRecall: results.reduce((s, r) => s + r.answerRecall, 0) / (results.length || 1),
    },
    results,
  }));
}
