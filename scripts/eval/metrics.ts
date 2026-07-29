/** 评测用例定义 */
export interface EvalCase {
  id: string;
  query: string;
  /** 答案中应包含的关键词 */
  expectedKeywords: string[];
  /** 预期意图分类（暂不评测，保留字段） */
  intent: string;
  /** 用例分类 */
  category: string;
  enabled: boolean;
}

/** 单条评测结果 */
export interface EvalResult {
  caseId: string;
  query: string;
  category: string;
  /** 答案关键词命中率 0-1 */
  answerRecall: number;
  /** 首 Token 延迟（ms） */
  firstTokenLatencyMs: number;
  /** 总延迟（ms） */
  totalLatencyMs: number;
  /** 是否通过（召回率 >= 0.5 或无期望关键词） */
  passed: boolean;
}

/** 计算答案关键词召回率 */
export function calcAnswerRecall(expected: string[], answer: string): number {
  if (expected.length === 0) return 1; // 聊天类无期望关键词，默认满分
  let hits = 0;
  for (const keyword of expected) {
    if (answer.includes(keyword)) hits++;
  }
  return hits / expected.length;
}

/** 判定是否通过 */
export function isPassed(expected: string[], answer: string): boolean {
  if (expected.length === 0) return true; // 聊天类永远通过
  return calcAnswerRecall(expected, answer) >= 0.5;
}
