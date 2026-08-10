# Langfuse 自动方案迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目从手动 Langfuse SDK  instrumentation 迁移到官方 `@langfuse/langchain` callback handler 自动追踪方案

**Architecture:** 
1. 移除所有手动创建 Trace/Span/Generation 的代码
2. 在 `graph.streamEvents()` 上挂载 `CallbackHandler`，让 Langfuse 自动拦截 LangChain/LangGraph 的所有事件
3. 保留评测元数据同步能力，但改用自动方案生成的 Trace ID 进行关联

**Tech Stack:**
- `@langfuse/langchain` — Langfuse 官方 LangChain callback handler
- `@opentelemetry/api` — OpenTelemetry peer dependency
- 现有 `langchain` ^1.5.4, `@langchain/langgraph` ^1.4.8, `@langchain/core` ^1.2.3

## Global Constraints

- 保持现有 NestJS 模块结构不变
- `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL` 环境变量保留
- 保持 chat SSE 流式输出格式不变
- 保持评测脚本接口不变
- `streamEvents` 使用 `version: "v2"`
- TypeScript 编译无错误 (`npx tsc --noEmit`)

---

## 影响范围总览

```
迁移前（手动方案）                          迁移后（自动方案）
───────────────────────────                ───────────────────────────

langfuse.service.ts          ❌ 删除      无需 LangfuseService
observability.module.ts      ❌ 删除      无需 ObservabilityModule

state.ts                     ✏️ 修改      删除 langfuseTraceId 字段

nodes/intent.ts              ❌ 删除 langfuse 代码
nodes/agent.ts               ❌ 删除 langfuse 代码
nodes/retrieval.ts           ❌ 删除 langfuse 代码
nodes/generate.ts            ❌ 删除 langfuse 代码

rag.service.ts               ✏️ 修改      删除 simple_retrieval span
                                    添加 CallbackHandler

chat.service.ts              ✏️ 修改      删除 createTrace/flush
                                    保留 evalMetadata 处理

chat.controller.ts           ✏️ 修改      删除 updateEvalMetrics 端点
                                    (改用自动 Trace 的 sessionId)

chat.dto.ts                  ✏️ 修改      保留 evalMetadata

search.service.ts            ✏️ 修改      删除 langfuse 注入

app.module.ts                ✏️ 修改      删除 ObservabilityModule import

package.json                 ✏️ 修改      替换 langfuse 为 @langfuse/langchain
                                    添加 @opentelemetry/api
```

---

## 前置检查清单

在开始前，确认以下文件已读过：

- [x] `apps/server/src/modules/rag/state.ts`
- [x] `apps/server/src/modules/rag/graph.ts`
- [x] `apps/server/src/modules/rag/rag.service.ts`
- [x] `apps/server/src/modules/rag/nodes/intent.ts`
- [x] `apps/server/src/modules/rag/nodes/agent.ts`
- [x] `apps/server/src/modules/rag/nodes/retrieval.ts`
- [x] `apps/server/src/modules/rag/nodes/generate.ts`
- [x] `apps/server/src/modules/rag/nodes/routes.ts`
- [x] `apps/server/src/modules/rag/rag.module.ts`
- [x] `apps/server/src/modules/chat/chat.service.ts`
- [x] `apps/server/src/modules/chat/chat.controller.ts`
- [x] `apps/server/src/modules/chat/chat.dto.ts`
- [x] `apps/server/src/common/observability/langfuse.service.ts`
- [x] `apps/server/src/common/observability/observability.module.ts`
- [x] `apps/server/src/app.module.ts`
- [x] `apps/server/src/modules/search/search.service.ts`
- [x] `apps/server/package.json`

---

## Task 1: 安装依赖

**Files:**
- Modify: `apps/server/package.json`
- Test: 无

**Interfaces:**
- Consumes: 无
- Produces: 新依赖 `@langfuse/langchain` 和 `@opentelemetry/api` 可用

- [ ] **Step 1: 在 package.json 中替换依赖**

当前 `package.json` 中的 langfuse 依赖：
```json
"langfuse": "^3.38.20"
```

替换为：
```json
"@langfuse/langchain": "^0.5.0",
"@opentelemetry/api": "^1.9.0"
```

> 注意：`@langfuse/langchain` 的 peer dependency 为 `@langchain/core >= 0.3.8` 和 `@opentelemetry/api ^1.9.0`。
> 项目当前有 `@langchain/core: ^1.2.3`，满足要求。

- [ ] **Step 2: 安装依赖**

```bash
cd apps/server && pnpm install
```

- [ ] **Step 3: 验证安装成功**

```bash
cd apps/server && ls node_modules/@langfuse/langchain/dist/index.d.ts
```

Expected: 文件存在

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 编译通过（此时还未改代码，可能会有 `langfuse` 相关错误，先忽略）

---

## Task 2: 移除手动 Langfuse 核心服务

**Files:**
- Delete: `apps/server/src/common/observability/langfuse.service.ts`
- Delete: `apps/server/src/common/observability/observability.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: 无
- Produces: LangfuseService 和 ObservabilityModule 已删除，所有引用点将在后续任务中清理

- [ ] **Step 1: 删除 langfuse.service.ts**

```bash
rm apps/server/src/common/observability/langfuse.service.ts
```

- [ ] **Step 2: 删除 observability.module.ts**

```bash
rm apps/server/src/common/observability/observability.module.ts
```

- [ ] **Step 3: 从 app.module.ts 中删除 ObservabilityModule import**

```typescript
// apps/server/src/app.module.ts

// 删除这一行：
// import { ObservabilityModule } from './common/observability/observability.module';

// 删除 imports 数组中的 ObservabilityModule：
// ObservabilityModule,  ← 删除
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 有大量 "cannot find name LangfuseService" 等错误（预期内，后续任务修复）

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git add -A
git commit -m "refactor: remove manual Langfuse service and module"
```

---

## Task 3: 清理 State 定义

**Files:**
- Modify: `apps/server/src/modules/rag/state.ts:60-64`

**Interfaces:**
- Consumes: Task 2 已完成（LangfuseService 已删除）
- Produces: `langfuseTraceId` 字段已移除，state 更简洁

- [ ] **Step 1: 删除 langfuseTraceId 字段**

```typescript
// apps/server/src/modules/rag/state.ts

// 删除以下代码块：
//   /** LangFuse trace ID（字符串，可安全序列化），未配置 LangFuse 时为空 */
//   langfuseTraceId: Annotation<string>({
//     reducer: (_, next) => next,
//     default: () => '',
//   }),
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 还有引用 langfuseTraceId 的错误（后续任务修复）

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/rag/state.ts
git commit -m "refactor: remove langfuseTraceId from AgentState"
```

---

## Task 4: 清理 RAG 节点中的手动 Langfuse 代码

**Files:**
- Modify: `apps/server/src/modules/rag/nodes/intent.ts`
- Modify: `apps/server/src/modules/rag/nodes/agent.ts`
- Modify: `apps/server/src/modules/rag/nodes/retrieval.ts`
- Modify: `apps/server/src/modules/rag/nodes/generate.ts`

**Interfaces:**
- Consumes: Task 2 已完成（LangfuseService 已删除）
- Produces: 所有节点不再引用 LangfuseService

### Task 4.1: 清理 intent.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/rag/nodes/intent.ts

// 删除：
// import { LangfuseService } from '../../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除函数签名中的 langfuse 参数**

```typescript
// 修改前：
export function createIntentClassifier(llm: ChatOpenAI, memory: MemoryService, langfuse?: LangfuseService) {

// 修改后：
export function createIntentClassifier(llm: ChatOpenAI, memory: MemoryService) {
```

- [ ] **Step 3: 删除 span 创建和结束代码**

```typescript
// 删除以下代码块（第 72-76 行）：
//     // 记录 LangFuse span
//     if (langfuse?.isEnabled() && state.langfuseTraceId) {
//       const span = langfuse.createSpan(state.langfuseTraceId, 'intent_classifier', { query: content });
//       langfuse.endSpan(span, { intent, latencyMs: Date.now() - startTime });
//     }
```

### Task 4.2: 清理 agent.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/rag/nodes/agent.ts

// 删除：
// import { LangfuseService } from '../../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除函数签名中的 langfuse 参数**

```typescript
// 修改前：
export function createAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService, langfuse?: LangfuseService) {

// 修改后：
export function createAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService) {
```

- [ ] **Step 3: 删除 recordGeneration 代码块**

```typescript
// 删除以下代码块（第 60-94 行）：
//     // 记录 Agent LLM generation
//     if (langfuse?.isEnabled() && state.langfuseTraceId) {
//       const toolCalls = (res as AIMessage).tool_calls?.map((tc: any) => ({
//         name: tc.name,
//         id: tc.id,
//         args: tc.args,
//       })) || [];
//
//       // 估算 token 数量（粗略估算：1 token ≈ 4 字符）
//       const promptTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.toString().length / 4), 0);
//       const completionTokens = Math.ceil(String(res.content).length / 4);
//
//       langfuse.recordGeneration(state.langfuseTraceId, {
//         name: 'agent_react',
//         input: {
//           messageCount: messages.length,
//           toolCallsRemaining: state.toolCallsRemaining,
//           memoryContext: {
//             summaryLength: ctx.summary.length,
//             historyLength: ctx.history.length,
//             systemContextLength: ctx.systemContext.length,
//           }
//         },
//         output: {
//           content: String(res.content).slice(0, 500),
//           toolCalls,
//           latencyMs: Date.now() - startTime,
//         },
//         model: 'deepseek-chat',
//         usage: {
//           promptTokens,
//           completionTokens,
//         }
//       });
//     }
```

- [ ] **Step 4: 清理 createFollowUpAgentNode 中的 langfuse 传递**

```typescript
// 修改前：
export function createFollowUpAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService, langfuse?: LangfuseService) {
  const agentReAct = createAgentNode(llm, tools, memory, langfuse);

// 修改后：
export function createFollowUpAgentNode(llm: ChatOpenAI, tools: any[], memory: MemoryService) {
  const agentReAct = createAgentNode(llm, tools, memory);
```

### Task 4.3: 清理 retrieval.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/rag/nodes/retrieval.ts

// 删除：
// import { LangfuseService } from '../../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除函数签名中的 langfuse 参数**

```typescript
// 修改前：
export function createRetrievalNode(
  vectorSearchFn: (q: string) => Promise<string>,
  esSearchFn: (q: string) => Promise<string>,
  neo4jQueryFn: (q: string) => Promise<string>,
  langfuse?: LangfuseService,
) {

// 修改后：
export function createRetrievalNode(
  vectorSearchFn: (q: string) => Promise<string>,
  esSearchFn: (q: string) => Promise<string>,
  neo4jQueryFn: (q: string) => Promise<string>,
) {
```

- [ ] **Step 3: 删除所有 span 创建和结束代码**

```typescript
// 删除以下代码块：

// 1. Span 创建（第 41-48 行）：
//     let span: any = null;
//     if (langfuse?.isEnabled() && state.langfuseTraceId) {
//       span = langfuse.createSpan(state.langfuseTraceId, `retrieval:${call.name}`, {
//         query: q,
//         toolCallId: call.id,
//         arguments: call.args,
//       });
//     }

// 2. Span 结束（第 53-79 行）：
//     if (langfuse?.isEnabled() && state.langfuseTraceId && span) {
//       try {
//         const items = JSON.parse(result);
//         if (Array.isArray(items)) {
//           const chunks = items.slice(0, 10).map((item: any) => ({
//             chunk_text: item.chunk_text || '',
//             score: item.rerankScore ?? item.score ?? 0,
//             chunk_id: item.chunk_id,
//             postgres_doc_id: item.postgres_doc_id,
//           }));
//           const scores = items.map((item: any) => item.rerankScore ?? item.score ?? 0);
//           langfuse.endSpan(span, {
//             resultCount: items.length,
//             latencyMs: Date.now() - toolStart,
//             chunks,
//             scores,
//             topScore: Math.max(...scores),
//             avgScore: scores.reduce((a: number, b: number) => a + b, 0) / scores.length,
//           });
//         } else {
//           langfuse.endSpan(span, { resultCount: 0, latencyMs: Date.now() - toolStart, parseError: true });
//         }
//       } catch {
//         langfuse.endSpan(span, { resultCount: 0, latencyMs: Date.now() - toolStart, parseError: true });
//       }
//     }
```

### Task 4.4: 清理 generate.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/rag/nodes/generate.ts

// 删除：
// import { LangfuseService } from '../../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除函数签名中的 langfuse 参数**

```typescript
// 修改前：
export function createGenerateNode(llm: ChatOpenAI, memory: MemoryService, langfuse?: LangfuseService, docRepo?: Repository<Document>) {

// 修改后：
export function createGenerateNode(llm: ChatOpenAI, memory: MemoryService, docRepo?: Repository<Document>) {
```

- [ ] **Step 3: 删除 recordGeneration 代码块**

```typescript
// 删除以下代码块（第 106-113 行）：
//     // 记录 LLM generation
//     if (langfuse?.isEnabled() && state.langfuseTraceId) {
//       langfuse.recordGeneration(state.langfuseTraceId, {
//         name: 'answer_generation',
//         input: { query, chunksCount: state.retrievedChunks.length },
//         output: { answer: fullContent },
//         model: 'deepseek-chat',
//       });
//     }
```

- [ ] **Step 4: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: nodes 相关的 langfuse 错误已清除，但还有 rag.service.ts 和 chat 层的错误

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/rag/nodes/intent.ts
git add apps/server/src/modules/rag/nodes/agent.ts
git add apps/server/src/modules/rag/nodes/retrieval.ts
git add apps/server/src/modules/rag/nodes/generate.ts
git add apps/server/src/modules/rag/state.ts
git commit -m "refactor: remove manual Langfuse instrumentation from all RAG nodes"
```

---

## Task 5: 重构 RAGService — 添加自动 Callback Handler

**Files:**
- Modify: `apps/server/src/modules/rag/rag.service.ts`

**Interfaces:**
- Consumes: Task 4 已完成（节点已清理）
- Produces: `streamQuery()` 使用 `CallbackHandler` 自动追踪

- [ ] **Step 1: 添加 import**

```typescript
// apps/server/src/modules/rag/rag.service.ts

// 在文件顶部添加：
import { CallbackHandler } from "@langfuse/langchain";
```

- [ ] **Step 2: 删除 LangfuseService import 和注入**

```typescript
// 删除 import：
// import { LangfuseService } from "../../common/observability/langfuse.service";

// 从 constructor 中删除参数：
//   private langfuse: LangfuseService,
```

- [ ] **Step 3: 删除 simple_retrieval 中的手动 span 代码**

找到 `simpleRetrieval` 方法，删除：

```typescript
    // 删除：
    // const span = this.langfuse.createSpan(state.langfuseTraceId, 'simple_retrieval', { query });

    // 删除：
    // if (this.langfuse.isEnabled()) {
    //   this.langfuse.endSpan(span, {
    //     resultCount: result.results.length,
    //     degraded: result.degraded,
    //     degradeReason: result.degradeReason,
    //     latencyMs,
    //     chunks: result.results.slice(0, 10).map((r: any) => ({
    //       chunk_text: r.chunk_text,
    //       score: r.score,
    //       chunk_id: r.chunk_id,
    //     })),
    //   });
    // }
```

- [ ] **Step 4: 重构 streamQuery() 方法**

```typescript
  // 修改前：
  async streamQuery(
    userMessage: string,
    userId: string,
    sessionId: string,
    langfuseTraceId?: string,
  ) {
    return this.graph.streamEvents(
      {
        messages: [new HumanMessage(userMessage)],
        userId,
        sessionId,
        langfuseTraceId: langfuseTraceId || "",
      },
      { version: "v2" },
    );
  }

  // 修改后：
  async streamQuery(
    userMessage: string,
    userId: string,
    sessionId: string,
  ) {
    const langfuseHandler = new CallbackHandler({
      sessionId,
      userId,
    });

    return this.graph.streamEvents(
      {
        messages: [new HumanMessage(userMessage)],
        userId,
        sessionId,
      },
      {
        version: "v2",
        callbacks: [langfuseHandler],
      },
    );
  }
```

- [ ] **Step 5: 删除 onModuleInit 中 langfuse 的传递**

找到 `onModuleInit()` 方法中所有节点的创建调用，删除 `this.langfuse` 参数：

```typescript
    // 修改前：
    const agentFollowUpNode = createFollowUpAgentNode(
      this.llm, [vectorTool, esTool, neo4jTool], this.memory, this.langfuse,
    );

    this.graph = createRAGGraph(
      createIntentClassifier(this.llm, this.memory, this.langfuse),
      // ...
      createAgentNode(this.llm, [vectorTool, esTool, neo4jTool], this.memory, this.langfuse),
      // ...
      createRetrievalNode(..., this.langfuse),
      createGenerateNode(this.llm, this.memory, this.langfuse, this.docRepo),
      // ...
    );

    // 修改后：
    const agentFollowUpNode = createFollowUpAgentNode(
      this.llm, [vectorTool, esTool, neo4jTool], this.memory,
    );

    this.graph = createRAGGraph(
      createIntentClassifier(this.llm, this.memory),
      // ...
      createAgentNode(this.llm, [vectorTool, esTool, neo4jTool], this.memory),
      // ...
      createRetrievalNode(...),
      createGenerateNode(this.llm, this.memory, this.docRepo),
      // ...
    );
```

- [ ] **Step 6: 删除 query() 方法中多余的 langfuseTraceId 参数**

```typescript
  // query() 方法保持不变，因为它不涉及流式追踪
  async query(userMessage: string, userId: string, sessionId: string) {
    const result = await this.graph.invoke({
      messages: [new HumanMessage(userMessage)],
      userId,
      sessionId,
    });
    return result.finalAnswer;
  }
```

- [ ] **Step 7: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/rag/rag.service.ts
git commit -m "refactor: replace manual spans with CallbackHandler in RAGService"
```

---

## Task 6: 重构 ChatService — 移除手动 Trace 管理

**Files:**
- Modify: `apps/server/src/modules/chat/chat.service.ts`

**Interfaces:**
- Consumes: Task 5 已完成（RAGService 已重构）
- Produces: ChatService 不再手动管理 Langfuse Trace

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/chat/chat.service.ts

// 删除：
// import { LangfuseService } from '../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除 constructor 中的 langfuse 注入**

```typescript
  // 修改前：
  constructor(
    private rag: RAGService,
    public memory: MemoryService,
    private langfuse: LangfuseService,
    private tts: TtsService,
    // ...
  ) {}

  // 修改后：
  constructor(
    private rag: RAGService,
    public memory: MemoryService,
    private tts: TtsService,
    // ...
  ) {}
```

- [ ] **Step 3: 简化 streamAnswer() 方法**

删除以下代码块：

```typescript
    // 删除（第 62-81 行）：
    //     // 流式 RAG 回答
    //     const traceId = this.langfuse.createTrace('chat', { query: message }, userId, sessionId);
    //
    //     // 如果有评测元数据，异步更新到 Trace metadata
    //     if (evalMetadata && traceId && this.langfuse.isEnabled()) {
    //       // 延迟 1s 确保 Trace 已创建
    //       setTimeout(async () => {
    //         try {
    //           await this.langfuse.updateTraceMetadata(sessionId, {
    //             eval: {
    //               caseId: evalMetadata.caseId,
    //               category: evalMetadata.category,
    //               groundTruth: evalMetadata.groundTruth,
    //               expectedKeywords: evalMetadata.expectedKeywords,
    //             }
    //           });
    //         } catch (err) {
    //           this.logger.warn('更新评测元数据失败', (err as Error)?.message);
    //         }
    //       }, 1000);
    //     }
```

修改 stream 调用：

```typescript
    // 修改前：
    const stream = await this.rag.streamQuery(message, userId, sessionId, traceId || undefined);

    // 修改后：
    const stream = await this.rag.streamQuery(message, userId, sessionId);
```

删除 finally 块中的 flush：

```typescript
    // 删除 finally 块中的：
    // if (traceId) {
    //   await this.langfuse.flush();
    // }
```

- [ ] **Step 4: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/chat/chat.service.ts
git commit -m "refactor: remove manual Langfuse trace management from ChatService"
```

---

## Task 7: 清理 ChatController 和 ChatDto

**Files:**
- Modify: `apps/server/src/modules/chat/chat.controller.ts`
- Modify: `apps/server/src/modules/chat/dto/chat.dto.ts`

**Interfaces:**
- Consumes: Task 6 已完成（ChatService 已清理）
- Produces: Controller 和 DTO 不再有 Langfuse 依赖

### Task 7.1: 清理 chat.controller.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/chat/chat.controller.ts

// 删除：
// import { LangfuseService } from '../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除 constructor 中的 langfuse 注入**

```typescript
  // 修改前：
  constructor(private chatService: ChatService, private langfuse: LangfuseService) {}

  // 修改后：
  constructor(private chatService: ChatService) {}
```

- [ ] **Step 3: 删除 updateEvalMetrics 端点**

```typescript
    // 删除整个方法（第 128-148 行）：
    //     /**
    //      * 内部 API：更新 Langfuse Trace 评测指标
    //      * 仅用于评测脚本调用
    //      */
    //     @Post('internal/langfuse/update-eval-metrics')
    //     @UseGuards(JwtAuthGuard)
    //     async updateEvalMetrics(
    //       @Body() dto: { sessionId: string; metrics: any },
    //       @CurrentUser() user: { id: string },
    //     ) {
    //       // 仅允许 admin 用户调用
    //       if (user.id !== 'admin') {
    //         throw new ForbiddenException('仅允许 admin 用户调用');
    //       }
    //
    //       await this.langfuse.updateTraceMetadata(dto.sessionId, {
    //         evalMetrics: dto.metrics,
    //       });
    //
    //       return { success: true };
    //     }
```

- [ ] **Step 4: 删除 ForbiddenException import（如果不再使用）**

```typescript
// 检查是否还有其他地方使用 ForbiddenException，如果没有则删除：
// import { ..., ForbiddenException, ... } from '@nestjs/common';
```

### Task 7.2: 清理 chat.dto.ts

- [ ] **Step 1: 保留 evalMetadata 字段（用于评测脚本传参）**

```typescript
// apps/server/src/modules/chat/dto/chat.dto.ts

// evalMetadata 字段保留，因为它仍然被评测脚本使用
// 但不再需要 @IsObject() 验证（因为我们现在直接透传到 graph 层）
```

实际上，`evalMetadata` 在自动方案下不再需要了，因为 Langfuse Callback Handler 会自动创建 Trace，不需要手动传参。但为了兼容评测脚本，我们可以先保留这个字段，让它成为可选参数（不影响正常业务）。

**决定：保留 evalMetadata，但不做任何处理。** 这样评测脚本不需要改。

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/chat/chat.controller.ts
git add apps/server/src/modules/chat/dto/chat.dto.ts
git commit -m "refactor: remove Langfuse dependency from ChatController and ChatDto"
```

---

## Task 8: 清理 SearchService 和 RAGService 残余引用

**Files:**
- Modify: `apps/server/src/modules/search/search.service.ts`
- Modify: `apps/server/src/modules/rag/rag.service.ts`（确认无遗漏）

**Interfaces:**
- Consumes: Task 5 已完成
- Produces: 所有 langfuse 引用已清除

### Task 8.1: 清理 search.service.ts

- [ ] **Step 1: 删除 LangfuseService import**

```typescript
// apps/server/src/modules/search/search.service.ts

// 删除：
// import { LangfuseService } from '../../common/observability/langfuse.service';
```

- [ ] **Step 2: 删除 constructor 中的 langfuse 参数**

```typescript
    // 修改前：
    constructor(
      ...
      private langfuse?: LangfuseService,  // ← 删除
    ) {}

    // 修改后：
    constructor(
      ...
    ) {}
```

### Task 8.2: 确认 rag.service.ts 无遗漏

- [ ] **Step 1: 检查 rag.service.ts 是否还有 langfuse 引用**

```bash
grep -n "langfuse" apps/server/src/modules/rag/rag.service.ts
```

Expected: 只有 `CallbackHandler` 相关的 import

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/search/search.service.ts
git add apps/server/src/modules/rag/rag.service.ts
git commit -m "refactor: clean up remaining langfuse references in SearchService and RAGService"
```

---

## Task 9: 验证自动方案功能

**Files:**
- 无代码改动
- 测试: 启动服务，运行查询，去 Langfuse Dashboard 验证

**Interfaces:**
- Consumes: Task 8 已完成
- Produces: 确认自动方案能正确追踪 LangGraph 执行过程

- [ ] **Step 1: 确认环境变量已配置**

```bash
# 检查 .env 文件
grep "LANGFUSE" .env
```

Expected: 看到 `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`

如果未配置，从 `.env.example` 复制：
```bash
cp .env.example .env
# 然后编辑 .env，填入实际的 Langfuse 密钥
```

- [ ] **Step 2: 启动后端服务**

```bash
cd apps/server && pnpm dev
```

Expected: 服务正常启动，无 Langfuse 相关错误

- [ ] **Step 3: 发送测试查询**

```bash
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{
    "message": "年假怎么申请？",
    "sessionId": "test-langfuse-001"
  }'
```

- [ ] **Step 4: 去 Langfuse Dashboard 验证**

登录 https://cloud.langfuse.com，检查：

**Trace 结构：**
- [ ] 能看到名为 `chat` 的 Trace
- [ ] Trace 的 Session ID 为 `test-langfuse-001`
- [ ] Trace 有 User ID

**自动创建的 Span/Generation：**
- [ ] 能看到 `graph` 级别的 Span（整个 graph 执行）
- [ ] 能看到每个节点的 Span（`intent_classifier`, `agent`, `simple_retrieval`, `generate_answer` 等）
- [ ] 能看到 LLM 调用的 Generation（包含 prompt, completion, model, usage）
- [ ] 能看到工具调用的 Span（`tool:vector_search`, `tool:keyword_search` 等）

**工具调用详情：**
- [ ] `tool:vector_search` 的 input 包含 `query` 参数
- [ ] `tool:vector_search` 的 output 包含工具返回值
- [ ] LLM Generation 的 input 包含 messages
- [ ] LLM Generation 的 output 包含 content 和 tool_calls

**Token 使用：**
- [ ] Generation 的 usage 包含精确的 promptTokens 和 completionTokens

- [ ] **Step 5: 运行评测脚本验证**

```bash
cd scripts/eval && pnpm tsx eval-advanced.ts
```

Expected: 
- 评测脚本正常运行
- 评测结果输出正常
- Langfuse 中能看到评测用例的 Trace（sessionId 为 `eval-case-*`）

---

## Task 10: 更新文档

**Files:**
- Modify: `docs/LANGFUSE_MONITORING.md`

**Interfaces:**
- Consumes: Task 9 已完成（已验证自动方案）
- Produces: 文档更新为自动方案

- [ ] **Step 1: 更新实现方式说明**

在文档开头添加说明：

```markdown
## 实现方式

本项目使用 **Langfuse 官方自动追踪方案**（`@langfuse/langchain` + `CallbackHandler`），
自动拦截 LangChain/LangGraph 的所有事件（LLM 调用、工具调用、graph 步骤），
无需手动编写 Trace/Span/Generation 代码。
```

- [ ] **Step 2: 更新配置说明**

```markdown
## 配置

### 环境变量

\```bash
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
\```

### 初始化

\`CallbackHandler\` 在 \`rag.service.ts\` 的 \`streamQuery()\` 方法中自动初始化，
从环境变量读取配置，无需额外代码。
```

- [ ] **Step 3: 更新监控内容说明**

```markdown
## 监控内容

### 自动捕获的追踪数据

Langfuse Callback Handler 自动捕获以下内容：

1. **Graph 执行步骤**
   - 每个节点的执行时间
   - 节点输入/输出

2. **LLM 调用**
   - Prompt 和 completion
   - 精确的 token 使用量
   - 模型名称

3. **工具调用**
   - 工具名称
   - 工具参数
   - 工具返回值
```

- [ ] **Step 4: 更新手动方案的说明**

```markdown
## 迁移说明

### 从手动方案迁移到自动方案

**迁移前（手动 SDK）：**
- 手动创建 Trace/Span/Generation
- 需要维护 \`LangfuseService\`
- 每个节点都需要写 langfuse 代码

**迁移后（自动 Callback）：**
- \`CallbackHandler\` 自动拦截所有事件
- 无需手动创建 Trace/Span/Generation
- 代码量减少 ~200 行
```

- [ ] **Step 5: Commit**

```bash
git add docs/LANGFUSE_MONITORING.md
git commit -m "docs: update Langfuse monitoring guide for automatic callback approach"
```

---

## Task 11: 清理 package.json 中的旧依赖

**Files:**
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: Task 1 已完成（新依赖已安装）
- Produces: package.json 只包含新依赖

- [ ] **Step 1: 确认旧依赖已移除**

```bash
grep "langfuse" apps/server/package.json
```

Expected: 只看到 `@langfuse/langchain`，没有 `"langfuse": "^3.38.20"`

如果还有旧依赖：
```bash
# 手动编辑 package.json，删除 "langfuse": "^3.38.20"
```

- [ ] **Step 2: 确认新依赖存在**

```bash
grep -E "@langfuse/langchain|@opentelemetry/api" apps/server/package.json
```

Expected: 看到两行

- [ ] **Step 3: 验证 pnpm-lock.yaml 已更新**

```bash
grep '"langfuse@' apps/server/pnpm-lock.yaml | head -5
```

Expected: 只看到 `@langfuse/langchain` 相关的 entries

- [ ] **Step 4: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git commit -m "chore: replace langfuse with @langfuse/langchain in dependencies"
```

---

## 最终验证清单

完成所有任务后，运行以下验证：

- [ ] TypeScript 编译通过：`cd apps/server && npx tsc --noEmit`
- [ ] 服务正常启动：`pnpm dev` 无错误
- [ ] 查询返回正常：`curl` 测试得到正常回答
- [ ] Langfuse Dashboard 能看到 Trace 和 Span
- [ ] 评测脚本正常运行：`cd scripts/eval && pnpm tsx eval-advanced.ts`
- [ ] Git 状态干净：`git status` 无未提交文件

---

## 回滚方案

如果自动方案不满足需求，可以通过以下命令回滚：

```bash
git revert HEAD
git revert HEAD~1
# ... 依次 revert 所有 commit
```

或者直接恢复到迁移前的分支：
```bash
git checkout main
git reset --hard <migration-before-commit>
```

---

## 后续优化（可选）

如果自动方案满足需求，可以考虑以下优化：

1. **自定义 Session ID 格式**：在 Callback Handler 中自定义 session ID 生成规则
2. **添加 Tags**：在 Callback Handler 中添加自定义 tags（如 `env:production`）
3. **评测指标同步**：研究自动方案下如何同步 evalMetrics 到 Trace metadata
4. **性能监控**：在 Langfuse 中设置 latency 和 token 消耗的告警规则
