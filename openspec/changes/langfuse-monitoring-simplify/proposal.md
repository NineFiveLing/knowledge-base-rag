## Why

当前 Langfuse 监控配置较复杂：`instrumentation.ts` 使用 `OTLPTraceExporter`（依赖 `OTEL_EXPORTER_OTLP_ENDPOINT`）并手动罗列 4 个 instrumentation 实例，`LangfuseService` 同时封装 REST Client 与 `getCallbackHandler()`，再由 `rag.service.ts` 逐处调用。目标是改为官网推荐的 `@opentelemetry/sdk-node` + `LangfuseSpanProcessor` 自动插桩写法，密钥直接配置在 SpanProcessor 上，保证 RAG/LLM 追踪落入指定项目，最终只关注一次 RAG 查询的完整链路。

## What Changes

1. **重写 `apps/server/src/instrumentation.ts`**：`NodeSDK` + `LangfuseSpanProcessor({ publicKey, secretKey, baseUrl, environment })` + `getNodeAutoInstrumentations()`；移除 `OTEL_EXPORTER_OTLP_ENDPOINT` 依赖与手动 instrumentation 列表
2. **精简 `LangfuseService`**：移除 `getCallbackHandler()` 与 `initialized` 标志，仅保留评测用 REST client（`getClient()`）
3. **`rag.service.ts` 内联创建 CallbackHandler**：新增 `createLangfuseHandler()` 私有辅助方法，`query()`/`streamQuery()` 改用；移除对 `LangfuseService` 的注入
4. **`rag.module.ts`**：移除 `ObservabilityModule` 导入
5. **升级 OTel 依赖到 v2**：新增 `@langfuse/otel@^5.10.0` 与 `@opentelemetry/auto-instrumentations-node`；升级 `@opentelemetry/sdk-node` → v2；移除 `@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/resources`、`@opentelemetry/semantic-conventions` 及 4 个 `instrumentation-*` 包
6. **`.env.example` 清理**：移除 `OTEL_*` 变量
7. **测试更新**：`instrumentation.spec.ts` / `langfuse.service.spec.ts` / `rag.service.spec.ts` / `observability.module.spec.ts`

## Capabilities

### New Capabilities

- `langfuse-otel-tracing`: 通过单个 `@opentelemetry/sdk-node` + `LangfuseSpanProcessor` 统一导出 RAG/LLM 完整追踪（密钥配置于 SpanProcessor，归属指定项目）；自动插桩采集基础设施 span 但默认过滤，不在 Langfuse 展示

### Modified Capabilities

<!-- 根 openspec/specs/ 尚无已归档能力（langfuse-integration 的能力仍处 change 作用域、未 promote），故本变更仅声明新能力 -->

## Impact

- **修改文件**：`apps/server/src/instrumentation.ts`、`apps/server/src/common/observability/langfuse.service.ts`、`apps/server/src/modules/rag/rag.service.ts`、`apps/server/src/modules/rag/rag.module.ts`、`apps/server/package.json`、`.env.example`、`apps/server/src/instrumentation.spec.ts`、`apps/server/src/common/observability/langfuse.service.spec.ts`、`apps/server/src/common/observability/observability.module.spec.ts`、`apps/server/src/modules/rag/rag.service.spec.ts`
- **依赖变更**：新增 `@langfuse/otel`（^5.10.0）、`@opentelemetry/auto-instrumentations-node`；升级 `@opentelemetry/sdk-node` → v2；移除 7 个 OTel v1 包
- **运行期行为**：一次 RAG 查询在 Langfuse 指定项目生成一条完整 trace（节点链 + 全部大模型调用 + 工具调用）；基础设施 span（HTTP/PG/Redis）不再出现在 Langfuse（默认过滤生效）；未配置 `LANGFUSE_PUBLIC_KEY` 时优雅降级
