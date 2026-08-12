## Context

现状（详见 proposal.md - Why）：追踪走两条链路——`instrumentation.ts` 用 `OTLPTraceExporter`（依赖 `OTEL_EXPORTER_OTLP_ENDPOINT`）手动罗列 express/pg/mongodb/ioredis 插桩；`LangfuseService` 同时封装评测用 REST client 与 `getCallbackHandler()`；`rag.service.ts` 逐处调用。

约束（已通过包源码与 lockfile 核实）：
- `@langfuse/langchain` 的 `CallbackHandler` 内部通过 `startAndRegisterOtelSpan` 生成 OTel span（作用域 `langfuse-sdk`），走全局 OTel provider。
- `@langfuse/otel@5.10.0` 的 `LangfuseSpanProcessor` 支持 `publicKey/secretKey/baseUrl/environment` 构造参数，默认过滤只导出 `langfuse-sdk` 作用域、`gen_ai.*` 属性与已知 LLM 插桩库的 span。
- `@langfuse/otel@5.10.0` 的 peer 依赖为 OTel v2（`@opentelemetry/core@^2`、`@opentelemetry/sdk-trace-base@^2`、`@opentelemetry/exporter-trace-otlp-http@>=0.202`），而项目直接依赖为 OTel v1（`0.54.x`）。OTel v2（`core@2.10.0`）已作为 Langfuse v5 栈的传递依赖存在于依赖树中。

## Goals / Non-Goals

**Goals:**
- 单一 `NodeSDK` + `LangfuseSpanProcessor` 统一导出 RAG/LLM 完整追踪，密钥配置在处理器上、归属指定项目。
- 移除 `OTEL_EXPORTER_OTLP_ENDPOINT` 依赖与手动 instrumentation 列表。
- 精简 `LangfuseService` 为仅评测 REST client。
- OTel 直接依赖对齐 v2。

**Non-Goals:**
- 评测（数据集 / 评估器 / 实验）——后续单独 change。
- 在 Langfuse 展示基础设施 span——默认过滤，符合"只关注大模型全流程"。
- 改动评测系统行为（`getClient()` 契约保持不变）。

## Decisions

### 1. 用 `LangfuseSpanProcessor` 替换 OTLP exporter

`instrumentation.ts` 改为 `NodeSDK({ spanProcessors: [new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl, environment })] , instrumentations: [getNodeAutoInstrumentations()] })`。密钥直接配置于处理器，导出归属由密钥所在项目决定；内置智能过滤恰好只导出 RAG/LLM span。

- 替代方案：保留 OTLP + 手动 Authorization header（需手配端点与鉴权，繁琐）；多处理器（复杂，无收益）。

### 2. 单一 NodeSDK 统一承接两种 span

`CallbackHandler` 产生的 `langfuse-sdk` span 与 `getNodeAutoInstrumentations()` 采集的基础设施 span 都走全局 OTel provider。前者被 `LangfuseSpanProcessor` 默认导出；后者被默认过滤。无需要双 provider / 双导出。

### 3. `LangfuseService` 精简为仅 REST client

`CallbackHandler` 读取环境变量即可工作，无需自定义 client。`getCallbackHandler()` 移除，追踪 handler 改由 `rag.service.ts` 内联创建。`getClient()` 保留，供 `LangfuseEvalService` 调用 Dataset / Score API。

### 4. `rag.service.ts` 内联 `createLangfuseHandler()`

新增私有辅助方法：环境变量守卫（无密钥返回 `null`），构建 `tags`（`userId`/`sessionId`/`conversationId`）与 `traceMetadata`，返回 `new CallbackHandler({...})`。`query()`/`streamQuery()` 改用；移除 `LangfuseService` 注入；`RAGModule` 移除 `ObservabilityModule`（`EvalModule` 仍自行引入，`LangfuseEvalService` 依赖不受影响）。

### 5. OTel 依赖升级到 v2

新增 `@langfuse/otel@^5.10.0`、`@opentelemetry/auto-instrumentations-node`（v2 兼容版）；升级 `@opentelemetry/sdk-node` → v2。移除 `@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/resources`、`@opentelemetry/semantic-conventions` 及 `instrumentation-express/pg/mongodb/ioredis`（由全家桶覆盖）。`@opentelemetry/api`/`core`/`sdk-trace-base`/`exporter-trace-otlp-http` 作为 `@langfuse/otel` peer 由 pnpm 自动解析。

### 6. 优雅降级以 `LANGFUSE_PUBLIC_KEY` 门控

`registerOTel()` 仅当 `LANGFUSE_PUBLIC_KEY` 非空时启动 SDK，保持现有"未配置即跳过"的契约。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| OTel v1 → v2 升级引入运行时差异 | 升级后验证服务启动 + 一次 RAG 查询 trace 完整；依赖由 pnpm 统一解析 |
| `getNodeAutoInstrumentations()` 全家桶可能引入多余插桩 | 官方推荐全家桶；若个别库冲突可退回显式 instrumentation 列表 |
| 基础设施 span 不再展示（相对当前 OTLP 行为的变化） | 属预期；后续需要时自定义 `shouldExportSpan` 一行开启 |
| 评测系统受影响 | `getClient()` 契约保留，`LangfuseEvalService` 依赖不变 |

## Migration Plan

1. 更新 `apps/server/package.json` 依赖并安装
2. 重写 `apps/server/src/instrumentation.ts`
3. 精简 `apps/server/src/common/observability/langfuse.service.ts`
4. 调整 `apps/server/src/modules/rag/rag.service.ts` 与 `rag.module.ts`
5. 清理 `.env.example` 的 `OTEL_*` 变量
6. 更新 4 个测试文件
7. 验证：启动服务 → 发起一次 RAG 查询 → Langfuse 指定项目确认完整 trace → 运行全量测试

**回滚**：恢复 `instrumentation.ts` 的 OTLP 写法、`LangfuseService.getCallbackHandler()` 与 `rag.service.ts` 原调用，业务逻辑不受影响。

## Open Questions

无。评测（数据集 / 评估器 / 实验）留作下一个 change。
