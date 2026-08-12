## 1. 依赖与配置

- [ ] 1.1 更新 `apps/server/package.json`：新增 `@langfuse/otel@^5.10.0`、`@opentelemetry/auto-instrumentations-node`（v2 兼容版）；升级 `@opentelemetry/sdk-node` → v2；移除 `@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/resources`、`@opentelemetry/semantic-conventions`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-pg`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-ioredis`
- [ ] 1.2 执行安装并确认 OTel v2 peer 依赖解析成功（无版本冲突）
- [ ] 1.3 清理 `.env.example`：移除 `OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_SERVICE_NAME`、`OTEL_ENVIRONMENT`，注明监控由 `LANGFUSE_*` 驱动

## 2. 核心实现

- [ ] 2.1 重写 `apps/server/src/instrumentation.ts`：`NodeSDK` + `LangfuseSpanProcessor({ publicKey, secretKey, baseUrl, environment })` + `getNodeAutoInstrumentations()`；以 `LANGFUSE_PUBLIC_KEY` 非空作为启动门控；保留 `shutdownOTel()`
- [ ] 2.2 精简 `apps/server/src/common/observability/langfuse.service.ts`：移除 `getCallbackHandler()` 与 `initialized` 标志，仅保留评测用 `LangfuseAPIClient` 的 `getClient()`
- [ ] 2.3 调整 `apps/server/src/modules/rag/rag.service.ts`：新增私有 `createLangfuseHandler()`（环境变量守卫 + tags/metadata 构建），`query()`/`streamQuery()` 改用，移除对 `LangfuseService` 的注入
- [ ] 2.4 调整 `apps/server/src/modules/rag/rag.module.ts`：移除 `ObservabilityModule` 导入

## 3. 测试更新

- [ ] 3.1 更新 `apps/server/src/instrumentation.spec.ts`：门控改为 `LANGFUSE_PUBLIC_KEY`
- [ ] 3.2 更新 `apps/server/src/common/observability/langfuse.service.spec.ts`：删除 `getCallbackHandler` 用例，保留 `getClient` 用例
- [ ] 3.3 更新 `apps/server/src/common/observability/observability.module.spec.ts`：删除 `getCallbackHandler` 断言
- [ ] 3.4 更新 `apps/server/src/modules/rag/rag.service.spec.ts`：移除 `langfuseService` mock，验证内联 handler 创建（有/无密钥）
- [ ] 3.5 运行 `apps/server` 全量测试并修复失败用例

## 4. 验证

- [ ] 4.1 启动服务并完成启动日志检查（无 Langfuse/OTel 报错）
- [ ] 4.2 发起一次 RAG 查询，在 Langfuse 指定项目确认出现一条完整 trace（节点链 + 全部大模型调用 + 工具调用）
- [ ] 4.3 未配置 `LANGFUSE_PUBLIC_KEY` 时验证优雅降级（服务正常运行，无异常）
- [ ] 4.4 `openspec validate --change langfuse-monitoring-simplify` 校验通过
