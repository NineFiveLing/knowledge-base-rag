## Purpose

通过 `@opentelemetry/sdk-node` + `LangfuseSpanProcessor` 统一导出 RAG/LLM 完整追踪，密钥配置于 SpanProcessor 使追踪归属指定 Langfuse 项目，基础设施 span 默认过滤不展示。

## ADDED Requirements

### Requirement: LangfuseSpanProcessor 密钥配置导出

系统 SHALL 使用 `@opentelemetry/sdk-node` 的 `NodeSDK`，并以 `LangfuseSpanProcessor` 作为 span 处理器导出追踪。`LangfuseSpanProcessor` SHALL 将 `publicKey`、`secretKey`、`baseUrl` 分别配置为环境变量 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（`baseUrl` 缺省为 `https://cloud.langfuse.com`）。导出的追踪数据归属密钥对应的 Langfuse 项目。

#### Scenario: 配置密钥后追踪归属指定项目

- **WHEN** 设置 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`
- **THEN** 每次 RAG 查询产生的追踪显示在密钥对应项目的 Langfuse 仪表盘

#### Scenario: baseUrl 缺省使用云默认

- **WHEN** 未设置 `LANGFUSE_BASE_URL`
- **THEN** 追踪导出到 `https://cloud.langfuse.com`

### Requirement: 自动插桩与基础设施 span 过滤

系统 SHALL 通过 `getNodeAutoInstrumentations()` 自动采集 HTTP、Express、PostgreSQL、MongoDB、Redis 等基础设施 span，但 SHALL 仅导出 RAG/LLM 相关 span（`langfuse-sdk` 作用域、`gen_ai.*` 属性及已知 LLM 插桩库），基础设施 span 不展示在 Langfuse 仪表盘。

#### Scenario: 基础设施 span 被过滤

- **WHEN** 发起一次包含数据库查询与 Redis 操作的 RAG 查询
- **THEN** Langfuse 中仅显示该次查询的 RAG/LLM trace，HTTP/PG/Redis span 不出现

#### Scenario: 只关注大模型全流程

- **WHEN** 用户在 Langfuse 查看一次 RAG 查询
- **THEN** 看到的是从意图识别、检索、Agent 工具调用到生成的完整大模型调用流程

### Requirement: RAG 查询完整追踪

系统 SHALL 为每次 RAG 查询生成一条完整 trace，覆盖图节点执行、每次大模型调用与每次工具调用。同步 `query()` 与流式 `streamQuery()` 两条路径均 SHALL 产生一致结构的 trace。

#### Scenario: 同步查询产生完整 trace

- **WHEN** 调用 RAG 同步查询
- **THEN** Langfuse 出现一条 trace，包含节点执行、全部大模型调用与工具调用

#### Scenario: 流式查询产生完整 trace

- **WHEN** 调用 RAG 流式查询
- **THEN** Langfuse 出现一条 trace，结构与同步查询一致，包含全部大模型调用

#### Scenario: 工具调用被追踪

- **WHEN** Agent 节点调用向量检索 / Elasticsearch / Neo4j 工具
- **THEN** trace 中包含工具调用 span，记录工具名与输入查询

### Requirement: LangfuseService 仅提供评测 REST client

系统 SHALL 通过 `LangfuseService` 提供评测用的 LangFuse REST client（`getClient()`），不再提供追踪用的 CallbackHandler 封装。评测系统通过 `getClient()` 调用 Dataset / Score API 的能力保持不变。

#### Scenario: getClient 返回可用 REST client

- **WHEN** `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 配置正确
- **THEN** `getClient()` 返回可用的 `LangfuseAPIClient`，可调用 Dataset / Score API

#### Scenario: 未初始化时 getClient 返回 null

- **WHEN** Langfuse 环境变量缺失或为空
- **THEN** `getClient()` 返回 `null`，评测系统需自行处理降级

### Requirement: 优雅降级

未设置 `LANGFUSE_PUBLIC_KEY`（或为空字符串）时，系统 SHALL 静默禁用 Langfuse 追踪与评测初始化，RAG 查询正常运行、不产生追踪数据、不抛异常。

#### Scenario: 未配置密钥时禁用追踪

- **WHEN** `LANGFUSE_PUBLIC_KEY` 为空
- **THEN** OTel SDK 不启动，RAG 查询正常运行，无 Langfuse 相关报错，不产生追踪数据

#### Scenario: 追踪链路不影响业务

- **WHEN** Langfuse 追踪禁用期间用户发起 RAG 查询
- **THEN** 查询正常返回结果，无额外延迟或异常
