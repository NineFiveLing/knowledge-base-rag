## Purpose

使用 LangFuse 官方 CallbackHandler 自动插桩方式，为 Agentic RAG 管道提供 LLM 层全链路可观测性与批量评测能力；同时使用 `@opentelemetry/sdk-node` 自动插桩提供基础设施层可观测性（HTTP、数据库、Redis）。追踪与评测数据通过官方 SDK 自动采集，不依赖手动 span 包装。

## ADDED Requirements

### Requirement: LangFuse 服务初始化

系统 SHALL 提供一个 `LangfuseService`（NestJS 单例），在模块启动时读取环境变量并初始化 LangFuse Client。若环境变量缺失（`LANGFUSE_PUBLIC_KEY` 为空），则初始化跳过，系统正常运行但不产生追踪数据。

#### Scenario: 正常初始化
- **WHEN** 设置了 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`
- **THEN** `LangfuseService` 创建 LangFuse Client 实例，`getCallbackHandler()` 返回可用的 `CallbackHandler`

#### Scenario: 环境变量缺失时优雅降级
- **WHEN** 未设置 `LANGFUSE_PUBLIC_KEY` 或值为空字符串
- **THEN** `LangfuseService` 初始化跳过，`getCallbackHandler()` 返回 `null`，RAG 查询正常运行不报错

### Requirement: CallbackHandler 自动追踪（流式路径）

流式查询 `streamQuery` SHALL 使用 LangFuse `CallbackHandler`，通过 `graph.streamEvents()` 的 `callbacks` 选项传入。LangFuse SDK 自动捕获以下事件并生成结构化 Trace：
- 图节点执行（每个 node 产生一个 Span）
- LLM 调用（每个 `invoke`/`stream` 产生一个 Generation）
- 工具调用（每个工具执行产生一个 Span，包含参数与返回结果）

Trace 的标签（tags）包含：`userId`、`sessionId`、`conversationId`（若存在）。当 CallbackHandler 不可用时（初始化跳过），`callbacks` 传空数组。

#### Scenario: 流式查询产生完整 Trace
- **WHEN** 用户发起流式 RAG 查询
- **THEN** LangFuse Dashboard 中出现一条 Trace，按执行顺序展示所有节点 Span、LLM Generation、工具调用 Span

#### Scenario: 工具调用自动追踪
- **WHEN** Agent 节点调用 `vector_search` 工具
- **THEN** 自动生成一个工具 Span，记录工具名、输入查询、返回结果摘要

### Requirement: CallbackHandler 自动追踪（同步路径）

同步查询 `query` SHALL 同样使用 CallbackHandler，通过 `graph.invoke()` 的 `callbacks` 选项传入。LangFuse SDK 自动捕获 LLM 调用与图执行事件。Trace 的标签与流式路径一致（`userId`、`sessionId`、`conversationId`）。

#### Scenario: 同步查询产生 Trace
- **WHEN** 调用 `RAGService.query()`
- **THEN** LangFuse 记录完整 Trace，包含所有 LLM 调用 Generation 和节点 Span

#### Scenario: 无 CallbackHandler 时同步查询正常运行
- **WHEN** LangFuse 未初始化，`getCallbackHandler()` 返回 `null`
- **THEN** `graph.invoke()` 以 `callbacks: []` 执行，返回正常结果

### Requirement: Trace 元数据与标签

每条 Trace SHALL 包含以下标准字段：
- `name`：固定为 `rag-query`
- `userId`：调用方用户 ID
- `sessionId`：会话 ID（用于关联同一对话的多次查询）
- `conversationId`：对话 ID（若存在）
- `metadata.intent`：意图分类结果（`chat` / `simple` / `complex` / `followup`）
- `metadata.model`：使用的 LLM 模型名称
- `metadata.searchDegraded`：检索是否降级

上述元数据通过 CallbackHandler 的 `tags` 和 `metadata` 参数传递，不由节点代码手动设置 span。

#### Scenario: Trace 标签包含用户和会话信息
- **WHEN** 用户发起 RAG 查询
- **THEN** Trace 的 `tags` 包含 `userId` 和 `sessionId`，若存在 `conversationId` 则同时包含

#### Scenario: 降级检索时 metadata 标记
- **WHEN** 检索结果全部低于阈值
- **THEN** Trace 的 `metadata.searchDegraded` 为 `true`

### Requirement: 评测数据集集成

系统 SHALL 提供 `LangfuseEvalService`，支持将测试用例集上传为 LangFuse Dataset，对 Agentic RAG 管道执行批量评测。评测流程：
1. 上传测试用例（含 `input`、`expectedOutput`、可选的 `expectedRetrievalContext`）到 LangFuse Dataset
2. 对每条测试用例调用 `RAGService.query()` 执行
3. 使用 LangFuse Evaluation API 计算评分指标：`answer-relevancy`、`faithfulness`、`context-recall`
4. 评测结果写回 LangFuse，在 Dashboard 中可查看评分分布与 Trace 关联

#### Scenario: 上传测试数据集
- **WHEN** 评测脚本调用 `LangfuseEvalService.uploadDataset(name, testCases)`
- **THEN** 测试用例写入 LangFuse Dataset，返回 `datasetId`

#### Scenario: 批量执行评测
- **WHEN** 调用 `LangfuseEvalService.runEvaluation(datasetId, config)`
- **THEN** 系统遍历 Dataset 中每条用例，执行 RAG 管道，使用 LangFuse Evaluation API 评分，结果可查询

#### Scenario: 评测结果关联 Trace
- **WHEN** 用户在 LangFuse Dashboard 查看评测结果
- **THEN** 每条用例关联其 RAG 查询 Trace，展示输入、输出、评分及指标详情

### Requirement: 错误与异常追踪

系统运行过程中产生的未捕获异常 SHALL 被 CallbackHandler 自动记录为 Trace 错误。LangFuse 自动标记 Trace 的 `status` 为 `ERROR`，并记录异常信息。关键错误场景：
- LLM API 超时 / 限流
- 向量数据库连接失败

检索降级（`degraded=true`）不视为错误，Trace `status` 保持为 `COMPLETED`，在 `metadata` 中标记降级状态。

#### Scenario: LLM 调用失败自动标记错误
- **WHEN** LLM API 调用抛出异常
- **THEN** LangFuse 自动标记 Trace `status=ERROR`，记录异常堆栈

#### Scenario: 降级检索不标记错误
- **WHEN** 检索结果低于阈值，`degraded=true`
- **THEN** Trace `status=COMPLETED`，`metadata.searchDegraded=true`

### Requirement: 配置与隐私

LangFuse 集成 SHALL 完全通过环境变量配置：
- `LANGFUSE_PUBLIC_KEY`：LangFuse 公钥
- `LANGFUSE_SECRET_KEY`：LangFuse 私钥
- `LANGFUSE_BASE_URL`：LangFuse 服务地址（支持私有部署）
- `LANGFUSE_PROJECT_ID`：评测数据集归属项目 ID

当 `LANGFUSE_PUBLIC_KEY` 为空时，所有 LangFuse 功能静默禁用。敏感凭据不得硬编码在代码中。评测过程中传输到 LangFuse 的数据包含用户查询和 LLM 生成内容，使用者需自行评估数据合规性。

#### Scenario: 私有部署地址
- **WHEN** 设置 `LANGFUSE_BASE_URL` 为自建 LangFuse 地址
- **THEN** 所有 API 调用指向该地址

#### Scenario: 禁用追踪
- **WHEN** 未设置 `LANGFUSE_PUBLIC_KEY`
- **THEN** 所有追踪功能静默禁用，系统正常运行

### Requirement: LangfuseService.getClient() 返回 LangFuse 实例

`LangfuseService.getClient()` SHALL 返回真正的 `LangFuse` 客户端实例，支持 `LangfuseEvalService` 调用 Dataset API 和 Score API。

#### Scenario: getClient() 返回 LangFuse 实例
- **WHEN** 调用 `langfuseService.getClient()` 且环境变量配置正确
- **THEN** 返回 `LangFuse` 实例，可调用 `client.dataset.create()`、`client.score.create()` 等方法

#### Scenario: getClient() 在未初始化时返回 null
- **WHEN** LangFuse 环境变量缺失或为空
- **THEN** `getClient()` 返回 `null`，调用方需处理降级场景

#### Scenario: LangfuseEvalService 使用 getClient() 上传 Dataset
- **WHEN** `LangfuseEvalService.uploadDataset()` 调用 `langfuseService.getClient()`
- **THEN** 成功创建 Dataset 和 Dataset Items，无 TypeError

## ADDED Requirements (OpenTelemetry)

### Requirement: OpenTelemetry 自动插桩

系统 SHALL 使用 `@opentelemetry/sdk-node` 自动追踪 NestJS 应用的基础设施层操作，包括：
- HTTP 请求/响应（Express 层）
- PostgreSQL 查询（通过 `@opentelemetry/instrumentation-pg`）
- MongoDB 查询（通过 `@opentelemetry/instrumentation-mongodb`）
- Redis 操作（通过 `@opentelemetry/instrumentation-ioredis`）

Elasticsearch 查询通过 `@elastic/elasticsearch` 客户端的内置诊断功能追踪，不使用 OTel 自动插桩包（`@opentelemetry/instrumentation-elasticsearch` 不存在于 npm registry）。

自动插桩通过 `apps/server/src/instrumentation.ts` 入口文件配置，在 `main.ts` 启动时加载。

#### Scenario: HTTP 请求追踪
- **WHEN** 客户端发起 HTTP 请求到 NestJS 服务
- **THEN** 自动生成一个 HTTP Server Span，记录请求方法、路径、状态码、延迟

#### Scenario: 数据库查询追踪
- **WHEN** RAG 服务执行 PostgreSQL 或 MongoDB 查询
- **THEN** 自动生成数据库 Span，记录查询语句（或参数化查询）、延迟、行数

#### Scenario: Redis 操作追踪
- **WHEN** 服务执行 Redis get/set 操作
- **THEN** 自动生成 Redis Span，记录操作类型、key、延迟

### Requirement: OpenTelemetry 导出配置

OpenTelemetry SDK SHALL 通过环境变量配置导出目标，默认导出到 LangFuse（通过 OTLP）。导出配置项：
- `OTEL_EXPORTER_OTLP_ENDPOINT`：OTLP 导出端点
- `OTEL_SERVICE_NAME`：服务名称（默认 `knowledge-base-rag-server`）
- `OTEL_ENVIRONMENT`：环境标识（development / production）

当 OpenTelemetry 环境变量未配置时，SDK 初始化跳过，不影响应用运行。

#### Scenario: 导出到 LangFuse
- **WHEN** 设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 为 LangFuse OTLP 端点
- **THEN** 所有基础设施层 Trace 导出到 LangFuse Dashboard，与 LLM Trace 统一展示

#### Scenario: OTel 未配置时正常运行
- **WHEN** 未设置 OTel 环境变量
- **THEN** 应用正常运行，不产生基础设施层 Trace

### Requirement: 死依赖清理

`@opentelemetry/api` SHALL 从 `apps/server/package.json` 的 `dependencies` 中移除。项目中没有任何 TypeScript 源文件直接 import `@opentelemetry/api`，该依赖仅为传递依赖（被 `@langchain/core`、`@langfuse/core` 等间接引入）。移除后，`@opentelemetry/sdk-node` 的安装会自动满足传递依赖要求。

#### Scenario: 移除后依赖完整性
- **WHEN** 从 package.json 移除 `@opentelemetry/api` 并安装 `@opentelemetry/sdk-node`
- **THEN** 项目依赖树中 `@opentelemetry/api` 仍通过传递依赖存在，应用正常运行
