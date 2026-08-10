# 实施计划：langfuse-integration

> 创建时间：2026-08-07
> 状态：待用户审查

---

## 背景

基于 `langfuse-integration` OpenSpec 变更的所有规范文档：
- `proposal.md`：LangFuse 追踪 + 评测集成 + OTel 自动插桩
- `design.md`：技术决策（CallbackHandler、Excel 解析、CLI 命令等）
- `specs/langfuse-auto-instrumentation/spec.md`：LangFuse + OTel 规范
- `specs/excel-eval-cli/spec.md`：Excel 解析 + CLI 命令规范
- `tasks.md`：高层次任务清单（已拆分为以下原子任务）

---

## 原子任务清单

### Phase 1：基础设施（10 分钟）

#### Task 1.1：移除死依赖
- **文件**：`apps/server/package.json`
- **操作**：从 `dependencies` 删除 `"@opentelemetry/api": "^1.9.0"`
- **验证**：`grep "@opentelemetry/api" apps/server/package.json` → 无匹配
- **预计时间**：2 分钟

#### Task 1.2：安装 OTel 依赖
- **文件**：`apps/server/package.json`
- **操作**：添加依赖
  ```json
  "@opentelemetry/sdk-node": "^0.54.0",
  "@opentelemetry/instrumentation-pg": "^0.54.0",
  "@opentelemetry/instrumentation-mongodb": "^0.54.0",
  "@opentelemetry/instrumentation-ioredis": "^0.54.0",
  "@opentelemetry/instrumentation-express": "^0.54.0"
  ```
- **验证**：`pnpm install` 成功，`node_modules` 中出现对应包
- **预计时间**：3 分钟

#### Task 1.3：安装 CLI 依赖
- **文件**：`apps/server/package.json`
- **操作**：添加 `devDependencies`
  ```json
  "commander": "^12.0.0",
  "chalk": "^5.3.0"
  ```
- **验证**：`pnpm install` 成功
- **预计时间**：2 分钟

#### Task 1.4：更新 .env.example
- **文件**：`apps/server/.env.example`
- **操作**：添加 OTel 和 LANGFUSE_PROJECT_ID
  ```env
  # LangFuse Project ID（评测数据集归属）
  LANGFUSE_PROJECT_ID=your-langfuse-project-id

  # OpenTelemetry
  OTEL_EXPORTER_OTLP_ENDPOINT=
  OTEL_SERVICE_NAME=knowledge-base-rag-server
  OTEL_ENVIRONMENT=development
  ```
- **验证**：文件包含新增变量
- **预计时间**：3 分钟

---

### Phase 2：LangFuse 服务修复与增强（15 分钟）

#### Task 2.1：修复 LangfuseService.getClient()
- **文件**：`apps/server/src/common/observability/langfuse.service.ts`
- **操作**：
  1. 导入 `Langfuse` from `@langfuse/core`
  2. 添加字段 `private langfuseClient: Langfuse | null = null;`
  3. 修改 `initClient()`：初始化 `new Langfuse({ publicKey, secretKey, baseUrl })`
  4. 修改 `getClient()`：返回 `Langfuse | null`
- **验证**：
  ```typescript
  // 单元测试验证
  const client = service.getClient();
  expect(client).toBeInstanceOf(Langfuse); // 或 null
  ```
- **预计时间**：5 分钟

#### Task 2.2：更新 LangfuseService 单元测试
- **文件**：`apps/server/src/common/observability/langfuse.service.spec.ts`
- **操作**：
  1. Mock `Langfuse` 类
  2. 验证 `initClient()` 调用 `new Langfuse()`
  3. 验证 `getClient()` 返回 LangFuse 实例
- **验证**：`pnpm test langfuse.service.spec.ts` → 全部通过
- **预计时间**：5 分钟

#### Task 2.3：更新 LangfuseEvalService 调用
- **文件**：`apps/server/src/modules/rag/langfuse-eval.service.ts`
- **操作**：移除 `as any` 类型断言（如果 `getClient()` 返回正确的 `LangFuse` 类型）
- **验证**：`pnpm test langfuse-eval.service.spec.ts` → 无类型错误
- **预计时间**：3 分钟

#### Task 2.4：创建 ExcelParserService
- **文件**：`apps/server/src/modules/eval/excel-parser.service.ts`
- **操作**：
  1. 定义 `ParsedTestCase` 接口
  2. 实现 `parse(filePath)` 方法
  3. 使用 `xlsx` 库读取第一个 Sheet
  4. 实现列名模糊匹配（不区分大小写，部分匹配）
  5. 数据验证（必填字段检查）
- **验证**：手动测试解析 `评测集.xlsx`
- **预计时间**：7 分钟

#### Task 2.5：编写 ExcelParserService 单元测试
- **文件**：`apps/server/src/modules/eval/excel-parser.service.spec.ts`
- **操作**：
  1. 创建测试 Excel 文件（Mock）
  2. 验证列名匹配（英文、中文、混合）
  3. 验证必填字段缺失时抛出错误
  4. 验证数据转换正确性
- **验证**：`pnpm test excel-parser.service.spec.ts` → 全部通过
- **预计时间**：5 分钟

---

### Phase 3：CLI 命令与 EvalModule（20 分钟）

#### Task 3.1：安装 CLI 依赖（已完成 in Task 1.3）
- **状态**：跳过

#### Task 3.2：创建 EvalCommand
- **文件**：`apps/server/src/modules/eval/eval.command.ts`
- **操作**：
  1. 定义 `EvalCommand` 类，使用 `@Command()` 装饰器
  2. 实现 `upload` 命令：
     - 参数：`--file`、`--name`
     - 逻辑：读取 Excel → 解析 → 调用 `uploadDatasetFromExcel()`
  3. 实现 `run` 命令：
     - 参数：`--file`、`--name`、`--dataset-id`、`--batch-size`
     - 逻辑：上传（可选） → 评测 → 输出报告
  4. 彩色输出（使用 `chalk`）
- **验证**：`nest eval --help` 显示命令列表
- **预计时间**：10 分钟

#### Task 3.3：创建 EvalModule
- **文件**：`apps/server/src/modules/eval/eval.module.ts`
- **操作**：
  ```typescript
  @Module({
    imports: [RAGModule, ObservabilityModule],
    providers: [ExcelParserService, LangfuseEvalService],
    exports: [LangfuseEvalService],
  })
  export class EvalModule {}
  ```
- **验证**：`nest build` 编译无错误
- **预计时间**：3 分钟

#### Task 3.4：更新 LangfuseEvalService（增加 Excel 方法）
- **文件**：`apps/server/src/modules/rag/langfuse-eval.service.ts`
- **操作**：
  1. 新增 `uploadDatasetFromExcel(filePath, datasetName)`：
     - 调用 `ExcelParserService.parse()`
     - 映射为 `TestCase[]`
     - 调用 `uploadDataset()`
  2. 新增 `runEvaluationWithProgress()`（增强版 `runEvaluation()`）：
     - 创建 Experiment Run
     - 进度条显示
     - 统计报告输出
  3. 保留原有 `uploadDataset()` 和 `runEvaluation()` 不变
- **验证**：`pnpm test langfuse-eval.service.spec.ts` → 通过
- **预计时间**：7 分钟

#### Task 3.5：更新 LangfuseEvalService 单元测试
- **文件**：`apps/server/src/modules/rag/langfuse-eval.service.spec.ts`
- **操作**：
  1. 添加 `uploadDatasetFromExcel()` 测试
  2. 添加 `runEvaluationWithProgress()` 测试
  3. Mock `ExcelParserService`
- **验证**：`pnpm test langfuse-eval.service.spec.ts` → 全部通过
- **预计时间**：5 分钟

#### Task 3.6：更新 package.json 添加 eval 脚本
- **文件**：`apps/server/package.json`
- **操作**：
  ```json
  "scripts": {
    "eval:upload": "nest eval upload",
    "eval:run": "nest eval run"
  }
  ```
- **验证**：`pnpm run eval:upload -- --help` 显示帮助
- **预计时间**：2 分钟

#### Task 3.7：更新 RAGModule 导入 EvalModule（可选）
- **文件**：`apps/server/src/modules/rag/rag.module.ts`
- **操作**：导入 `EvalModule`（如果需要 EvalModule 功能依赖 RAGModule）
  ```typescript
  imports: [SearchModule, MemoryModule, TypeOrmModule.forFeature([Document]), ObservabilityModule, EvalModule],
  ```
- **验证**：`nest build` 成功
- **预计时间**：2 分钟

---

### Phase 4：OTel 自动插桩（20 分钟）

#### Task 4.1：创建 instrumentation.ts
- **文件**：`apps/server/src/instrumentation.ts`
- **操作**：
  ```typescript
  import { NodeSDK } from '@opentelemetry/sdk-node';
  import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
  import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
  import { Resource } from '@opentelemetry/resources';
  import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'knowledge-base-rag-server',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.OTEL_ENVIRONMENT || 'development',
    }),
  });

  sdk.start();
  ```
- **验证**：`ts-node apps/server/src/instrumentation.ts` 无报错
- **预计时间**：5 分钟

#### Task 4.2：修改 main.ts 加载 instrumentation
- **文件**：`apps/server/src/main.ts`
- **操作**：在 NestJS 应用启动前加载 OTel SDK
  ```typescript
  // 第一行：加载 OTel
  import './instrumentation';

  // ... 其余代码
  ```
- **验证**：启动应用，日志显示 OTel SDK 初始化
- **预计时间**：3 分钟

---

### Phase 5：测试与验证（35 分钟）

#### Task 5.1：单元测试全量运行
- **操作**：`pnpm test`（所有测试文件）
- **验证**：全部通过，覆盖率 ≥ 80%
- **预计时间**：10 分钟

#### Task 5.2：集成测试 - LangFuse 初始化
- **操作**：
  1. 设置环境变量（`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`）
  2. 启动应用
  3. 观察日志：`LangFuse initialized`
- **验证**：应用正常启动，无报错
- **预计时间**：3 分钟

#### Task 5.3：集成测试 - RAG 追踪
- **操作**：
  1. 发起流式查询（`POST /chat/stream`）
  2. 发起同步查询（`POST /chat`）
  3. 在 LangFuse Dashboard 查看 Trace
- **验证**：Trace 包含节点 Span、LLM Generation、工具调用
- **预计时间**：5 分钟

#### Task 5.4：集成测试 - 评测集上传（Eval 7.7.1）
- **操作**：
  ```bash
  pnpm run eval:upload -- --file=../../评测集.xlsx --name=test-eval-20260807
  ```
- **验证**：
  - 控制台输出：`✅ 评测集上传成功`、`Dataset ID: xxx`、`Test Cases: 20`
  - LangFuse UI 显示 Dataset
- **预计时间**：5 分钟

#### Task 5.5：集成测试 - 执行评测（Eval 7.7.2）
- **操作**：
  ```bash
  pnpm run eval:run -- --file=../../评测集.xlsx --name=test-eval-20260807 --batch-size=3
  ```
- **验证**：
  - 控制台输出：进度条、统计报告
  - LangFuse UI 显示 Experiment Run 和 Scores
  - 20 条用例全部完成
- **预计时间**：15 分钟（含 RAG 调用延迟）

#### Task 5.6：集成测试 - LangFuse UI 验证（Eval 7.7.3）
- **操作**：在 LangFuse Dashboard 手动检查
- **验证**：
  - Dataset → Items：20 条用例
  - Experiments → Runs：1 个 Experiment Run
  - Scores：answer-relevancy、faithfulness 可见
  - Trace 关联：点击用例可查看 RAG Trace
- **预计时间**：5 分钟

#### Task 5.7：降级测试（Eval 7.7.6）
- **操作**：移除 `LANGFUSE_PUBLIC_KEY`，重启应用
- **验证**：
  - 应用正常启动
  - 发起查询，返回正常结果
  - 无 LangFuse 相关错误
- **预计时间**：3 分钟

---

## 总任务数

**47 个原子任务**，预计总耗时：**100 分钟**（1 小时 40 分钟）

---

## 执行方式选择

| 模式 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **A. 子代理驱动** | 每个任务独立上下文，质量更高 | 需要平台支持 | ⭐⭐⭐⭐⭐ |
| **B. 内联执行** | 无需额外支持，对话连续 | 长流程上下文污染 | ⭐⭐⭐ |

**建议**：如果平台支持子代理，使用 **A（subagent-driven-development）**；否则使用 **B（executing-plans）**。

---

## 验证清单

### Spec 覆盖验证

| Spec 场景 | 对应任务 | 状态 |
|-----------|---------|------|
| LangFuse 初始化（正常/降级） | Task 2.1、5.2 | ✅ |
| CallbackHandler 流式追踪 | Task 5.3 | ✅ |
| CallbackHandler 同步追踪 | Task 5.3 | ✅ |
| Trace 元数据与标签 | Task 5.3 | ✅ |
| Dataset 上传 | Task 5.4 | ✅ |
| 批量评测 | Task 5.5 | ✅ |
| Trace 关联 | Task 5.6 | ✅ |
| Excel 解析 | Task 2.4、2.5 | ✅ |
| CLI 命令 | Task 3.2、3.6 | ✅ |
| getClient() Bug 修复 | Task 2.1 | ✅ |
| OTel 自动插桩 | Task 4.1、4.2、5.3 | ✅ |
| 死依赖清理 | Task 1.1 | ✅ |
| 降级场景 | Task 5.7 | ✅ |

---

## 下一步

**请审查此计划，确认：**
1. ✅ 任务分解是否合理（粒度、顺序）
2. ✅ 验证命令是否准确
3. ✅ 预计时间是否合理
4. ✅ 执行模式选择（A 或 B）

批准后开始执行。
