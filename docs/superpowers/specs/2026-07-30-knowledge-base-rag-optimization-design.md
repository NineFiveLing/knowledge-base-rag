# 企业知识库 RAG 平台 — 后续优化设计方案

> 日期：2026-07-30
> 状态：已确认（4 层 17 项，单人推进，不设时间限制）
> 前置：手动测试核心用例全部通过
> 关联：[原始设计文档](./2026-07-29-knowledge-base-rag-design.md) | [测试通过后下一步计划](../测试通过后下一步计划.md)

---

## 总体策略：能力递进式四层推进

```
第一层：补全 MVP 关键缺口（先让系统完整可跑）
  → 第二层：检索与 RAG 质量（跑起来再跑得好）
    → 第三层：生产加固（稳定可靠）
      → 第四层：功能增强（体验完整）
```

每层有独立的验收标准，上层是下层的基础。

---

## 第一层：补全 MVP 关键缺口（4 项，~4.5h）

> 目标：让检索链路真正闭合。当前上传文档→分块→但向量没写入，列表接口返回空，索引触发没有入口。

### 1.1 PGVector 向量写入集成

**现状**：[indexer.service.ts](../../apps/server/src/modules/document/services/indexer.service.ts) 注释 `"PGVector 向量写入在 Task 19 中集成"`，分块后跳过了向量写入。检索链路缺少向量维度的数据。

**改动点**：

- `IndexerService` 注入 `VectorService` 和 `OpenAIEmbeddings`
- `indexChunk()` 方法中为每个 chunk 调用 `embeddings.embedQuery(chunk.text)` 生成 embedding
- 调用 `VectorService.insertChunk()` 写入 PGVector（该方法已实现 `INSERT ON CONFLICT UPDATE`，重索引安全）
- `DocumentModule` 确认 `VectorService` 可跨模块注入

**涉及文件**：

- `apps/server/src/modules/document/services/indexer.service.ts` — 注入依赖 + 写入向量
- `apps/server/src/modules/document/document.module.ts` — 确认注入链

**验收标准**：上传文档 → 触发索引 → PGVector `chunks` 表有 embedding 数据 → 向量检索能返回结果

**工时**：1h | **风险**：低（基础设施已就绪）

---

### 1.2 文档列表接口

**现状**：[document.controller.ts](../../apps/server/src/modules/document/document.controller.ts) `GET /documents` 硬编码返回 `{ items: [], total: 0 }`。

**设计**：

```typescript
// 输入 DTO
ListDocumentDto {
  page?: number;         // 默认 1
  pageSize?: number;     // 默认 20，最大 100
  status?: DocumentStatus; // 可选筛选
  type?: string;         // 可选（pdf/docx/md/...）
  keyword?: string;      // 标题模糊搜索
}

// 数据权限过滤 (SQL WHERE)
// - visibility = 'public'（全公司可见）
// - OR dept_id = :userDeptId（同部门可见）
// - OR created_by = :userId（自己创建的）
// 以上三个条件 OR，再叠加 status/type/keyword 筛选
// 排序：created_at DESC
// 分页：LIMIT + OFFSET
```

**涉及文件**：

- `apps/server/src/modules/document/document.service.ts` — 新增 `list()` 方法
- `apps/server/src/modules/document/document.controller.ts` — 替换硬编码
- `apps/server/src/modules/document/dto/list-document.dto.ts` — 新增 DTO

**验收标准**：上传 3 个文档（不同部门/可见性）→ 不同用户登录后看到的文档列表不同

**工时**：1.5h | **风险**：低

---

### 1.3 阶段二索引触发

**现状**：上传完成后 `status=PARSED`，但分块+索引（ES/Neo4j/PGVector）没有触发入口。

**设计**：

```typescript
// 双通道触发:

// 通道 A：手动 API
POST /documents/:id/index
  → 权限检查（文档创建者 或 admin）
  → status → 'indexing'
  → IndexerService.indexDocument(docId)
    成功 → status → 'indexed'
    失败 → status → 'failed', error_message 记录错误信息

// 通道 B：上传后自动异步触发
// DocumentService.uploadStage1() 末尾:
上传成功 status=parsed
  → 异步调用 this.indexDocument(docId)（fire-and-forget，不阻塞上传响应）
  → 用户体验：上传完成几秒后自动变为 indexed
```

**涉及文件**：

- `apps/server/src/modules/document/document.controller.ts` — 新增 `POST /:id/index`
- `apps/server/src/modules/document/document.service.ts` — 新增 `triggerIndex()`，上传末尾异步调用

**验收标准**：上传文档 → 几秒后 status 自动变为 `indexed` → 检索能查到该文档内容

**工时**：1h | **风险**：低

---

### 1.4 阈值检查与降级提示

**现状**：Reranker 后有 `scoreThreshold: 0.5`，但低于阈值时没有明确处理——可能传给 LLM 空上下文导致编造。

**设计**：

```typescript
// SearchService.searchWithThreshold() 增强:
const reranked = rerank(results, query);
const qualified = reranked.filter(r => r.score >= 0.5);

if (qualified.length === 0) {
  return {
    chunks: [],
    degraded: true,           // 降级标记
    degradeReason: 'no_result_above_threshold',
    fallbackMessage: '抱歉，未在知识库中找到与您问题相关的文档。请尝试换个问法。',
  };
}

// RAG generate.ts 中处理降级:
if (retrievalResult.degraded) {
  // 跳过 LLM 生成，直接返回 fallbackMessage
  // 不走 Agent 重试——已经三路检索+RRF+Rerank，再试无意义
}
```

**涉及文件**：

- `apps/server/src/modules/search/search.service.ts` — 返回降级标记
- `apps/server/src/modules/rag/nodes/generate.ts` — 处理降级情况
- `apps/server/src/modules/rag/nodes/agent.ts` — 阈值不足时不反复重试

**验收标准**：问知识库完全无关的问题 → 返回"未找到相关信息"提示，而非 LLM 编造内容

**工时**：1h | **风险**：低

---

## 第二层：检索与 RAG 质量提升（5 项，~15.5h）

> 目标：第一层保证"能搜到"，第二层确保"搜得准"+"答得好"。

### 2.1 Cross-Encoder Reranker 升级

**现状**：[reranker.ts](../../apps/server/src/modules/search/fusion/reranker.ts) 为 MVP 简化版——关键词命中打分（`score*0.4 + (hitCount/queryTokens)*0.6`），非语义精排。

**设计**：

```typescript
// 使用 @xenova/transformers 本地 ONNX 推理
import { pipeline } from '@xenova/transformers';

class CrossEncoderReranker {
  private model: any;

  async rerank(query: string, chunks: ChunkResult[]): Promise<ChunkResult[]> {
    // 懒加载 bge-reranker-v2-m3（首次加载 10-30s，~1.2GB）
    if (!this.model) {
      this.model = await pipeline('text-classification',
        'Xenova/bge-reranker-v2-m3');
    }

    // 为每个 (query, chunk_text) 对打分
    const pairs = chunks.map(c => `${query} [SEP] ${c.text}`);
    const scores = await this.model(pairs);

    // 排序返回（保留原始 score + 新增 rerankScore）
    return chunks
      .map((c, i) => ({ ...c, rerankScore: scores[i].score }))
      .sort((a, b) => b.rerankScore - a.rerankScore);
  }
}
```

**降级策略**：本地模型加载失败 → 自动回退到已有关键词命中算法（原代码保留作为 fallback）。

**选择 @xenova/transformers 而非调 API 的原因**：免费、无网络依赖、精排延迟 100-300ms 可接受、`bge-reranker-v2-m3` ONNX 版本成熟、中文效果好。

**涉及文件**：

- `apps/server/src/modules/search/fusion/reranker.ts` — 核心替换
- `apps/server/package.json` — 新增 `@xenova/transformers`

**验收标准**：同 query 升级前后对比，Top-3 准确率明显提升（定性：问"报销流程"→ 返回报销制度文档而非无关内容）

**工时**：4h | **风险**：中（模型 1.2GB，首次加载慢）

---

### 2.2 追问降级

**现状**：追问"那第二个呢？""详细说说？"时，Agent 仍执行完整三路检索，既慢又容易搜偏。

**设计**：

```typescript
// intent.ts 中新增追问检测
function detectFollowUp(message: string, history: Message[]): boolean {
  // 规则层（毫秒级，不调 LLM）:
  const patterns = [
    /^(那|那么|这个|那个|它|这|那|上面|前面|刚才)/,
    /^(第二个|第\d+个|还有呢|继续说|详细|展开)/,
    /^(能|可以|能不能).*(详细|具体|再|展开)/,
    /^(什么意思|为什么|然后呢|接着说|所以呢)/,
    /^[再还]?(说|讲|解释|介绍)/,
    /^(哦|嗯|啊)/,
  ];
  if (patterns.some(p => p.test(message.trim()))) return true;

  // 短消息 + 有历史 → 大概率是追问
  if (message.trim().length < 10 && history.length > 0) return true;

  return false;
}

// graph.ts 新增分支:
intent_classifier
  ├─ chat      → direct_answer
  ├─ simple    → simple_retrieval
  ├─ complex   → agent (max 5 轮)
  └─ followup  → agent_followup (max 2 轮, 复用缓存结果)
```

**追问模式行为**：不重新检索，直接用当前 session 的 Redis 缓存检索结果；Agent 最大轮次降为 2；重点加载对话历史上下文。

**涉及文件**：

- `apps/server/src/modules/rag/nodes/intent.ts` — 新增 `detectFollowUp()`
- `apps/server/src/modules/rag/nodes/routes.ts` — 新增 `followup` 路由
- `apps/server/src/modules/rag/graph.ts` — 新增 `agent_followup` 节点
- `apps/server/src/modules/rag/nodes/agent.ts` — 支持 `maxRounds` 参数

**验收标准**：问"公司有多少天年假？"→ 回答后追问"那病假呢？"→ 不执行完整三路检索，直接复用上下文回答

**工时**：3h | **风险**：中（新增 graph 分支，需确保不误判普通短问题）

---

### 2.3 检索缓存启用

**现状**：`redis.adapter.ts` 已实现 `cacheSearch()` / `getCachedSearch()`，但 `SearchService` 中没调用——缓存逻辑存在但"断连"。

**设计**：

```typescript
// SearchService.hybridSearch() 中插入:
async hybridSearch(query: string, options: SearchOptions) {
  // 1. 查缓存
  const cacheKey = `cache:search:${simpleHash(query)}:${options.userId}`;
  const cached = await this.redis.getCachedSearch(cacheKey);
  if (cached) return cached;  // 命中→跳过全部检索

  // 2. 原有逻辑: 三路并行检索
  const results = await Promise.all([...]);

  // 3. RRF + Rerank
  const fused = this.rrfFuse(results);
  const reranked = await this.reranker.rerank(query, fused);

  // 4. 写入缓存 (TTL 30min, redis.adapter 已处理)
  await this.redis.cacheSearch(cacheKey, reranked);

  return reranked;
}
```

**缓存失效**：新文档上传/索引完成 → 不主动清缓存（30 分钟 TTL 足够短，自然过期）。

**涉及文件**：

- `apps/server/src/modules/search/search.service.ts` — 插入缓存逻辑（~10 行）

**验收标准**：同一 query 两次请求 → 第二次毫秒级返回 → Redis 中存在 `cache:search:*` key

**工时**：0.5h | **风险**：低

---

### 2.4 检索来源标注

**现状**：LLM 生成答案后直接返回文本，用户看不到信息来自哪个文档，无法判断可信度。

**设计**：

```typescript
// generate.ts Prompt 增强:
`
基于以下知识库片段回答用户问题。在答案中关键信息后标注来源编号 [1]、[2]。

知识库片段:
[1] (来源: {{docName}}) {{chunk1_text}}
[2] (来源: {{docName}}) {{chunk2_text}}
...

用户问题: {{query}}
`

// SSE 返回格式增强:
// 现有:
event: token
data: {"token": "根据公司规定"}

// 新增 sources 事件（在 done 之前发送）:
event: sources
data: {"sources": [{"index": 1, "docName": "员工手册.pdf", "docId": "xxx", "chunkId": "yyy"}]}

event: done
data: [DONE]
```

**前端展示**：聊天气泡底部展示 `📎 参考来源：员工手册.pdf、考勤制度.docx`，点击可跳转文档详情页。

**涉及文件**：

- `apps/server/src/modules/rag/nodes/generate.ts` — Prompt 指令 + 提取 sources
- `apps/server/src/modules/chat/chat.service.ts` — SSE 新增 `sources` 事件
- `apps/web/src/hooks/useSSE.ts` — 解析 sources 事件
- `apps/web/src/pages/chat/ChatPage.tsx` — 渲染来源标签

**验收标准**：问答返回带编号标注 → 前端展示来源文档名 → 点击跳转文档详情

**工时**：2h | **风险**：低

---

### 2.5 自动化评测脚本

**现状**：零自动化评测，RAG 质量全靠人工感受。

**设计**：

```
scripts/eval/
├── eval.ts              # 评测主入口
├── test-cases.json      # 测试用例集（30+ 条）
├── metrics.ts           # 指标计算
└── report.ts            # 报告输出（终端表格 + JSON）

// 测试用例结构:
{
  "query": "公司年假怎么申请？",
  "expectedChunks": ["年假申请流程", "请假制度"],
  "expectedAnswer": ["提前.*天", "审批"],
  "intent": "complex",
  "category": "hr_policy"
}

// 评估指标:
1. 检索召回率:   期望 chunk 关键词在 top-5 中的命中率
2. 答案准确性:   expectedAnswer 正则匹配率
3. 意图分类准确率: 分类结果 vs 标注
4. 检索延迟:     P50/P95/P99
5. 端到端延迟:   提问→首 token / 提问→完成
```

**运行方式**：独立脚本 `npx ts-node scripts/eval/eval.ts`，不嵌入 CI（CI 集成放第三层 LangFuse 之后）。

**涉及文件**：

- `scripts/eval/eval.ts` — 新文件
- `scripts/eval/test-cases.json` — 新文件
- `scripts/eval/metrics.ts` — 新文件
- `scripts/eval/report.ts` — 新文件

**验收标准**：运行脚本 → 输出完整评测报告 → 每次 RAG 改动后可重新跑看指标变化

**工时**：6h | **风险**：低（独立脚本，不侵入业务代码）

---

## 第三层：生产加固（3 项，~10h）

> 目标：系统可观测、异步解耦、故障自愈。

### 3.1 LangFuse 全链路监控

**现状**：零可观测性——出问题不知道是意图分错了、检索没召回、还是 LLM 编造。

**设计**：

```typescript
// 新增 LangfuseService 封装 trace
class LangfuseService {
  // trace 层级:
  // ChatService.streamAnswer()
  //   └─ trace: { name: 'chat', userId, sessionId, input: query }
  //
  //     ├─ span: intent_classifier
  //     │    input: query, output: { intent }
  //     │
  //     ├─ span: retrieval
  //     │    ├─ pgvector_search  (latency, result_count)
  //     │    ├─ es_search        (latency, result_count)
  //     │    └─ neo4j_query      (latency, result_count)
  //     │
  //     ├─ span: rrf_fusion  (input_count, output_count)
  //     ├─ span: rerank      (latency, top_score)
  //     │
  //     └─ span: generate_answer
  //          input: { query, chunks[] }, output: answer
}

// LangFuse Dashboard 自动聚合:
// - 意图分类分布（chat/simple/complex/followup 占比）
// - 各检索链路平均延迟
// - Agent 平均工具调用轮次
// - 阈值降级触发率
// - 端到端 P50/P95/P99 延迟
```

**SDK 选型**：原生 `langfuse` npm 包（非 `@langchain/langfuse`），在关键节点手动调用 `trace.span()`——因为当前是手动构建 LangGraph，非 LangChain callback 模式。

**涉及文件**：

- `apps/server/src/common/observability/langfuse.service.ts` — 新增
- `apps/server/src/modules/chat/chat.service.ts` — 包裹 trace
- `apps/server/src/modules/rag/nodes/intent.ts` — span: intent
- `apps/server/src/modules/rag/nodes/retrieval.ts` — span: tools
- `apps/server/src/modules/rag/nodes/generate.ts` — span: generation
- `apps/server/src/modules/search/search.service.ts` — span: search
- `apps/server/package.json` — 新增 `langfuse`
- `.env` — 新增 `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`

**验收标准**：发一条问答 → LangFuse Dashboard 可见完整 trace（意图→检索→生成各段耗时明细）

**工时**：4h | **风险**：中（需注册 LangFuse Cloud 或自建实例）

---

### 3.2 阶段二消息队列异步化

**现状**：阶段二索引是同步 fire-and-forget，无重试，无持久化。

**设计**：

```
选型: BullMQ（基于 Redis，项目已有 Redis，零额外基础设施）

上传成功 (status=parsed)
  │
  └─→ queue.add('index-document', { docId })
       │
       ▼
  ┌─────────────────────────────────┐
  │  IndexWorker                     │
  │  process(job) {                  │
  │    try {                         │
  │      → status = 'indexing'       │
  │      → indexDocument(docId)      │
  │      → status = 'indexed'        │
  │    } catch (e) {                 │
  │      → retryCount < 3 ?         │
  │        throw (BullMQ 自动重试)   │
  │        : status = 'failed'       │
  │    }                             │
  │  }                               │
  └─────────────────────────────────┘

配置:
  - 最大重试: 3 次
  - 退避: 指数 (1s → 2s → 4s)
  - 并发: 2（向量化 CPU 密集，限制并发）
```

**BullMQ vs RabbitMQ 选择**：已有 Redis，BullMQ 零额外基础设施；文档上传频率不高，Redis 持久化够用；NestJS `@nestjs/bullmq` 开箱即用。

**涉及文件**：

- `apps/server/src/modules/document/services/index-queue.service.ts` — 新增（producer）
- `apps/server/src/modules/document/services/index-worker.service.ts` — 新增（consumer）
- `apps/server/src/modules/document/document.service.ts` — 替换为 `queue.add()`
- `apps/server/src/modules/document/document.module.ts` — 注册 BullMQ
- `apps/server/package.json` — 新增 `@nestjs/bullmq` `bullmq`

**验收标准**：上传文档 → 队列可见任务 → worker 自动消费 → status indexed → 失败自动重试 3 次 → 仍失败标记 failed

**工时**：4h | **风险**：中（引入新依赖）

---

### 3.3 错误处理与重试机制

**现状**：LLM 调用失败直接抛异常给用户，无统一错误格式。

**设计**：

```typescript
// 1. LLM API 重试（指数退避）
async function withLLMRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt === 3) throw e;
      if (isRetryable(e)) {        // 429 / 5xx / network error
        await sleep(2 ** attempt * 1000);  // 2s → 4s → 8s
        continue;
      }
      throw e;  // 4xx 不重试
    }
  }
}

// 2. 全局异常过滤器（统一错误响应格式）
{
  "code": 400,
  "message": "用户名已存在",
  "traceId": "d4e5f6g7",
  "timestamp": "2026-07-30T10:30:00Z"
  // 生产环境不返回 stack
}

// 3. 数据库重连确认
// PG: pool { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 }
// Redis: retryStrategy(times) { return Math.min(times * 100, 3000) }
// ES: maxRetries: 3, requestTimeout: 30000
```

**涉及文件**：

- `apps/server/src/common/filters/all-exceptions.filter.ts` — 新增全局过滤器
- `apps/server/src/common/utils/retry.util.ts` — 新增 LLM 重试工具
- `apps/server/src/modules/rag/rag.service.ts` — 包裹 LLM 调用
- `apps/server/src/main.ts` — 注册全局过滤器
- `apps/server/src/database/*/` — 确认各库重连配置

**验收标准**：断开 LLM API → 自动重试 3 次 → 仍失败返回 `{ code: 500, message: "...", traceId: "..." }`

**工时**：2h | **风险**：低

---

## 第四层：功能增强（5 项，~30.5h）

> 目标：用户体验完整、功能丰富、长期可维护。

### 4.1 动态 RBAC 管理后台

**现状**：3 个角色写死在 seed 数据里，改权限要直接操作数据库。

**设计**：

```
后端新增模块: modules/rbac/

API (需 admin):
  GET    /api/rbac/roles              — 角色列表
  POST   /api/rbac/roles              — 创建角色
  PATCH  /api/rbac/roles/:id          — 更新角色
  DELETE /api/rbac/roles/:id          — 删除角色（有关联用户时禁止）
  GET    /api/rbac/permissions        — 权限列表
  GET    /api/rbac/users/:id/roles    — 查看用户角色
  POST   /api/rbac/users/:id/roles    — 分配角色

数据模型:
  permissions 表 (已有 seed): id, code, name, description, group
  roles 表 (已有, 扩展): id, name, description, is_system, permissions: JSON
  user_roles (已有): user_id, role_id

按钮级权限:
  前端: <Can permission="document:delete"><Button>删除</Button></Can>
  后端: @RequirePermission('document:delete') 装饰器 Guard
  JWT payload 扩展: { ..., permissions: ['document:delete', ...] }

前端新增页面: /admin/roles
  - 角色列表（名称、权限数、用户数）
  - 角色编辑弹窗（权限 checkbox 分组选择）
  - 用户角色分配
```

**涉及文件**：

- `apps/server/src/modules/rbac/` — 新模块（controller + service + dto）
- `apps/server/src/common/guards/permission.guard.ts` — 新增
- `apps/server/src/modules/auth/auth.service.ts` — JWT payload 附加 permissions
- `apps/web/src/pages/admin/` — 新页面
- `apps/web/src/components/common/Can.tsx` — 权限控制组件
- `apps/web/src/components/layout/Layout.tsx` — 侧边栏按权限显示

**验收标准**：admin 登录→可见"系统管理"→创建/编辑角色→给用户分配角色→对应权限生效

**工时**：8h | **风险**：中（权限逻辑改动，需仔细测试）

---

### 4.2 语音实时对话（WebSocket 音频 + SSE 文字）

**现状**：`ChatGateway` WebSocket 为骨架，未接入 ASR/TTS。

**设计**：

```
双通道架构:

  浏览器                                  后端
  ───────                                  ────
           ┌── WebSocket ──────────────┐
  麦克风 ──▶ 发送: PCM 音频分片         ──▶ ASR (阿里云实时识别)
                                            │
                                            ▼
                                        文字累积完成
                                            │
                                            ├──▶ RAG 引擎
                                            │
           ┌── SSE ───────────────────┐     │
  文字气泡 ◀── 接收: token 流           ◀────┘  (复用现有 SSE 链路)
                                            │
           ┌── WebSocket ──────────────┐     │
  扬声器   ◀── 接收: TTS 音频分片         ◀────┘  (文字累积到句子粒度 → TTS)
           └──────────────────────────┘

时序:
  1. 用户开始说话
     → WebSocket 持续发送 PCM 音频分片
     → ASR 返回中间识别结果（partial）
     → 前端显示"正在识别..." + 实时文字

  2. 用户停止说话（VAD 检测静音 800ms）
     → ASR 返回最终文字（final）
     → 触发 RAG 引擎

  3. RAG 生成回答
     → SSE: 逐 token 推送文字（复用现有流式链路）
     → 同时: 文字累积到标点断句 → TTS 合成 → WebSocket 推送音频
     → 前端: 文字逐字出现 + 同步播放语音

  4. 用户可随时插话（barge-in）
     → 新音频到达 → 中止当前 SSE + TTS
     → 清空上轮未播完的音频队列
     → 开始新一轮识别
```

**两个通道职责**：

| | WebSocket | SSE |
|---|---|---|
| 方向 | 双向（音频上下行） | 单向（服务端→文字） |
| 内容 | PCM 音频分片 | JSON token 事件 |
| 生命周期 | 整个语音会话期间保持 | 每次 RAG 回答时新建 |
| 地址 | `ws://localhost:3001/chat/voice` | `POST /api/chat/stream`（已有） |

**技术选型**：

- ASR：阿里云 NLS WebSocket（实时流式识别，支持中间结果 + VAD 自动断句）
- TTS：阿里云 NLS 流式合成（按标点断句逐句合成，PCM 输出）
- 前端录音：MediaRecorder API → PCM 分片
- 前端播放：AudioContext + 环形缓冲队列（可中断）

**涉及文件**：

- `apps/server/src/modules/chat/gateways/voice.gateway.ts` — 重写：处理音频上下行
- `apps/server/src/modules/chat/services/asr.service.ts` — 新增
- `apps/server/src/modules/chat/services/tts.service.ts` — 新增
- `apps/server/src/modules/chat/chat.service.ts` — SSE 支持语音触发
- `apps/web/src/hooks/useVoiceChat.ts` — 新增
- `apps/web/src/components/chat/VoiceButton.tsx` — 新增
- `apps/web/src/pages/chat/ChatPage.tsx` — 集成双通道 UI
- `.env` — 阿里云 ASR/TTS 密钥

**验收标准**：
1. 点击语音按钮 → WebSocket 连接建立
2. 说话中 → 前端实时显示 ASR 中间识别文字
3. 说完停顿 → SSE 推送回答 token + 扬声器播放 TTS
4. 播放中再次说话 → 上一轮中止，新问题开始识别
5. 文字和语音同步推进，无明显错位

**工时**：12h | **风险**：高（依赖阿里云 NLS API，双通道协调复杂度）

---

### 4.3 多模态图文检索（图片描述桥接方案）

**现状**：文档图片存于 RustFS，无向量索引，无法按图片内容检索。

**本期方案：图片→多模态 LLM 描述→文本向量（零额外基础设施）**

```
chunk 含图片时 (has_image: true):
  → 调用多模态 LLM 生成图片描述
  → "这是一张系统架构图，展示前端、后端、数据库三层结构"
  → 描述文本追加到 chunk.text
  → 文本 embedding 自然覆盖图片语义

效果: 搜"架构图" → 文本匹配"系统架构图" → 检索命中

完整 CLIP 多模态检索（需 GPU + 图片向量存储）留待后续。
```

**涉及文件**：

- `apps/server/src/modules/document/services/indexer.service.ts` — has_image chunk 调用多模态生成描述
- `apps/server/src/modules/document/services/chunker.service.ts` — 传递 has_image 标记

**验收标准**：上传含架构图的文档 → 问"架构图是什么"→ 检索到相关 chunk → 回答包含图片描述

**工时**：1.5h | **风险**：低

---

### 4.4 统计仪表盘

**现状**：无任何数据统计。

**设计**：

```
后端模块: modules/analytics/

API (需 admin/dept_admin):
  GET /api/analytics/overview
    → { docCount, totalChunks, totalSessions, avgLatency }

  GET /api/analytics/documents
    → { byType: {pdf: N, docx: M, ...},
        byStatus: {indexed: N, failed: M, ...},
        uploadTrend: [{date, count}, ...] }

  GET /api/analytics/chat
    → { totalQuestions, topQueries, avgRounds,
        intentDistribution: {chat, simple, complex, followup},
        degradeRate }

  GET /api/analytics/users
    → { totalUsers, activeUsers, newUsersThisWeek }

数据来源:
  - Postgres: documents 表 → 文档统计
  - 新增 chat_logs 表 → 问答统计（当前无独立记录）
  - 降级: 无 chat_logs → 先基于 Redis session 粗略统计
```

**前端新增页面** `/analytics`：概览卡片、文档趋势折线图、意图分类饼图、热门问题 Top 10。

**涉及文件**：

- `apps/server/src/modules/analytics/` — 新模块
- `apps/server/src/database/postgres/` — 新增 chat_logs 迁移
- `apps/web/src/pages/analytics/` — 新页面
- `apps/web/src/components/layout/Layout.tsx` — 侧边栏新增入口

**验收标准**：admin 登录→可见仪表盘→数据与实际使用一致

**工时**：6h | **风险**：中（依赖 chat_logs 表，需确认表结构）

---

### 4.5 文档管理完善

**现状**：前端 `DocumentManagePage` 为占位，后端无删除/预览/重索引 API。

**设计**：

```
后端新增:
  DELETE  /api/documents/:id
    → 级联清理: RustFS(文件+图片) → MongoDB(正文) → PGVector(chunks)
      → ES(chunks) → Neo4j(entities+chunks) → Postgres(元信息)
    → MVP 硬删除

  GET  /api/documents/:id/preview
    → { metadata: {...}, markdown: "..." }
    → 纯文本展示（安全考虑，不渲染 HTML）

  POST /api/documents/:id/reindex
    → 清除旧索引(ES + Neo4j + PGVector chunks)
    → 重新入队阶段二
    → 仅 status=failed 或 status=indexed 时可操作

前端:
  DocumentManagePage: 文档表格 + 操作列
    - 预览按钮 → 弹窗展示 Markdown 原文
    - 删除按钮 → 二次确认 → 删除
    - 重索引按钮 → failed 文档可见
    - 状态标签: indexed=绿, failed=红, indexing=蓝(动画)
```

**涉及文件**：

- `apps/server/src/modules/document/document.controller.ts` — 新增 3 端点
- `apps/server/src/modules/document/document.service.ts` — 新增 delete/preview/reindex
- `apps/web/src/pages/document/DocumentManagePage.tsx` — 替换占位

**验收标准**：上传 3 文档 → 管理页展示列表 → 预览 → 删除一项 → 确认各存储均已清理

**工时**：5h | **风险**：中（级联删除需仔细验证，确保不残留）

---

## 总览

| 层 | 项 | 工时 | 累计 | 风险最高项 |
|----|----|------|------|-----------|
| 第一层：补全缺口 | 4 | ~4.5h | 4.5h | — |
| 第二层：质量提升 | 5 | ~15.5h | 20h | Cross-Encoder Reranker |
| 第三层：生产加固 | 3 | ~10h | 30h | BullMQ 异步队列 |
| 第四层：功能增强 | 5 | ~30.5h | **~60.5h** | 语音双通道 |

### 执行顺序

```
第一层（4.5h）
  ├─ 1.1 PGVector 向量写入
  ├─ 1.3 索引触发 API
  ├─ 1.2 文档列表接口
  └─ 1.4 阈值检查与降级
      │
第二层（15.5h）
  ├─ 2.3 检索缓存（最快见效）
  ├─ 2.1 Cross-Encoder Reranker（核心质量提升）
  ├─ 2.2 追问降级
  ├─ 2.4 检索来源标注
  └─ 2.5 自动化评测脚本
      │
第三层（10h）
  ├─ 3.1 LangFuse 监控
  ├─ 3.2 BullMQ 异步队列
  └─ 3.3 错误处理与重试
      │
第四层（30.5h）
  ├─ 4.5 文档管理完善
  ├─ 4.1 动态 RBAC 后台
  ├─ 4.4 统计仪表盘
  ├─ 4.3 图片描述增强
  └─ 4.2 语音实时对话
```

---

## 关联文档

- [原始设计文档](./2026-07-29-knowledge-base-rag-design.md) — 整体架构、存储设计、RAG 工作流
- [手动测试指南](../手动测试指南.md) — 15 模块测试用例
- [测试通过后下一步计划](../测试通过后下一步计划.md) — 早期版本计划（本文档已覆盖并扩展）
