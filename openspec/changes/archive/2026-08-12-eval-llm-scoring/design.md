## Context

现有评测由 `LangfuseEvalService.runEvaluationWithProgress`（约 200 行）承担：手动 `ingestion.batch` 创建 trace、创建 DatasetRunItem、启发式评分、推送 score 全挤在一个方法里，并遗留废弃的 `runEvaluation()` 和 2 维启发式评分（ngram 字符重叠，无法解释差距）。评测集格式已稳定（`评测集.xlsx`：`问题` + `参考答案` + `需要检索到的文档` + `类型`，20 条）。`RAGService.query()` 仅返回答案；`graph.invoke()` 的返回 state 中已含 `retrievedChunks`。LangFuse v5 的 `datasetRunItems.create({runName, datasetItemId, traceId})` 与 `scores.create({name, value, datasetRunId, comment})` 是可用的实验 run 可写路径；`client.experiments` 只有只读方法（创建需走 OTel trace 属性），不采用。见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- LLM 三维度（相关性/忠实度/可信性）评判，输出分数 + 理由 + 遗漏关键点，回答"差距在哪"
- 评测流程拆分为职责清晰的单元，可独立单测
- 忠实度以「检索上下文」为依据，可信性以「标准答案」为依据
- 结果推送到 LangFuse 实验页（Dataset Run + Score，理由在 comment、遗漏点在 metadata）

**Non-Goals:**
- 不使用 LangFuse Experiments API（只读，创建需 OTel trace 属性，风险高）
- 不引入独立评判模型配置（复用主模型 `MODEL_NAME`）
- 不改变评测集 Excel 格式与 CLI 命令入口
- 不新增数据库表/前端页面；评测结果仅存 LangFuse，不落本地

## Decisions

**D1. `EvalScorerService` 独立模块（`modules/eval/eval-scorer.service.ts`）**
纯 LLM 评判器，不依赖 LangFuse；输入 `{question, context[], groundTruth, answer}`，输出三维度 `{value, reason, missingPoints}`。放 eval 模块，注入 `ConfigService` 自建 `ChatOpenAI`（同主模型）。替代方案：内嵌在 `LangfuseEvalService` 的私有方法——被否决，职责混杂、难单测（此前即如此）。

**D2. 一次 LLM 调用出三维度 + `invoke` + `zod.safeParse` 解析**
一次调用省 token/延迟；用 zod 定义输出 schema（`zod` v4 已依赖），`llm.invoke()` 后从输出提取 JSON 经 `zod.safeParse` 校验。备选 `withStructuredOutput` 依赖 `bindTools`（工具调用协议），对 dashscope compatible mode 有兼容风险，不采用。

**D3. `RAGService.queryWithContext()` 评测专用**
仿 `query()` 走同一 graph，额外返回 `retrievedChunks`（state 已含）并剥离 `finalAnswer` 末尾的 `<!-- SOURCES:... -->` 标签。不修改 graph。

**D4. 编排器瘦身为薄流程**
`LangfuseEvalService.runEvaluationWithProgress` 重写为：取 Dataset 用例 → 逐条跑 `queryWithContext`（带 evalHandler 产生 trace）→ `scorer.score` → `datasetRunItems.create` 关联实验 run → 按维度 `scores.create`（comment=理由，metadata={missingPoints}）。删除：`runEvaluation()`、手动 `ingestion.batch`、启发式评分全套。保留：`uploadDataset`/`uploadDatasetFromExcel`、批量限流延迟、CLI 命令。

**D5. 失败处理**
单条用例外层 try/catch：RAG 失败 → 记录失败项并继续；评分失败（LLM 抛错/输出非法）→ 该条 `scores` 记失败，不中断。与现有"失败也记录，避免跳过"行为一致。

**D6. 单测策略**
`EvalScorerService`：mock `ChatOpenAI`，覆盖正常解析、zod 校验失败降级、LLM 抛错降级、context 为空时忠实度边界。`LangfuseEvalService`：mock `queryWithContext` 与 `EvalScorerService`，验证编排顺序、失败不中断、推送 score 次数。

## Risks / Trade-offs

- **LLM 评判成本**：20 条用例 × 1 次评判调用，token 成本比启发式高；可接受（复用主模型，无额外配置）。
- **评判质量依赖模型**：复用主模型 deepseek-v4-flash，三维度一致性可能弱于专用评判模型；设计上以强约束 prompt + zod schema 缓解。
- **检索上下文为空**：RAG 降级（`searchDegraded`）时 `retrievedChunks` 为空，忠实度评分需特殊处理（LLM 应判"无依据可核"而非凭空评分）。
- **trace 关联失败**：`datasetRunItems.create` 失败时该用例分数无法展示在实验页，按现有行为记录 warning 并跳过 run 关联，分数仍创建。
