## Why

现有评测流程复杂不清晰：`LangfuseEvalService.runEvaluationWithProgress` 是 200 行巨型方法，把 RAG 执行、手动创建 trace（ingestion.batch）、创建 DatasetRunItem、启发式评分、推送 score 全塞在一起，还遗留废弃的 `runEvaluation()`。评分只有 2 个维度（answer-relevancy / faithfulness），且用 ngram 字符重叠的启发式算法——无法解释"实际回答与标准答案的差距在哪里"，也没有用户新增的"可信性"维度。

## What Changes

- **新增** `EvalScorerService`：纯 LLM 三维度评判器，复用主模型，一次调用对每条回答输出 **relevancy（相关性）、faithfulness（忠实度）、credibility（可信性）** 三维度的分数 + 理由 + 遗漏关键点（missingPoints）。
  - 相关性：问题 vs 回答，是否切题
  - 忠实度：检索上下文 vs 回答，论断是否有出处、无编造
  - 可信性：标准答案 vs 回答，事实吻合 + 有据可查
- **新增** `RAGService.queryWithContext()`：评测专用，跑一次 RAG 返回 `{ answer, retrievedChunks }`（剥离 SOURCES 标签），供忠实度/可信性评分依据。
- **重构** `LangfuseEvalService` 编排流程：取 Dataset 用例 → 逐条跑 RAG（带上下文）→ LLM 三维度评分 → 关联实验 run → 推送 score（comment 带理由、metadata 带遗漏点）到 LangFuse 实验页。单条失败不中断。
- **删除**：废弃的 `runEvaluation()`、手动 `ingestion.batch` 建 trace 逻辑、启发式评分全套（`evaluateAnswer` / `calculateRelevancy` / `calculateFaithfulness` / `getNgrams` / `getBigrams`）。
- **保留**：Excel 评测集解析（`ExcelParserService`）、`uploadDataset` / `uploadDatasetFromExcel`、`eval-upload` / `eval-run` CLI 命令入口、批量限流延迟。
- 评分链路保持 `datasetRunItems.create`（LangFuse v5 实验 run 的可写路径），不引入只读的 Experiments API。

## Capabilities

### New Capabilities
- `eval-llm-scoring`: LLM 三维度评测能力——对评测集每条用例跑 RAG 实验，用 LLM 从相关性/忠实度/可信性三维度打分并输出差距说明，结果推送 LangFuse 实验页展示。

### Modified Capabilities
<!-- openspec/specs/ 下无已发布 spec，本次无修改 -->

## Impact

- **新增文件**: `apps/server/src/modules/eval/eval-scorer.service.ts`（LLM 评判器，可独立单测）
- **修改文件**:
  - `apps/server/src/modules/rag/rag.service.ts`（新增 `queryWithContext`）
  - `apps/server/src/modules/rag/langfuse-eval.service.ts`（重写编排、删废弃逻辑）
  - `apps/server/src/modules/eval/eval.module.ts`（注册 EvalScorerService provider）
  - `apps/server/src/modules/rag/langfuse-eval.service.spec.ts`（按新签名重写 mock）
- **不涉及**: 数据库、前端、Excel 评测集格式（`评测集.xlsx` 四列保持兼容）
- **依赖**: 复用已有 `@langchain/openai`（ChatOpenAI）、`@langfuse/core`（LangfuseAPIClient）、`zod`（输出校验），无新增依赖
