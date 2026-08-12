## 1. EvalScorerService（LLM 三维度评判器）

- [ ] 1.1 定义 zod 输出 schema 与 `EvalScoreInput` / `EvalScoreResult` 类型（`relevancy`/`faithfulness`/`credibility` 各含 `value: number(0~1)`、`reason: string`、`missingPoints: string[]`）
- [ ] 1.2 实现 `EvalScorerService.score()`：复用主模型（`ConfigService` 读 `ALIYUN_*`/`MODEL_NAME` 自建 `ChatOpenAI`），一次 `invoke` 返回三维度 JSON，`zod.safeParse` 校验，失败抛错由上层降级
- [ ] 1.3 编写单测（mock `ChatOpenAI`）：覆盖正常结构化输出解析、zod 校验失败降级、LLM 调用抛错降级、context 为空时忠实度边界

## 2. RAG 评测支持

- [ ] 2.1 实现 `RAGService.queryWithContext()`：仿 `query()` 走同一 graph，额外返回 `retrievedChunks`（取自 state），剥离 `finalAnswer` 末尾 `<!-- SOURCES:... -->` 标签
- [ ] 2.2 编写 `queryWithContext` 测试（mock graph，验证返回结构、SOURCES 剥离、traceId 透传）

## 3. 编排器重构

- [ ] 3.1 重写 `LangfuseEvalService.runEvaluationWithProgress`：取 Dataset 用例 → 逐条 `queryWithContext`（带 evalHandler）→ `EvalScorer.score` → `datasetRunItems.create` 关联实验 run → 按维度 `scores.create`（comment=理由、metadata={missingPoints}）→ 单条失败不中断
- [ ] 3.2 删除 `runEvaluation()`、手动 `ingestion.batch` 建 trace 逻辑、启发式评分全套（`evaluateAnswer`/`calculateRelevancy`/`calculateFaithfulness`/`getNgrams`/`getBigrams`）
- [ ] 3.3 更新 `langfuse-eval.service.spec.ts`：mock 从 `query` 改为 `queryWithContext`，注入 mock `EvalScorerService`，验证编排顺序、失败不中断、score 推送次数与字段

## 4. 模块接线与验证

- [ ] 4.1 `eval.module.ts` 注册 `EvalScorerService` provider（`LangfuseEvalService` 依赖注入）
- [ ] 4.2 全量 Jest 测试通过（`cd apps/server && npx jest`）+ `nest build` 通过
