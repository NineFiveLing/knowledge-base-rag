# 评测集上传与 LLM Judge 自动评分方案

> 创建时间: 2026-08-07
> 状态: 待批准

---

## 1. 背景与目标

### 1.1 问题陈述

当前项目存在以下问题：
- ❌ `LangfuseService.getClient()` 返回配置对象而非真正的 LangFuse Client，导致 `LangfuseEvalService` 无法调用 Dataset/Score API
- ❌ 评分逻辑过于简单（Bigram Jaccard + 关键词匹配），无法准确评估 RAG 质量
- ❌ 没有从 Excel 评测集上传到 LangFuse 的自动化流程
- ❌ 没有 CLI 命令触发评测

### 1.2 目标

1. **修复 LangFuse Client 初始化**：确保 `LangfuseService.getClient()` 返回真正的 `Langfuse` 实例
2. **实现 Excel 评测集上传**：读取 `评测集.xlsx`，转换为 TestCase 格式，上传到 LangFuse Dataset
3. **集成 LLM-as-a-Judge 评分**：使用项目已有的 LLM（阿里云百炼）进行多维度评分
4. **创建 Experiment Run**：每次评测生成一个 Experiment，支持在 LangFuse UI 对比分析
5. **提供 CLI 命令**：支持 `npm run eval:upload` 和 `npm run eval:run`

---

## 2. 技术方案

### 2.1 架构设计

```
ExcelParser (新增)
    ↓ 读取评测集.xlsx
    ↓ 转换为 TestCase[]
LangfuseEvalService (增强)
    ↓ uploadDatasetFromExcel()
    ↓ 创建 LangFuse Dataset
    ↓ uploadItems()
    ↓ runEvaluationWithExperiment()
    ↓ 创建 Experiment Run
    ↓ 遍历 Dataset Items
    ↓ 调用 RAG Pipeline
    ↓ LLM Judge 评分
    ↓ 推送 Scores 到 LangFuse
LangFuse UI
    ↓ 查看 Experiment 评分
    ↓ 对比历史实验
```

### 2.2 核心组件

#### 2.2.1 ExcelParser (新增)

**文件**: `apps/server/src/modules/eval/excel-parser.service.ts`

**职责**:
- 读取 Excel 文件（使用 `xlsx` 库）
- 解析列映射（支持中英文列名）
- 数据验证（必填字段、类型检查）
- 转换为 `TestCase[]` 格式

**接口**:
```typescript
export interface ParsedTestCase {
  question: string;
  groundTruth: string;
  groundTruthContexts: string[];
  category: string;
  expectedRetrieved: boolean;
  metadata: Record<string, any>;
}

@Injectable()
export class ExcelParserService {
  parse(filePath: string): Promise<ParsedTestCase[]>
}
```

**列映射**:
| Excel 列 | 映射 | 必填 |
|---------|------|-----|
| `question(问题)` | `question` | ✅ |
| `ground_truth(参考答案)` | `groundTruth` | ✅ |
| `ground_truth_contexts(需要检索到的文档)` | `groundTruthContexts` | ❌ |
| `category(类型)` | `category` | ❌ |
| `expected_retrieved` | `expectedRetrieved` | ❌ |

#### 2.2.2 LangfuseService (修复)

**文件**: `apps/server/src/common/observability/langfuse.service.ts`

**修改**:
1. 添加 `Langfuse` 类型导入（`@langfuse/core`）
2. 在 `initClient()` 中初始化真正的 `Langfuse` 实例
3. 修改 `getClient()` 返回 `Langfuse | null`

**代码示例**:
```typescript
import { Langfuse } from "@langfuse/core";

@Injectable()
export class LangfuseService implements OnModuleInit {
  private langfuseClient: Langfuse | null = null;
  
  private initClient() {
    const publicKey = this.config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.config.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl = this.config.get<string>('LANGFUSE_BASE_URL');

    if (!publicKey || !secretKey) {
      this.logger.warn('LangFuse not initialized: missing keys');
      return;
    }

    this.langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: baseUrl || undefined,
    });
    this.initialized = true;
  }

  getClient(): Langfuse | null {
    return this.langfuseClient;
  }
}
```

#### 2.2.3 LangfuseEvalService (增强)

**文件**: `apps/server/src/modules/rag/langfuse-eval.service.ts`

**新增方法**:
1. `uploadDatasetFromExcel(filePath: string, datasetName: string)` - 从 Excel 上传
2. `evaluateAnswerWithLLM(question, expected, generated)` - LLM Judge 评分
3. `runEvaluationWithExperiment(datasetId, options)` - 创建 Experiment Run 并评测

**修改方法**:
- `runEvaluation()` → 重命名为 `runEvaluationWithExperiment()` 并增强

**LLM Judge Prompt 设计**:
```typescript
private async evaluateAnswerWithLLM(
  question: string,
  expected: string,
  generated: string,
  contexts?: string[],
): Promise<Score[]> {
  const prompt = `你是一个专业的 RAG 评测专家。请根据以下信息对生成答案进行评分。

## 问题
${question}

## 期望答案（参考答案）
${expected}

## 生成答案（待评测）
${generated}

${contexts ? `## 检索到的文档\n${contexts.join('\n\n')}` : ''}

## 评分维度（0-1分）

1. **answer-relevancy（答案相关性）**
   - 0分：完全无关
   - 0.5分：部分相关
   - 1分：精准回答问题

2. **faithfulness（忠实度）**
   - 0分：与参考答案矛盾
   - 0.5分：核心信息一致但有遗漏/偏差
   - 1分：完全忠实于参考答案

3. **completeness（完整性）**
   - 0分：缺失关键信息
   - 0.5分：覆盖主要信息但有遗漏
   - 1分：信息完整

## 输出格式

以 JSON 格式返回，不要添加其他内容：
{
  "scores": [
    {"name": "answer-relevancy", "value": 0.9, "comment": "精准回答了年假申请流程"},
    {"name": "faithfulness", "value": 0.85, "comment": "核心信息一致，但缺少天数计算细节"},
    {"name": "completeness", "value": 0.8, "comment": "涵盖了申请步骤，但未提及审批时效"}
  ]
}`;

  const response = await this.llm.invoke([new HumanMessage(prompt)]);
  // 解析 JSON
}
```

**Experiment Run 创建**:
```typescript
const experimentRun = await client.experiment.createRun({
  datasetId,
  name: `eval-${new Date().toISOString().split('T')[0]}`,
  metadata: {
    model: this.config.get('MODEL_NAME'),
    description: 'RAG Pipeline Evaluation with LLM Judge',
  },
});
```

#### 2.2.4 CLI Commander (新增)

**文件**: `apps/server/src/modules/eval/eval.command.ts`

**命令设计**:
```bash
# 上传评测集（不评测）
npm run eval:upload -- --file=评测集.xlsx --name=my-eval-dataset

# 上传并评测
npm run eval:run -- --file=评测集.xlsx --name=my-eval-dataset

# 仅评测已有 Dataset
npm run eval:run -- --dataset-id=cmf7xxxxxx
```

**参数**:
- `--file` (string): Excel 文件路径（默认: `../../评测集.xlsx`）
- `--name` (string): Dataset 名称（默认: `rag-eval-YYYY-MM-DD`）
- `--dataset-id` (string): 已有的 Dataset ID（跳过上传）
- `--batch-size` (number): 批量大小（默认: 5，防止 LLM 限流）
- `--skip-llm-judge` (boolean): 跳过 LLM Judge（仅规则评分）

**依赖**:
- `commander` (或 `nest-commander`)

### 2.3 Module 结构

```
EvalModule
├── ExcelParserService
├── LangfuseEvalService (已存在，增强)
└── EvalCommand (CLI)
```

**EvalModule** 需要导入:
- `RAGModule` (依赖 `RAGService`)
- `ObservabilityModule` (依赖 `LangfuseService`)

---

## 3. 实现步骤

### Phase 1: 修复 LangFuse Client

**文件**: `apps/server/src/common/observability/langfuse.service.ts`

**变更**:
1. 导入 `Langfuse` from `@langfuse/core`
2. 添加 `private langfuseClient: Langfuse | null = null;`
3. 在 `initClient()` 中初始化 `new Langfuse({...})`
4. 修改 `getClient()` 返回类型为 `Langfuse | null`

**测试**: 更新 `langfuse.service.spec.ts` mock

---

### Phase 2: 实现 ExcelParser

**文件**: `apps/server/src/modules/eval/excel-parser.service.ts`

**步骤**:
1. 定义 `ParsedTestCase` 接口
2. 使用 `xlsx` 库读取 Excel
3. 实现列名匹配（支持模糊匹配，容错）
4. 数据验证与转换
5. 编写单元测试 `excel-parser.service.spec.ts`

---

### Phase 3: 增强 LangfuseEvalService

**文件**: `apps/server/src/modules/rag/langfuse-eval.service.ts`

**变更**:
1. 新增 `uploadDatasetFromExcel()`
2. 新增 `evaluateAnswerWithLLM()`
3. 重写 `runEvaluation()` → `runEvaluationWithExperiment()`
4. 保留原有规则评分作为 fallback
5. 添加实验性功能：retrieval precision 评分

**测试**: 更新 `langfuse-eval.service.spec.ts`

---

### Phase 4: 创建 CLI 命令

**文件**: `apps/server/src/modules/eval/eval.command.ts`

**步骤**:
1. 定义 `EvalCommand` 类
2. 实现 `upload` 命令
3. 实现 `run` 命令
4. 彩色输出（成功/失败统计）
5. 错误处理（优雅降级）

**package.json 添加脚本**:
```json
{
  "scripts": {
    "eval:upload": "nest eval upload",
    "eval:run": "nest eval run"
  }
}
```

---

### Phase 5: 集成测试

**测试用例**:
1. 从 Excel 读取评测集 → 验证 TestCase 数量
2. 上传到 LangFuse → 验证 Dataset 创建成功
3. 执行评测 → 验证 Scores 推送成功
4. 在 LangFuse UI 手动验证 Experiment 可见性

---

## 4. 依赖新增

| 依赖 | 版本 | 用途 |
|------|------|------|
| `commander` | ^12.0.0 | CLI 命令框架 |
| `chalk` | ^5.3.0 | 彩色终端输出 |

---

## 5. 风险与缓解

| 风险 | 缓解方案 |
|------|---------|
| LangFuse API 限流 | 批量控制（batch-size），添加延迟 |
| LLM Judge 成本 | 支持 `--skip-llm-judge` 仅规则评分 |
| Excel 格式错误 | 列名模糊匹配 + 友好错误提示 |
| LangFuse Client 初始化失败 | 环境检查 + 降级提示 |

---

## 6. 验证标准

✅ **功能验证**:
- [ ] Excel 解析正确（20 条用例全部识别）
- [ ] Dataset 上传成功（LangFuse UI 可见）
- [ ] Experiment Run 创建成功
- [ ] LLM Judge 评分推送成功（LangFuse Scores 可见）
- [ ] CLI 命令执行无报错

✅ **质量验证**:
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] LLM Judge Prompt 中文友好
- [ ] 错误处理完整（Excel 不存在、LangFuse 连接失败等）

✅ **性能验证**:
- [ ] 20 条评测完成时间 < 10 分钟（考虑 LLM 延迟）

---

## 7. 文件变更清单

### 7.1 修改文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `apps/server/src/common/observability/langfuse.service.ts` | 修改 | 修复 Client 初始化 |
| `apps/server/src/modules/rag/langfuse-eval.service.ts` | 修改 | 增强评测逻辑 |
| `apps/server/package.json` | 修改 | 新增依赖 + 脚本 |
| `apps/server/src/app.module.ts` | 修改 | 导入 EvalModule |
| `apps/server/src/common/observability/langfuse.service.spec.ts` | 修改 | 更新 Mock |
| `apps/server/src/modules/rag/langfuse-eval.service.spec.ts` | 修改 | 更新测试 |

### 7.2 新增文件

| 文件 | 说明 |
|------|------|
| `apps/server/src/modules/eval/excel-parser.service.ts` | Excel 解析服务 |
| `apps/server/src/modules/eval/excel-parser.service.spec.ts` | 单元测试 |
| `apps/server/src/modules/eval/eval.command.ts` | CLI 命令 |
| `apps/server/src/modules/eval/eval.module.ts` | Module 定义 |
| `apps/server/src/modules/eval/README.md` | 使用文档 |

---

## 8. 后续优化（可选）

- [ ] 支持 JSON/YAML 格式评测集
- [ ] 增量评测（仅评测失败的用例）
- [ ] 多 Experiment 对比 CLI 命令
- [ ] 评分结果导出（CSV/Excel）
- [ ] Web UI 触发评测（Admin API）
