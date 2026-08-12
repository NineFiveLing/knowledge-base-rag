# Eval LLM Scoring 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 LLM 对评测集每条用例做三维度（相关性/忠实度/可信性）打分并推送差距说明到 LangFuse 实验页，同时精简现有复杂的评测流程。

**Architecture:** 新增独立的 `EvalScorerService`（纯 LLM 评判器，复用主模型，一次调用输出三维度 JSON，zod 校验）；`RAGService` 新增 `queryWithContext()` 返回检索上下文；`LangfuseEvalService` 瘦身为编排器（取用例 → 跑 RAG → 评分 → 推送实验 run），删除废弃方法与启发式评分。

**Tech Stack:** NestJS 11、LangChain `ChatOpenAI`、`zod` v4、`@langfuse/core`（LangfuseAPIClient）、Jest 29 + ts-jest。

## Global Constraints

- 所有注释、提交信息使用简体中文
- 每个 commit 前必须经用户审查确认（`确认提交`）
- TDD：先写失败测试，验证失败后再写实现
- 复用主模型（`MODEL_NAME`，deepseek-v4-flash），不引入独立评判模型配置
- 一次 LLM 调用出三维度；用 `llm.invoke()` + `zod.safeParse`，不用 `withStructuredOutput`（依赖工具调用协议，dashscope 有风险）
- 保持 `datasetRunItems.create`（LangFuse 实验 run 可写路径），不引入只读的 Experiments API
- 不修改 `评测集.xlsx` 格式、不修改 graph、不新增数据库表/前端页面
- 评分链路：`scores.create({ name, value, datasetRunId, comment, metadata: { missingPoints } })`
- 测试命令：`cd /d/project/knowledge-base-rag/apps/server && npx jest <pattern>`；构建：`cd /d/project/knowledge-base-rag/apps/server && npx nest build`
- 单条用例 RAG/评分失败不中断，记录失败项继续（与现有行为一致）

---

### Task 1: EvalScorerService（LLM 三维度评判器）

**Files:**
- Create: `apps/server/src/modules/eval/eval-scorer.service.ts`
- Test: `apps/server/src/modules/eval/eval-scorer.service.spec.ts`

**Interfaces:**
- Produces: `EvalScorerService`（`@Injectable`，构造注入 `ConfigService`）、`EvalScoreInput`、`EvalScoreResult`、`DimensionScore`（后续 Task 3 使用）。`score(input: EvalScoreInput): Promise<EvalScoreResult>`。

- [ ] **Step 1: 写失败测试**

`apps/server/src/modules/eval/eval-scorer.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EvalScorerService } from './eval-scorer.service';

describe('EvalScorerService', () => {
  let service: EvalScorerService;
  let mockInvoke: jest.Mock;

  const mockConfig = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'ALIYUN_API_KEY': return 'test-api-key';
        case 'ALIYUN_BASE_URL': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        case 'MODEL_NAME': return 'deepseek-v4-flash-0731';
        default: return undefined;
      }
    }),
  } as any;

  const validInput = {
    question: '年假怎么申请？',
    context: ['员工可通过OA系统提交年假申请'],
    groundTruth: '年假通过OA系统申请，提前3个工作日提交。',
    answer: '通过OA系统申请年假，提前3个工作日提交。',
  };

  beforeEach(async () => {
    mockInvoke = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EvalScorerService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<EvalScorerService>(EvalScorerService);
    (service as any).llm = { invoke: mockInvoke };
  });

  it('应解析 LLM 返回的三维度结构化输出', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        relevancy: { value: 0.9, reason: '回答切题', missingPoints: [] },
        faithfulness: { value: 1, reason: '论断有据', missingPoints: [] },
        credibility: { value: 0.8, reason: '覆盖关键点', missingPoints: ['报销比例未提及'] },
      }),
    });

    const result = await service.score(validInput);

    expect(result.relevancy).toEqual({ name: 'relevancy', value: 0.9, reason: '回答切题', missingPoints: [] });
    expect(result.faithfulness.value).toBe(1);
    expect(result.credibility.missingPoints).toContain('报销比例未提及');
  });

  it('LLM 输出非 JSON 时抛错', async () => {
    mockInvoke.mockResolvedValue({ content: '抱歉，我无法评分' });
    await expect(service.score(validInput)).rejects.toThrow();
  });

  it('LLM 输出缺少字段时抛错（zod 校验失败）', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({ relevancy: { value: 0.5, reason: 'x' } }),
    });
    await expect(service.score(validInput)).rejects.toThrow();
  });

  it('LLM 调用抛错时向上传播', async () => {
    mockInvoke.mockRejectedValue(new Error('API 超时'));
    await expect(service.score(validInput)).rejects.toThrow('API 超时');
  });

  it('检索上下文为空时仍能评分', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        relevancy: { value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { value: 0.5, reason: '上下文为空，无法核验依据', missingPoints: [] },
        credibility: { value: 0.8, reason: '事实吻合', missingPoints: [] },
      }),
    });

    const result = await service.score({ ...validInput, context: [] });
    expect(result.faithfulness.value).toBe(0.5);
  });

  it('支持 ```json 代码围栏包裹的输出', async () => {
    mockInvoke.mockResolvedValue({
      content: '```json\n' + JSON.stringify({
        relevancy: { value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { value: 0.9, reason: '有据', missingPoints: [] },
        credibility: { value: 0.9, reason: '吻合', missingPoints: [] },
      }) + '\n```',
    });

    const result = await service.score(validInput);
    expect(result.credibility.value).toBe(0.9);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest src/modules/eval/eval-scorer.service.spec.ts`
Expected: FAIL — `Cannot find module './eval-scorer.service'`（实现文件不存在）。

- [ ] **Step 3: 写最小实现**

`apps/server/src/modules/eval/eval-scorer.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

export interface EvalScoreInput {
  question: string;
  context: string[];
  groundTruth: string;
  answer: string;
}

export interface DimensionScore {
  name: 'relevancy' | 'faithfulness' | 'credibility';
  value: number;
  reason: string;
  missingPoints: string[];
}

export interface EvalScoreResult {
  relevancy: DimensionScore;
  faithfulness: DimensionScore;
  credibility: DimensionScore;
}

const dimensionSchema = z.object({
  value: z.number().min(0).max(1),
  reason: z.string(),
  missingPoints: z.array(z.string()),
});

const evalOutputSchema = z.object({
  relevancy: dimensionSchema,
  faithfulness: dimensionSchema,
  credibility: dimensionSchema,
});

/** LLM 三维度评测器：对一条 RAG 回答，从相关性/忠实度/可信性三维度打分并说明差距 */
@Injectable()
export class EvalScorerService {
  private readonly logger = new Logger(EvalScorerService.name);
  protected llm: ChatOpenAI;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get('ALIYUN_API_KEY');
    const baseURL = this.config.get('ALIYUN_BASE_URL');
    this.llm = new ChatOpenAI({
      model: this.config.get('MODEL_NAME'),
      apiKey,
      configuration: { baseURL },
    });
  }

  /** 对一条回答进行三维度评分 */
  async score(input: EvalScoreInput): Promise<EvalScoreResult> {
    const { system, user } = this.buildPrompt(input);
    const res = await this.llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const parsed = evalOutputSchema.safeParse(this.extractJson(content));
    if (!parsed.success) {
      throw new Error(`评测输出非法（zod 校验失败）: ${parsed.error.message}`);
    }
    return {
      relevancy: { name: 'relevancy', ...parsed.data.relevancy },
      faithfulness: { name: 'faithfulness', ...parsed.data.faithfulness },
      credibility: { name: 'credibility', ...parsed.data.credibility },
    };
  }

  /** 从 LLM 输出中提取 JSON 对象（兼容 ```json 代码围栏） */
  private extractJson(content: string): unknown {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('评测输出中未找到 JSON');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }

  /** 构建评分提示词 */
  private buildPrompt(input: EvalScoreInput): { system: string; user: string } {
    const contextText = input.context.length > 0
      ? input.context.map((c, i) => `[${i + 1}] ${c}`).join('\n')
      : '（检索上下文为空）';

    const system = `你是一个严谨的 RAG 回答质量评估员。对给定的模型回答，从以下三个维度各评一个 0~1 分（保留两位小数），并给出理由与遗漏的关键点。

评分标准：
- relevancy（相关性）：回答是否切题、直接覆盖问题要点。高分=直接回应问题核心；低分=偏题或覆盖不足。
- faithfulness（忠实度）：回答的论断是否都能在检索上下文中找到依据、无编造。高分=每个论断有出处；低分=存在编造或无依据。若检索上下文为空，则按回答是否无中生有判断。
- credibility（可信性）：回答与标准答案的关键事实点是否吻合、是否可验证。高分=关键事实一致且可查；低分=遗漏关键点或与标准答案矛盾。

只输出 JSON，不要输出其他任何内容：
{
  "relevancy": {"value": 0.00, "reason": "评分理由", "missingPoints": ["遗漏或偏题的关键点"]},
  "faithfulness": {"value": 0.00, "reason": "评分理由", "missingPoints": ["编造或无依据的论断"]},
  "credibility": {"value": 0.00, "reason": "评分理由", "missingPoints": ["与标准答案对比遗漏或错误的事实点"]}
}`;

    const user = `【问题】
${input.question}

【检索上下文】
${contextText}

【标准答案】
${input.groundTruth}

【模型回答】
${input.answer}`;

    return { system, user };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest src/modules/eval/eval-scorer.service.spec.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
cd /d/project/knowledge-base-rag
git add apps/server/src/modules/eval/eval-scorer.service.ts apps/server/src/modules/eval/eval-scorer.service.spec.ts
git commit -m "feat: 新增 EvalScorerService LLM 三维度评测器"
```

---

### Task 2: RAGService.queryWithContext

**Files:**
- Modify: `apps/server/src/modules/rag/rag.service.ts`（`query()` 后新增方法 + 文件顶部模块级 `stripSourcesTag` 函数）
- Test: `apps/server/src/modules/rag/rag.service.spec.ts`（追加 describe 块）

**Interfaces:**
- Consumes: 现有 `query()` 的模式（`createLangfuseHandler`、`graph.invoke`）
- Produces: `queryWithContext(userMessage, userId, sessionId, extraCallbacks?): Promise<{ answer: string; retrievedChunks: string[]; traceId?: string }>`（Task 3 使用）

- [ ] **Step 1: 写失败测试**

在 `apps/server/src/modules/rag/rag.service.spec.ts` 末尾（`describe('createLangfuseHandler')` 之后）追加：

```ts
describe('queryWithContext', () => {
  it('应返回剥离 SOURCES 标签的答案与检索上下文', async () => {
    const mockInvoke = jest.fn().mockResolvedValue({
      finalAnswer: '年假通过OA系统申请。\n<!-- SOURCES:[{"index":1}] -->',
      retrievedChunks: [
        { chunk_text: '员工可通过OA系统提交年假申请', score: 0.9 },
        { chunk_text: '提前3个工作日提交', score: 0.8 },
      ],
    });
    (service as any).graph = { invoke: mockInvoke };

    const result = await service.queryWithContext('年假怎么申请？', 'user-1', 'session-1');

    expect(result.answer).toBe('年假通过OA系统申请。');
    expect(result.retrievedChunks).toEqual([
      '员工可通过OA系统提交年假申请',
      '提前3个工作日提交',
    ]);
    expect(mockInvoke).toHaveBeenCalled();
  });

  it('无 SOURCES 标签时原样返回答案', async () => {
    const mockInvoke = jest.fn().mockResolvedValue({
      finalAnswer: '直接回答',
      retrievedChunks: [],
    });
    (service as any).graph = { invoke: mockInvoke };

    const result = await service.queryWithContext('你好', 'user-1', 'session-1');

    expect(result.answer).toBe('直接回答');
    expect(result.retrievedChunks).toEqual([]);
  });

  it('应透传外部 CallbackHandler 的 traceId', async () => {
    const mockInvoke = jest.fn().mockResolvedValue({
      finalAnswer: '回答',
      retrievedChunks: [],
    });
    (service as any).graph = { invoke: mockInvoke };
    const fakeHandler = { last_trace_id: 'trace-abc' } as any;

    const result = await service.queryWithContext('Q', 'user-1', 'session-1', [fakeHandler]);

    expect(result.traceId).toBe('trace-abc');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest src/modules/rag/rag.service.spec.ts`
Expected: FAIL — `service.queryWithContext is not a function`。

- [ ] **Step 3: 写实现**

在 `apps/server/src/modules/rag/rag.service.ts` 顶部（import 之后）新增模块级函数：

```ts
/** 剥离 finalAnswer 末尾的 <!-- SOURCES:... --> 标签 */
function stripSourcesTag(text: string): string {
  const idx = text.indexOf('<!-- SOURCES:');
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}
```

在 `query()` 方法之后新增：

```ts
/** 评测专用：跑一次 RAG，额外返回检索上下文（供忠实度/可信度评分），并剥离 SOURCES 标签 */
async queryWithContext(
  userMessage: string,
  userId: string,
  sessionId: string,
  extraCallbacks?: CallbackHandler[],
): Promise<{ answer: string; retrievedChunks: string[]; traceId?: string }> {
  const langfuseHandler = this.createLangfuseHandler({ userId, sessionId });

  const callbacks = [...(extraCallbacks || [])];
  if (langfuseHandler) {
    callbacks.push(langfuseHandler);
  }

  const result = await this.graph.invoke(
    { messages: [new HumanMessage(userMessage)], userId, sessionId },
    { callbacks: callbacks.length > 0 ? callbacks : [] },
  );

  const traceId = extraCallbacks?.[0]?.last_trace_id || undefined;
  return {
    answer: stripSourcesTag(result.finalAnswer),
    retrievedChunks: (result.retrievedChunks || []).map((c: any) => c.chunk_text),
    traceId,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest src/modules/rag/rag.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /d/project/knowledge-base-rag
git add apps/server/src/modules/rag/rag.service.ts apps/server/src/modules/rag/rag.service.spec.ts
git commit -m "feat: RAGService 新增 queryWithContext 返回检索上下文"
```

---

### Task 3: 编排器重写 runEvaluationWithProgress

**Files:**
- Modify: `apps/server/src/modules/rag/langfuse-eval.service.ts`（构造注入 `EvalScorerService`、重写 `runEvaluationWithProgress`）
- Modify: `apps/server/src/modules/eval/eval.module.ts`（注册 `EvalScorerService` provider）
- Test: `apps/server/src/modules/rag/langfuse-eval.service.spec.ts`（注入 mock EvalScorerService、mock 改 `queryWithContext`、删 `runEvaluation` 测试、更新断言）

**Interfaces:**
- Consumes: `EvalScorerService.score()`（Task 1）、`RAGService.queryWithContext()`（Task 2）
- Produces: 重写后的 `runEvaluationWithProgress(datasetNameOrId, options?)`（行为不变：逐条跑 RAG + 三维度评分 + 推送实验 run + 失败不中断）

- [ ] **Step 1: 先改依赖注入与模块注册**

`apps/server/src/modules/eval/eval.module.ts` 的 providers 加 `EvalScorerService`：

```ts
providers: [ExcelParserService, EvalScorerService, LangfuseEvalService, EvalUploadCommand, EvalRunCommand],
```

`apps/server/src/modules/rag/langfuse-eval.service.ts` 构造注入 `EvalScorerService`（import `EvalScorerService` from `'../eval/eval-scorer.service'`）：

```ts
constructor(
  private langfuseService: LangfuseService,
  private ragService: RAGService,
  private excelParser: ExcelParserService,
  private evalScorer: EvalScorerService,
) {}
```

- [ ] **Step 2: 重写 runEvaluationWithProgress**

保留 `runEvaluationWithProgress` 开头的「找 dataset → 取 items」与批量延迟、外层的失败记录；将方法体中间的「逐条处理」替换为：

```ts
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);

  for (let j = 0; j < batch.length; j++) {
    const item = batch[j];
    const index = i + j + 1;
    const question = (item.input as any)?.question || '';
    const groundTruth = (item.expectedOutput as any)?.answer || '';

    try {
      // 1. 跑 RAG（带 evalHandler 产生 trace）
      const evalHandler = new CallbackHandler({
        userId: 'eval-user',
        sessionId: `eval-${resolvedDatasetId}-${item.id}`,
        tags: [`datasetId:${resolvedDatasetId}`, `datasetItemId:${item.id}`],
        traceMetadata: {
          datasetId: resolvedDatasetId,
          datasetItemId: item.id,
          datasetName: targetDataset!.name,
          evalRun: true,
        },
      });

      let generatedAnswer = '';
      let retrievedChunks: string[] = [];
      let queryTraceId: string | undefined;
      try {
        const result = await this.ragService.queryWithContext(
          question,
          'eval-user',
          `eval-${resolvedDatasetId}-${item.id}`,
          [evalHandler],
        );
        generatedAnswer = result.answer;
        retrievedChunks = result.retrievedChunks;
        queryTraceId = result.traceId;
      } catch (ragError: any) {
        this.logger.warn(`RAG 执行失败 [${index}]: ${ragError.message}`);
        generatedAnswer = `[RAG Error] ${ragError.message.slice(0, 200)}`;
      }

      // 2. LLM 三维度评分
      const evalResult = await this.evalScorer.score({
        question,
        context: retrievedChunks,
        groundTruth,
        answer: generatedAnswer,
      });

      // 3. 关联实验 run（traceId 为空时跳过，不影响评分）
      let datasetRunId: string | undefined;
      const runItemTraceId =
        queryTraceId ||
        (evalHandler.last_trace_id &&
        evalHandler.last_trace_id !== '00000000-0000-0000-0000-000000000000'
          ? evalHandler.last_trace_id
          : undefined);
      if (runItemTraceId) {
        try {
          const runItem = await (client as any).datasetRunItems.create({
            runName: targetDataset!.name,
            datasetItemId: item.id,
            traceId: runItemTraceId,
          });
          datasetRunId = runItem.datasetRunId;
        } catch (runItemError: any) {
          this.logger.warn(`DatasetRunItem 创建失败: ${(runItemError as Error).message}`);
        }
      }

      // 4. 按维度推送 score（comment=理由，metadata=遗漏点）
      const dimensions = [evalResult.relevancy, evalResult.faithfulness, evalResult.credibility];
      for (const dim of dimensions) {
        try {
          const scoreTarget: any = {
            name: dim.name,
            value: dim.value,
            datasetRunId,
            comment: dim.reason,
            metadata: { missingPoints: dim.missingPoints },
          };
          await (client as any).scores.create(scoreTarget);
        } catch (scoreError: any) {
          this.logger.warn(`创建 score 失败 [${index}] ${dim.name}: ${(scoreError as Error).message}`);
        }
      }

      scores.push({
        itemId: item.id,
        scores: dimensions.map((d) => ({ name: d.name, value: d.value, comment: d.reason })),
      });

      const scoreStr = dimensions.map((s) => `${s.name}=${s.value.toFixed(2)}`).join(', ');
      console.log(`[${index}/${items.length}] ${question.substring(0, 30)}... | ${scoreStr}`);
    } catch (error) {
      this.logger.error(`评测失败 [${index}/${items.length}]: ${(error as Error).message}`);
      scores.push({ itemId: item.id, scores: [] });
    }
  }

  // 每批结束后短暂延迟（防止限流）
  if (i + batchSize < items.length) {
    await this.delay(1000);
  }
}
```

同时删除 `runEvaluationWithProgress` 内的 `ingestion.batch` 建 trace 整段（原步骤 204-241 行）与 `console.log('[DEBUG] Eval ...')`。

- [ ] **Step 3: 更新 spec**

`apps/server/src/modules/rag/langfuse-eval.service.spec.ts`：
- import 增加 `EvalScorerService`
- `mockRagService` 改为 `{ queryWithContext: jest.fn() }`
- 新增 `mockEvalScorer = { score: jest.fn() } as any`
- providers 增加 `{ provide: EvalScorerService, useValue: mockEvalScorer }`
- 各测试的 `mockRagService.query` 改为 `mockRagService.queryWithContext`，`mockResolvedValue({ answer })` 改为 `mockResolvedValue({ answer, retrievedChunks: [], traceId: 'trace-1' })`
- `mockClient` 增加 `datasetRunItems: { create: jest.fn().mockResolvedValue({ id: 'run-item-1', datasetRunId: 'run-1' }) }`
- 每个 runEvaluationWithProgress 测试加 `mockEvalScorer.score.mockResolvedValue({...三维度...})`
- 删除 `describe('runEvaluation')` 整个块（方法已删除）

`runEvaluationWithProgress` 各测试新增的 mock 片段（放在现有 `mockLangfuseService.getClient.mockReturnValue(mockClient as any)` 之后）：

```ts
mockRagService.queryWithContext.mockResolvedValue({
  answer: 'generated answer',
  retrievedChunks: ['上下文1', '上下文2'],
  traceId: 'trace-1',
});
mockEvalScorer.score.mockResolvedValue({
  relevancy: { name: 'relevancy', value: 0.9, reason: '切题', missingPoints: [] },
  faithfulness: { name: 'faithfulness', value: 0.8, reason: '有据', missingPoints: [] },
  credibility: { name: 'credibility', value: 0.7, reason: '覆盖关键点', missingPoints: ['未提及报销比例'] },
});
```

更新后的断言示例（"应该分批执行评测并返回评分结果"）：

```ts
const result = await service.runEvaluationWithProgress('dataset-123', { batchSize: 2 });

expect(mockRagService.queryWithContext).toHaveBeenCalledTimes(3);
expect(mockEvalScorer.score).toHaveBeenCalledTimes(3);
expect(mockClient.datasetRunItems.create).toHaveBeenCalledTimes(3);
expect(mockClient.scores.create).toHaveBeenCalledTimes(9); // 3 用例 × 3 维度
expect(mockClient.scores.create).toHaveBeenCalledWith(expect.objectContaining({
  name: 'credibility',
  value: 0.7,
  datasetRunId: 'run-1',
  comment: '覆盖关键点',
  metadata: { missingPoints: ['未提及报销比例'] },
}));
expect(result.evaluatedCount).toBe(3);
expect(result.scores).toHaveLength(3);
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest src/modules/rag/langfuse-eval.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /d/project/knowledge-base-rag
git add apps/server/src/modules/rag/langfuse-eval.service.ts apps/server/src/modules/eval/eval.module.ts apps/server/src/modules/rag/langfuse-eval.service.spec.ts
git commit -m "refactor: 重写评测编排，接入 LLM 三维度评分"
```

---

### Task 4: 删除废弃代码 + 全量验证

**Files:**
- Modify: `apps/server/src/modules/rag/langfuse-eval.service.ts`（删除废弃方法）
- Modify: `apps/server/src/modules/rag/langfuse-eval.service.spec.ts`（删除对应测试）

**Interfaces:**
- 无新增；仅删除已无引用的代码

- [ ] **Step 1: 删除废弃方法与启发式评分**

从 `apps/server/src/modules/rag/langfuse-eval.service.ts` 删除：
- `runEvaluation(datasetNameOrId)` 整个方法（带 `@deprecated` 注释）
- 启发式评分全套私有方法：`evaluateAnswer`、`calculateRelevancy`、`calculateFaithfulness`、`getNgrams`、`getBigrams`
- 保留：`delay()`、`TestCase`/`EvaluationResult`/`DatasetUploadResult` 接口、`uploadDataset`/`uploadDatasetFromExcel`/`runEvaluationWithProgress`

删除后 `langfuse-eval.service.spec.ts` 中若仍有 `runEvaluation` 相关测试一并删除（Task 3 已删）。

- [ ] **Step 2: 全量运行测试**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx jest`
Expected: 全绿（含 Task 1-3 新增用例）。

- [ ] **Step 3: 构建验证**

Run: `cd /d/project/knowledge-base-rag/apps/server && npx nest build`
Expected: 退出码 0，无类型错误（tsconfig.build.json 已排除 specs 与 src/test）。

- [ ] **Step 4: Commit**

```bash
cd /d/project/knowledge-base-rag
git add apps/server/src/modules/rag/langfuse-eval.service.ts apps/server/src/modules/rag/langfuse-eval.service.spec.ts
git commit -m "refactor: 删除废弃评测方法（runEvaluation/启发式评分）"
```

---

## Self-Review

**Spec 覆盖：**
- 评测集上传与解析 → 保留 `uploadDataset`/`uploadDatasetFromExcel`/`ExcelParserService`（未改动，Task 4 确认保留）✅
- 逐条执行 RAG 实验 → Task 2 `queryWithContext` + Task 3 编排 ✅
- 相关性/忠实度/可信性评分 → Task 1 EvalScorerService（三维度含 reason + missingPoints）✅
- 结果推送 LangFuse 实验页 → Task 3 `datasetRunItems.create` + `scores.create`（comment + metadata）✅
- 单条失败不中断 → Task 3 内层 catch 保留 ✅

**Placeholder 扫描：** 所有代码步骤含完整可运行代码，无 TBD/TODO。

**类型一致性：** `EvalScoreInput`/`EvalScoreResult`/`DimensionScore` 在 Task 1 定义、Task 3 使用；`queryWithContext` 返回签名 Task 2 定义、Task 3 使用；`scores.create` 字段（name/value/datasetRunId/comment/metadata）三处一致。
