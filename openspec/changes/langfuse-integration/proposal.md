## Why

项目已安装 `@langfuse/core` 和 `@langfuse/langchain`，但 LangFuse 追踪没有完整接入：
- 同步 `query()` 方法完全没有 CallbackHandler，不产生任何 Trace
- 流式 `streamQuery()` 虽然传了 `CallbackHandler`，但只传了 `sessionId` 和 `userId`，缺少 `conversationId` 等标签，也没有自定义 metadata
- 没有任何 LangFuse 初始化逻辑（Client 实例化），没有 Module 封装
- 没有任何评测集成，无法将测试集传入 Agentic RAG 做系统化评估
- `@opentelemetry/api` 在 `package.json` 中列为直接依赖，但项目中**没有任何文件直接 import 它**，属于死依赖
- 项目缺少基础设施层可观测性（HTTP 请求、数据库查询、Redis 调用等）

LangFuse 官方推荐的集成方式是**通过 CallbackHandler 自动插桩**（auto-instrumentation），由 SDK 自动捕获 LangGraph 图执行、LLM 调用、工具调用等事件，无需手动在每个节点写 span。OpenTelemetry 则负责基础设施层的自动追踪。

## What Changes

1. **新增 `LangfuseService`（NestJS 单例 Module）**：读取环境变量初始化 LangFuse Client，对外提供 `createTrace`、`getCallbackHandler` 方法，统一管理 userId / sessionId / conversationId 等标签
2. **完整接入 CallbackHandler**：
   - `streamQuery`：已有 CallbackHandler，补充 `conversationId` 和自定义 metadata
   - `query`（同步路径）：新增 CallbackHandler 接入，通过 `graph.invoke` 的 callbacks 选项传入
3. **LangGraph `streamEvents` v2 自动追踪**：LangFuse 的 CallbackHandler 配合 `streamEvents` 自动生成 Trace + 节点 Span + LLM Generation，零额外代码
4. **OpenTelemetry 自动插桩**：使用 `@opentelemetry/sdk-node` 自动追踪 NestJS HTTP 请求、数据库查询（PostgreSQL/MongoDB/Elasticsearch/Neo4j）、Redis 操作，与 LangFuse LLM 追踪互补
5. **评测集成（LangFuse Dataset + Evaluation API）**：新增 `LangfuseEvalService`，支持将测试用例集上传为 LangFuse Dataset，对 Agentic RAG 运行评测并上传评分结果
6. **清理死依赖**：从 `package.json` 中移除 `@opentelemetry/api`（无直接使用）
7. **环境变量补全**：`.env.example` 补充 `LANGFUSE_PROJECT_ID`（评测数据集归属项目）

## Capabilities

### New Capabilities

- `langfuse-auto-instrumentation`：基于 LangFuse 官方 CallbackHandler 的自动插桩追踪与评测集成
- `opentelemetry-auto-instrumentation`：基于 `@opentelemetry/sdk-node` 的基础设施层自动追踪

## Impact

- **新增文件**：`apps/server/src/common/observability/langfuse.service.ts`、`apps/server/src/common/observability/observability.module.ts`、`apps/server/src/modules/rag/langfuse-eval.service.ts`、`apps/server/src/instrumentation.ts`（OTel 自动插桩入口）
- **修改文件**：`apps/server/src/modules/rag/rag.service.ts`（初始化 LangfuseService、同步路径接入 CallbackHandler、流式路径补充 metadata）、`apps/server/src/modules/rag/rag.module.ts`（导入 ObservabilityModule）、`apps/server/src/main.ts`（OTel SDK 初始化）、`apps/server/package.json`（移除 `@opentelemetry/api`、新增 `@opentelemetry/sdk-node`）、`apps/server/.env.example`（补充 LANGFUSE_PROJECT_ID）
- **依赖变更**：移除 `@opentelemetry/api`（^1.9.0），新增 `@opentelemetry/sdk-node`（^0.54.x 或最新版）
- **运行期行为**：每次 RAG 查询在 LangFuse Dashboard 中生成完整 Trace；每次 HTTP 请求在 LangFuse/OTel 后端生成 Trace，包含数据库查询 Span
