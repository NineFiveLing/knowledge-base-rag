## 1. 清理死依赖

- [ ] 1.1 从 `apps/server/package.json` 移除 `@opentelemetry/api`（无直接使用，纯传递依赖）

## 2. OpenTelemetry 自动插桩

- [ ] 2.1 安装依赖：`@opentelemetry/sdk-node`、`@opentelemetry/instrumentation-pg`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-ioredis`、`@opentelemetry/instrumentation-elasticsearch`、`@opentelemetry/instrumentation-express`
- [ ] 2.2 创建 `apps/server/src/instrumentation.ts`：注册各 instrumentation 自动插桩，配置 OTLP 导出到 LangFuse
- [ ] 2.3 修改 `apps/server/src/main.ts`：在 NestJS 应用启动前加载 OTel SDK
- [ ] 2.4 更新 `apps/server/.env.example`：补充 OTel 环境变量（`OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_SERVICE_NAME`、`OTEL_ENVIRONMENT`）

## 3. LangFuse 服务基础设施

- [ ] 3.1 创建 `apps/server/src/common/observability/langfuse.service.ts`：LangfuseService 单例，onModuleInit 读取环境变量初始化 LangFuse Client，提供 `getCallbackHandler({ userId, sessionId, conversationId })` 方法和 `shutdown()`
- [ ] 3.2 创建 `apps/server/src/common/observability/observability.module.ts`：NestJS Module，提供 `LangfuseService`，导出供其他模块导入
- [ ] 3.3 更新 `apps/server/.env.example`：补充 `LANGFUSE_PROJECT_ID` 环境变量说明

## 3.5 修复 LangfuseService.getClient() Bug

- [ ] 3.5.1 导入 `Langfuse` 类型（`@langfuse/core`）
- [ ] 3.5.2 添加私有字段 `langfuseClient: Langfuse | null = null`
- [ ] 3.5.3 在 `initClient()` 中初始化 `new Langfuse({ publicKey, secretKey, baseUrl })`
- [ ] 3.5.4 修改 `getClient()` 返回类型为 `Langfuse | null`
- [ ] 3.5.5 更新 `langfuse.service.spec.ts` mock，确保测试覆盖 Client 初始化

## 4. RAGService 接入 CallbackHandler

- [ ] 4.1 注入 `LangfuseService` 到 `RAGService` 构造函数
- [ ] 4.2 修改 `streamQuery()` 方法：使用 `langfuseService.getCallbackHandler()` 替换手动的 `new CallbackHandler()`，补充 `conversationId` 和 metadata
- [ ] 4.3 修改 `query()` 方法：获取 CallbackHandler，通过 `graph.invoke(state, { callbacks: [handler] })` 传入，实现同步路径追踪
- [ ] 4.4 处理 CallbackHandler 返回 null 的降级场景（两条路径都需兼容）

## 5. 模块注册与导入

- [ ] 5.1 修改 `apps/server/src/modules/rag/rag.module.ts`：导入 `ObservabilityModule`
- [ ] 5.2 验证 `AppModule` 无需额外修改（ObservabilityModule 通过 RAGModule 间接导入）

## 6. 评测服务集成

### 6.1 LangfuseEvalService（已有，需增强）

- [ ] 6.1.1 实现 `uploadDataset`：调用 LangFuse Dataset API 上传测试用例（input, expectedOutput, expectedRetrievalContext）
- [ ] 6.1.2 实现 `runEvaluation`：遍历 Dataset 用例 → 调用 `RAGService.query()` → 调用 LangFuse Evaluation API 评分 → 写回结果
- [ ] 6.1.3 评测任务异步化（通过 BullMQ），不阻塞主查询流程
- [ ] 6.1.4 添加 `uploadDatasetFromExcel()` 方法（预留接口，供 EvalModule 调用）

### 6.2 Excel 解析器（新增）

- [ ] 6.2.1 创建 `apps/server/src/modules/eval/excel-parser.service.ts`：ExcelParserService
- [ ] 6.2.2 实现 `parse(filePath: string): Promise<ParsedTestCase[]>` 方法
- [ ] 6.2.3 列名模糊匹配（不区分大小写，支持中英文）
- [ ] 6.2.4 数据验证（必填字段缺失时抛出友好错误）
- [ ] 6.2.5 编写单元测试 `excel-parser.service.spec.ts`

### 6.3 CLI 命令（新增）

- [ ] 6.3.1 安装依赖：`commander`、`chalk`
- [ ] 6.3.2 创建 `apps/server/src/modules/eval/eval.command.ts`：EvalCommand
- [ ] 6.3.3 实现 `upload` 命令：读取 Excel → 解析 → 调用 `LangfuseEvalService.uploadDatasetFromExcel()`
- [ ] 6.3.4 实现 `run` 命令：上传（可选） → 执行评测 → 输出报告
- [ ] 6.3.5 彩色输出（成功/失败统计、进度条）
- [ ] 6.3.6 错误处理（Excel 不存在、LangFuse 连接失败等）
- [ ] 6.3.7 更新 `apps/server/package.json`：添加 `eval:upload` 和 `eval:run` 脚本

### 6.4 EvalModule（新增）

- [ ] 6.4.1 创建 `apps/server/src/modules/eval/eval.module.ts`：导入 RAGModule、ObservabilityModule，提供 ExcelParserService、LangfuseEvalService
- [ ] 6.4.2 更新 `apps/server/src/app.module.ts`：导入 EvalModule（可选，若需要 CLI 访问）

## 7. 验证

- [ ] 7.1 启动应用，确认 OTel SDK 和 LangFuse Client 初始化成功（有有效环境变量时）
- [ ] 7.2 发起 HTTP 请求，在 LangFuse Dashboard 确认 OTel HTTP Span 存在
- [ ] 7.3 发起流式查询，在 LangFuse Dashboard 确认 Trace 完整（节点 Span + LLM Generation + 工具调用）
- [ ] 7.4 发起同步查询，在 LangFuse Dashboard 确认 Trace 完整
- [ ] 7.5 执行评测脚本，确认测试用例上传成功且评分结果可查
- [ ] 7.6 移除 LangFuse 环境变量，确认系统正常运行不报错（优雅降级）

### 7.7 评测功能专项验证

- [ ] 7.7.1 执行 `npm run eval:upload -- --file=评测集.xlsx --name=test-eval`，确认 Dataset 创建成功
- [ ] 7.7.2 执行 `npm run eval:run -- --file=评测集.xlsx --name=test-eval`，确认评测完成
- [ ] 7.7.3 在 LangFuse Dashboard 查看 Experiment Run，确认评分可见
- [ ] 7.7.4 验证 Excel 解析正确（20 条用例全部识别）
- [ ] 7.7.5 验证 CLI 彩色输出和进度显示正常

## 8. 回滚方案

如遇问题，按以下步骤回滚：
1. 移除 `EvalModule` 导入
2. 恢复 `LangfuseService.getClient()` 原实现（返回配置对象）
3. 删除新增文件：`excel-parser.service.ts`、`eval.command.ts`、`eval.module.ts`
4. 从 `package.json` 移除 `eval:*` 脚本

不影响原有业务逻辑和 LangFuse 追踪功能。

## 9. 待确认问题

- [ ] Excel 评测集是否支持多个 Sheet？当前设计只读取第一个 Sheet
- [ ] 评测失败时是否自动重试？当前设计未实现，可后续增强
- [ ] 是否需要支持并行评测（多线程/多进程）？当前为串行执行

