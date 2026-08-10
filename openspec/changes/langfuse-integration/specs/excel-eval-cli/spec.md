## Purpose

提供评测集 Excel 文件解析和 CLI 命令支持，实现从本地 Excel 文件自动上传评测集到 LangFuse Dataset，并通过命令行触发评测流程。

## ADDED Requirements

### Requirement: Excel 评测集解析

系统 SHALL 提供 `ExcelParserService`，支持读取 Excel 格式的评测集文件并转换为 `TestCase[]` 格式。Excel 文件应包含以下列（支持中英文列名和部分匹配）：

- **question(问题)**（必填）：用户问题
- **ground_truth(参考答案)**（必填）：期望的标准答案
- **ground_truth_contexts(需要检索到的文档)**（可选）：预期检索到的文档片段
- **category(类型)**（可选）：用例分类标签
- **expected_retrieved**（可选）：是否预期检索到内容（布尔值）

#### Scenario: 读取 Excel 评测集

- **WHEN** 调用 `ExcelParserService.parse(filePath)`
- **THEN** 返回 `ParsedTestCase[]` 数组，每个对象包含完整的字段映射

#### Scenario: 列名模糊匹配

- **WHEN** Excel 列名为 `"question(问题)"`（包含中文括号）
- **THEN** 成功匹配为 `question` 字段（不区分大小写，支持部分匹配）

#### Scenario: 必填字段验证

- **WHEN** Excel 中缺少 `question` 或 `ground_truth` 列
- **THEN** 抛出明确的错误信息，指出缺失的列名

### Requirement: CLI 评测命令

系统 SHALL 提供 CLI 命令，支持通过命令行触发评测集上传和评测流程。

**命令设计**：

```bash
# 仅上传评测集（不执行评测）
npm run eval:upload -- --file=评测集.xlsx --name=my-eval-dataset

# 上传并执行评测
npm run eval:run -- --file=评测集.xlsx --name=my-eval-dataset

# 对已有 Dataset 执行评测
npm run eval:run -- --dataset-id=cmf7xxxxxx
```

**参数**：
- `--file`：Excel 文件路径（默认: `../../评测集.xlsx`）
- `--name`：Dataset 名称（默认: `rag-eval-YYYY-MM-DD`）
- `--dataset-id`：已有 Dataset ID（跳过上传步骤）
- `--batch-size`：批量大小（默认: 5，防止 LLM 限流）

#### Scenario: 上传评测集

- **WHEN** 执行 `npm run eval:upload -- --file=评测集.xlsx --name=test-eval`
- **THEN** 系统读取 Excel，上传到 LangFuse Dataset，输出 Dataset ID 和用例数量

#### Scenario: 执行评测

- **WHEN** 执行 `npm run eval:run -- --file=评测集.xlsx --name=test-eval`
- **THEN** 系统依次完成：上传 Excel → 创建 Experiment Run → 遍历用例调用 RAG → 评分 → 输出统计报告

#### Scenario: 断点续跑

- **WHEN** 评测过程中出错（网络异常、API 限流等）
- **THEN** 系统跳过失败用例，继续执行剩余用例，最终报告包含失败统计

### Requirement: 评测输出报告

CLI 命令 SHALL 输出彩色格式的评测报告，包含以下内容：

```
✅ 评测集上传成功
   Dataset ID: cmf7xxxxxx
   Test Cases: 20

🚀 开始评测...

[1/20] ✅ 年假怎么申请？ | recall=0.75, faithfulness=0.80 | 234ms
[2/20] ✅ 你好 | recall=1.00, faithfulness=1.00 | 89ms
[3/20] ❌ WiFi 坏了找谁？ | recall=0.25, faithfulness=0.40 | 312ms

📊 评测结果汇总
   通过: 17/20 (85.0%)
   平均召回率: 0.78
   平均忠实度: 0.82
   平均延迟: 245ms
```

#### Scenario: 彩色输出

- **WHEN** CLI 输出评测进度和结果
- **THEN** 使用颜色区分状态（绿色=通过，红色=失败，黄色=警告）

### Requirement: LangfuseService.getClient() 正确实现

`LangfuseService.getClient()` SHALL 返回真正的 `LangFuse` 实例，而非配置对象。该实例用于 `LangfuseEvalService` 调用 Dataset 和 Score API。

#### Scenario: 返回 LangFuse Client

- **WHEN** 调用 `langfuseService.getClient()`
- **THEN** 返回 `LangFuse` 实例（或 `null` 如果未初始化），支持调用 `client.dataset.create()`、`client.score.create()` 等方法

#### Scenario: 优雅降级

- **WHEN** LangFuse 环境变量缺失
- **THEN** `getClient()` 返回 `null`，系统正常运行不报错

## ADDED Requirements (Future Enhancement)

### 待实现：LLM-as-a-Judge 评分（未来增强）

**当前阶段**：仅实现基础规则评分（keyword-recall、faithfulness）

**未来增强**：集成 LLM Judge 实现多维度评分（answer-relevancy、faithfulness、completeness），提升评分准确性和语义理解能力。

**触发条件**：基础规则评分验证通过后，根据实际需求决定是否升级。

### 待实现：增量评测（未来增强）

支持断点续跑，仅评测失败的用例，节省时间和成本。

### 待实现：多 Experiment 对比（未来增强）

CLI 支持对比多个 Experiment Run 的评分结果，生成对比报告。

## Non-Goals

- **当前阶段不实现**：LLM Judge 评分（保留为未来增强）
- **当前阶段不实现**：并行评测（多线程/多进程）
- **当前阶段不实现**：Excel 多 Sheet 支持（仅读取第一个 Sheet）
- **当前阶段不实现**：评测失败自动重试（可后续增强）
