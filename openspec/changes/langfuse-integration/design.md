## Context

当前项目是一个 NestJS + LangGraph 的 Agentic RAG 系统，已安装 `@langfuse/core@5.10.0` 和 `@langfuse/langchain@^5.10.0`。RAG 管道通过 LangGraph StateGraph 实现，节点包括 intent_classifier、direct_answer、simple_retrieval、agent（ReAct 循环）、retrieval_tools、generate_answer。

`streamQuery()` 已在 `apps/server/src/modules/rag/rag.service.ts` 中使用了 `CallbackHandler`，但 `query()`（同步路径）未接入追踪，且没有统一的 LangFuse 服务封装。`.env.example` 已包含基础 LangFuse 环境变量，但缺少 `LANGFUSE_PROJECT_ID`（评测用）。

`@opentelemetry/api` 在 `package.json` 中列为直接依赖，但项目中**没有任何源文件直接 import 它**——纯粹是 langchain/langfuse 的传递依赖。

## Goals / Non-Goals

**Goals：**
- 基于 `@langfuse/langchain` 的 `CallbackHandler` 实现 LangGraph 管道的自动追踪（auto-instrumentation），不手动包装节点
- 同步 `query()` 和流式 `streamQuery()` 两条路径都完整接入追踪
- 提供统一的 NestJS `LangfuseService` 管理 Client 生命周期和 CallbackHandler 生成
- 集成 LangFuse Dataset + Evaluation API，支持将测试集传入 RAG 管道做批量评测
- 使用 `@opentelemetry/sdk-node` 自动追踪 NestJS HTTP 请求、数据库查询（PostgreSQL/MongoDB/Elasticsearch/Neo4j）、Redis 操作
- 从 `package.json` 移除无用的 `@opentelemetry/api` 直接依赖

**Non-Goals：**
- 不手动在每个节点内创建 `langfuse.span()` —— 完全依赖 CallbackHandler 的自动事件捕获
- 不在应用层做 prompt/ completions 脱敏（使用者自行评估合规性）
- 不实现自定义 Trace 导出或数据持久化到其他后端
- 不替换现有日志系统（NestJS Logger 保持，LangFuse 作为补充观测层）

## Decisions

### 1. 使用 CallbackHandler 自动插桩而非手动 Span

**决策**：追踪完全通过 `CallbackHandler` 实现，不在节点代码中手动调用 `langfuse.trace()` / `langfuse.span()`。

**理由**：`@langfuse/langchain` 的 `CallbackHandler` 配合 LangGraph 的 `streamEvents` v2 和 `invoke`，自动捕获节点执行、LLM 调用、工具调用事件并生成结构化 Trace。这是 LangFuse 官方推荐方式，代码侵入最小，且自动处理 trace/span 父子关系。

**替代方案**：在每个节点函数内手动 `langfuse.span()` 包装。**不考虑**——侵入性强，需在每个节点重复编写，且容易遗漏父子关系。

### 2. 新增 `LangfuseService` 统一管理 Client

**决策**：创建 `LangfuseService`（NestJS 单例，`onModuleInit` 初始化），对外提供 `getCallbackHandler(opts)` 方法。

**理由**：集中管理 LangFuse Client 生命周期，统一处理环境变量缺失时的优雅降级。`getCallbackHandler` 根据当前请求上下文（userId/sessionId/conversationId）生成带标签的 CallbackHandler 实例。

**结构**：
- `langfuse.service.ts`：Client 初始化、`getCallbackHandler()`、`shutdown()`
- `observability.module.ts`：NestJS Module，导出 `LangfuseService`

### 3. 同步路径通过 `graph.invoke()` 的 callbacks 接入

**决策**：`query()` 方法将 CallbackHandler 传入 `graph.invoke(state, { callbacks: [handler] })`。

**理由**：`invoke` 支持 callbacks 选项，CallbackHandler 自动捕获整个执行过程。与流式路径的 `streamEvents` 保持一致的追踪行为。

### 4. 评测使用 LangFuse Dataset + Evaluation API

**决策**：新增 `LangfuseEvalService`，封装 LangFuse 的 Dataset 和 Evaluation API，不自行实现评分逻辑。

**理由**：LangFuse 原生支持将测试用例集作为 Dataset 管理，并提供 Evaluation API 进行批量评分（answer-relevancy、faithfulness、context-recall 等）。直接使用官方 API 避免重复造轮子，评测结果可直接在 Dashboard 中查看。

**评测流程**：
1. `uploadDataset(name, testCases)` → 调用 LangFuse Dataset API 上传
2. `runEvaluation(datasetId, config)` → 遍历用例 → 调用 RAG 管道 → 调用 Evaluation API 评分
3. 结果写回 LangFuse，Dashboard 查看

### 7. 修复 LangfuseService.getClient() Bug

**决策**：`getClient()` 必须返回真正的 `Langfuse` 实例，而非配置对象。

**理由**：`LangfuseEvalService` 依赖 `getClient()` 返回 Client 实例以调用 Dataset/Score API。当前实现返回 `{publicKey, baseUrl}` 会导致运行时 TypeError。

**修复方案**：
```typescript
import { Langfuse } from "@langfuse/core";

private langfuseClient: Langfuse | null = null;

private initClient() {
  // ... 环境变量检查
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
```

### 8. 评测集 Excel 解析与 CLI 命令

**决策**：新增 `ExcelParserService` 和 `EvalCommand`，支持从 Excel 文件读取评测集并通过 CLI 触发上传和评测。

**理由**：用户提供评测集文件（如 `评测集.xlsx`），需要自动化工具将其上传到 LangFuse 并执行评测。CLI 命令提供灵活的手动触发方式，适合 CI/CD 集成和临时评测。

#### Excel 解析设计

**文件**：`apps/server/src/modules/eval/excel-parser.service.ts`

**接口**：
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

**列映射**（支持模糊匹配）：
| Excel 列 | 映射字段 | 必填 |
|---------|---------|------|
| `question(问题)` | `question` | ✅ |
| `ground_truth(参考答案)` | `groundTruth` | ✅ |
| `ground_truth_contexts(需要检索到的文档)` | `groundTruthContexts` | ❌ |
| `category(类型)` | `category` | ❌ |
| `expected_retrieved` | `expectedRetrieved` | ❌ |

**实现细节**：
- 使用 `xlsx` 库（已安装）读取 Excel
- 列名匹配采用不区分大小写的部分匹配（如 `"question"` 匹配 `"question(问题)"`）
- 数据验证：必填字段缺失时抛出友好错误
- 转换 `ground_truth_contexts` 为字符串数组（支持换行符或分号分隔）

#### CLI 命令设计

**文件**：`apps/server/src/modules/eval/eval.command.ts`

**命令**：
```bash
# 上传评测集（不评测）
npm run eval:upload -- --file=评测集.xlsx --name=my-eval-dataset

# 上传并评测
npm run eval:run -- --file=评测集.xlsx --name=my-eval-dataset

# 仅评测已有 Dataset
npm run eval:run -- --dataset-id=cmf7xxxxxx
```

**参数**：
- `--file` (string): Excel 文件路径（默认: `../../评测集.xlsx`）
- `--name` (string): Dataset 名称（默认: `rag-eval-YYYY-MM-DD`）
- `--dataset-id` (string): 已有的 Dataset ID（跳过上传）
- `--batch-size` (number): 批量大小（默认: 5，防止限流）
- `--skip-llm-judge` (boolean): 跳过 LLM Judge（保留给未来增强）

**依赖**：
- `commander`：CLI 框架
- `chalk`：彩色终端输出

**输出示例**：
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

#### EvalModule 设计

**文件**：`apps/server/src/modules/eval/eval.module.ts`

```typescript
@Module({
  imports: [RAGModule, ObservabilityModule],
  providers: [ExcelParserService, LangfuseEvalService],
  exports: [LangfuseEvalService],
})
export class EvalModule {}
```

**依赖关系**：
- `RAGModule`：提供 `RAGService` 用于执行评测
- `ObservabilityModule`：提供 `LangfuseService` 用于 LangFuse 交互

### 5. OpenTelemetry 自动插桩

**决策**：使用 `@opentelemetry/sdk-node` + 各框架 instrumentation 包，在 `apps/server/src/instrumentation.ts` 中注册自动插桩，在 `main.ts` 启动时加载。

**理由**：OpenTelemetry 自动插桩无需修改业务代码即可追踪 HTTP 请求、数据库查询、Redis 操作等基础设施层调用，与 LangFuse 的 LLM 层追踪形成互补。

**选型**：
- `@opentelemetry/sdk-node`：SDK 核心
- `@opentelemetry/instrumentation-pg`：PostgreSQL
- `@opentelemetry/instrumentation-mongodb`：MongoDB
- `@opentelemetry/instrumentation-ioredis`：Redis
- `@opentelemetry/instrumentation-express`：Express HTTP（NestJS 底层）
- Elasticsearch：无官方 OTel instrumentation 包，使用 `@elastic/elasticsearch` 客户端内置诊断追踪

**导出**：默认通过 OTLP 导出到 LangFuse（`OTEL_EXPORTER_OTLP_ENDPOINT` 指向 LangFuse OTLP 端点），也支持其他 OTLP 后端。

### 6. 移除 `@opentelemetry/api` 直接依赖

**决策**：从 `package.json` 的 `dependencies` 中移除 `@opentelemetry/api`。

**理由**：项目中没有任何 TypeScript 源文件直接 import `@opentelemetry/api`，该包仅作为 `@langchain/core`、`@langfuse/core` 等库的传递依赖存在。`@opentelemetry/sdk-node` 会自动安装 `@opentelemetry/api` 作为其依赖，因此移除后传递依赖链仍然完整。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| `streamEvents` v2 的事件格式变化导致 CallbackHandler 丢失节点信息 | 使用 `@langchain/langgraph` 稳定版本（当前 ^1.4.8），`streamEvents` v2 已稳定 |
| CallbackHandler 无法捕获自定义 metadata（如 intent、degraded） | intent 和 degraded 信息通过 Trace 的 `metadata` 在追踪开始前注入；若需更细粒度，后续可在生成节点前使用 `langfuse.updateTrace()` 补充 |
| 评测批量执行耗时较长，阻塞请求 | 评测任务通过 BullMQ 队列异步执行，不阻塞主查询流程 |
| LangFuse API 限流导致评测失败 | 评测脚本添加重试与速率控制，使用 LangFuse 官方 SDK 的 batch 接口 |
| 用户查询内容上传 LangFuse 的合规风险 | 使用者自行评估；如需脱敏，可在 CallbackHandler 回调中对 prompt/completion 做过滤 |
| OTel 自动插桩引入额外开销 | instrumentation 包设计为低开销（< 1ms per span），在生产环境可选择性关闭 |
| OTel 与 LangFuse 的 Trace 关联 | 通过 OTLP 统一导出到 LangFuse，LangFuse 自动关联 LLM Trace 与基础设施 Span |

## Migration Plan

1. **新增 `LangfuseService` 和 `ObservabilityModule`**：无依赖，独立开发
2. **新增 `instrumentation.ts` 和 OTel 依赖**：在 `main.ts` 中加载
3. **修改 `RAGService`**：
   - 注入 `LangfuseService`
   - `query()` 方法：获取 CallbackHandler，传入 `graph.invoke()` callbacks
   - `streamQuery()` 方法：使用 `LangfuseService.getCallbackHandler()` 替换手动的 `new CallbackHandler()`
4. **修改 `RAGModule`**：导入 `ObservabilityModule`
5. **修改 `package.json`**：移除 `@opentelemetry/api`，新增 `@opentelemetry/sdk-node` 及各 instrumentation 包
6. **修改 `.env.example`**：补充 `LANGFUSE_PROJECT_ID` 和 OTel 环境变量
7. **验证**：启动服务，发起测试查询，在 LangFuse Dashboard 确认 Trace 完整

**回滚**：移除 `ObservabilityModule` 导入，`getCallbackHandler()` 返回空数组，移除 `instrumentation.ts` 加载，不影响业务逻辑。

## Open Questions

- 评测任务的执行方式（同步/异步）取决于业务使用场景，可在 tasks 阶段确认是否通过 BullMQ 异步执行
- OTel 导出目标：是统一发到 LangFuse（OTLP），还是本地文件 / Jaeger 等其他后端，取决于现有基础设施
