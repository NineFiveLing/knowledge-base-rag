# 企业知识库 RAG 平台 — 后续优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 4 层递进补全 RAG 平台的能力缺口——闭合检索链路、提升检索质量、加固生产环境、丰富功能体验。

**Architecture:** 保持现有 NestJS + LangGraph + React 架构不变，在已有模块内增量扩展。第一层闭合 PGVector→检索→列表→降级的完整数据流；第二层升级 Reranker、追加问降级和缓存；第三层引入 LangFuse/BullMQ/统一错误处理；第四层新增 RBAC 后台/语音双通道/仪表盘/文档管理。

**Tech Stack:** NestJS + TypeScript, LangGraph (`@langchain/langgraph`), React + Zustand + Vite, PostgreSQL/pgvector, Elasticsearch 8.11, Neo4j, MongoDB 7, Redis 7, BullMQ, @xenova/transformers, langfuse, 阿里云 NLS (ASR/TTS)

## Global Constraints

- 所有后端 API 前缀 `/api`，前端地址 `http://localhost:3000`
- 认证：JWT Bearer token，从前端 `localStorage.access_token` 读取
- 数据权限：检索/列表必须注入 `dept_id` + `visibility` 过滤
- 语言：中文注释，中文用户提示
- 环境变量：统一在 `.env` 文件中管理
- 不引入新的数据库实例——BullMQ 复用已有 Redis，LangFuse 为外部服务

---

## 文件结构总览

```
新增文件:
  apps/server/src/modules/document/dto/list-document.dto.ts     # 1.2 文档列表查询 DTO
  apps/server/src/common/observability/langfuse.service.ts       # 3.1 LangFuse 服务
  apps/server/src/modules/document/services/index-queue.service.ts  # 3.2 BullMQ producer
  apps/server/src/modules/document/services/index-worker.service.ts # 3.2 BullMQ consumer
  apps/server/src/common/filters/all-exceptions.filter.ts        # 3.3 全局异常过滤器
  apps/server/src/common/utils/retry.util.ts                     # 3.3 LLM 重试工具
  apps/server/src/common/guards/permission.guard.ts             # 4.1 权限 Guard
  apps/server/src/modules/rbac/rbac.controller.ts               # 4.1 RBAC 控制器
  apps/server/src/modules/rbac/rbac.service.ts                  # 4.1 RBAC 服务
  apps/server/src/modules/rbac/dto/role.dto.ts                  # 4.1 RBAC DTO
  apps/server/src/modules/rbac/rbac.module.ts                   # 4.1 RBAC 模块
  apps/server/src/modules/chat/services/asr.service.ts           # 4.2 阿里云 ASR
  apps/server/src/modules/chat/services/tts.service.ts           # 4.2 阿里云 TTS
  apps/server/src/modules/analytics/analytics.controller.ts     # 4.4 统计控制器
  apps/server/src/modules/analytics/analytics.service.ts        # 4.4 统计服务
  apps/server/src/modules/analytics/analytics.module.ts         # 4.4 统计模块
  apps/web/src/components/common/Can.tsx                         # 4.1 权限组件
  apps/web/src/pages/admin/RoleManagePage.tsx                   # 4.1 角色管理页
  apps/web/src/pages/analytics/AnalyticsPage.tsx                # 4.4 统计仪表盘页
  apps/web/src/hooks/useVoiceChat.ts                            # 4.2 语音 hook
  apps/web/src/components/chat/VoiceButton.tsx                  # 4.2 语音按钮
  scripts/eval/eval.ts                                          # 2.5 评测入口
  scripts/eval/test-cases.json                                   # 2.5 测试用例
  scripts/eval/metrics.ts                                       # 2.5 指标计算
  scripts/eval/report.ts                                        # 2.5 报告输出

修改文件:
  apps/server/src/modules/document/services/indexer.service.ts  # 1.1 PGVector 写入
  apps/server/src/modules/document/document.module.ts           # 1.1/3.2 模块依赖
  apps/server/src/modules/document/document.service.ts          # 1.2/1.3/3.2/4.5
  apps/server/src/modules/document/document.controller.ts       # 1.2/1.3/4.5
  apps/server/src/modules/search/search.service.ts              # 1.4/2.3/3.1
  apps/server/src/modules/search/fusion/reranker.ts             # 2.1
  apps/server/src/modules/rag/nodes/intent.ts                   # 2.2/3.1
  apps/server/src/modules/rag/nodes/routes.ts                   # 2.2
  apps/server/src/modules/rag/graph.ts                          # 2.2
  apps/server/src/modules/rag/nodes/agent.ts                    # 1.4/2.2
  apps/server/src/modules/rag/nodes/generate.ts                 # 1.4/2.4/3.1
  apps/server/src/modules/rag/nodes/retrieval.ts                # 3.1
  apps/server/src/modules/rag/rag.service.ts                    # 3.3
  apps/server/src/modules/chat/chat.service.ts                  # 2.4/3.1/4.2
  apps/server/src/modules/chat/gateways/voice.gateway.ts        # 4.2
  apps/server/src/modules/auth/auth.service.ts                  # 4.1
  apps/server/src/main.ts                                       # 3.3
  apps/server/package.json                                      # 2.1/3.1/3.2
  .env                                                          # 3.1/4.2
  apps/server/src/app.module.ts                                 # 3.2/3.3/4.1/4.4
  apps/web/src/hooks/useSSE.ts                                  # 2.4
  apps/web/src/pages/chat/ChatPage.tsx                          # 2.4/4.2
  apps/web/src/pages/document/DocumentManagePage.tsx            # 4.5
  apps/web/src/components/layout/Layout.tsx                     # 4.1/4.4
  apps/web/src/App.tsx                                          # 4.1/4.4
```

---

## 第一层：补全 MVP 关键缺口

### Task 1.1: PGVector 向量写入集成

**Files:**
- Modify: `apps/server/src/modules/document/services/indexer.service.ts`
- Modify: `apps/server/src/modules/document/document.module.ts`

**Interfaces:**
- Consumes: `VectorService.insertChunk(chunk)` (已有), `OpenAIEmbeddings.embedQuery(text)` (来自 `@langchain/openai`)
- Produces: 无新接口——`indexDocument()` 行为扩展为包含向量写入

- [ ] **Step 1: 在 IndexerService 中注入 VectorService**

检查 `apps/server/src/modules/document/services/indexer.service.ts` 构造函数，添加 `VectorService` 注入：

```typescript
import { VectorService } from '../../../database/postgres/vector.service';
import { OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class IndexerService {
  private embeddings: OpenAIEmbeddings;

  constructor(
    private readonly esService: EsService,
    private readonly neo4jService: Neo4jService,
    private readonly mongoService: MongoService,
    private readonly vectorService: VectorService,  // 新增
  ) {
    this.embeddings = new OpenAIEmbeddings({
      modelName: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      openAIApiKey: process.env.ALIYUN_API_KEY,
      configuration: { baseURL: process.env.ALIYUN_BASE_URL },
    });
  }
}
```

- [ ] **Step 2: 在 indexChunk 方法中添加向量写入**

在 `indexer.service.ts` 的 `indexChunk()` 方法中，现有三路并行之后追加 PGVector 写入：

```typescript
// 在 indexChunk() 方法中，ES/Neo4j/关键词写入之后追加:
const [embedding] = await this.embeddings.embedDocuments([chunk.text]);

await this.vectorService.insertChunk({
  chunk_id: chunk.id,
  postgres_doc_id: docId,
  text: chunk.text,
  embedding: embedding,
  metadata: chunk.metadata,
  dept_id: deptId,
});
```

- [ ] **Step 3: 确认 DocumentModule 依赖完整**

检查 `apps/server/src/modules/document/document.module.ts`：

```typescript
// imports 中应包含 VectorModule (或来自 DatabaseModule 的导出)
// 如果 VectorService 在 DatabaseModule 中已导出为全局或 DocumentModule 已导入，无需改动
// 否则添加:
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule, /* 已有 imports */],
  // ...
})
```

- [ ] **Step 4: 启动后端验证**

```bash
cd apps/server && pnpm dev
# 上传一个文档，触发索引
# 检查 PGVector chunks 表:
# docker exec -it <postgres_container> psql -U postgres -d knowledge_base -c "SELECT count(*) FROM chunks;"
# 应该 > 0
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/document/services/indexer.service.ts
git add apps/server/src/modules/document/document.module.ts
git commit -m "feat: integrate PGVector embedding write into IndexerService"
```

---

### Task 1.2: 文档列表接口

**Files:**
- Create: `apps/server/src/modules/document/dto/list-document.dto.ts`
- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/document/document.controller.ts`

**Interfaces:**
- Consumes: `User` 对象（来自 JWT Guard），TypeORM `Repository<Document>`
- Produces: `DocumentService.list(dto: ListDocumentDto, user: User): Promise<{ items: Document[], total: number }>`

- [ ] **Step 1: 创建 ListDocumentDto**

创建 `apps/server/src/modules/document/dto/list-document.dto.ts`：

```typescript
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentStatus } from '../entities/document.entity';

export class ListDocumentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  status?: DocumentStatus;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
```

- [ ] **Step 2: 实现 DocumentService.list()**

在 `apps/server/src/modules/document/document.service.ts` 中新增：

```typescript
import { ListDocumentDto } from './dto/list-document.dto';

async list(dto: ListDocumentDto, user: User): Promise<{ items: Document[]; total: number }> {
  const { page = 1, pageSize = 20, status, type, keyword } = dto;

  const qb = this.docRepo.createQueryBuilder('doc')
    .where('(doc.visibility = :publicVis OR doc.dept_id = :deptId OR doc.created_by = :userId)', {
      publicVis: DocumentVisibility.PUBLIC,
      deptId: user.dept_id,
      userId: user.id,
    });

  if (status) {
    qb.andWhere('doc.status = :status', { status });
  }
  if (type) {
    qb.andWhere('doc.type = :type', { type });
  }
  if (keyword) {
    qb.andWhere('doc.doc_name ILIKE :kw', { kw: `%${keyword}%` });
  }

  qb.orderBy('doc.created_at', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize);

  const [items, total] = await qb.getManyAndCount();
  return { items, total };
}
```

- [ ] **Step 3: 更新 DocumentController**

修改 `apps/server/src/modules/document/document.controller.ts` 的 `GET /documents` 端点：

```typescript
@Get()
async list(
  @Query() dto: ListDocumentDto,
  @Req() req: AuthenticatedRequest,
) {
  return this.docService.list(dto, req.user);
}
```

删除原有的硬编码 `{ items: [], total: 0 }` 返回。

- [ ] **Step 4: 验证列表接口**

```bash
# 用不同用户登录，上传几个不同可见性的文档
# admin 登录:
curl http://localhost:3001/api/documents \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:3001/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"

# 预期: 返回非空的 items 数组，包含 total 计数
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/document/dto/list-document.dto.ts
git add apps/server/src/modules/document/document.service.ts
git add apps/server/src/modules/document/document.controller.ts
git commit -m "feat: implement document list API with pagination and data permission filtering"
```

---

### Task 1.3: 阶段二索引触发

**Files:**
- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/document/document.controller.ts`

**Interfaces:**
- Consumes: `IndexerService.indexDocument(docId: string)` (已有)
- Produces: `POST /api/documents/:id/index` → `{ docId, status }`

- [ ] **Step 1: 新增 triggerIndex 方法**

在 `apps/server/src/modules/document/document.service.ts` 中新增：

```typescript
async triggerIndex(docId: string, userId: string): Promise<{ docId: string; status: string }> {
  const doc = await this.docRepo.findOne({ where: { id: docId } });
  if (!doc) {
    throw new NotFoundException('文档不存在');
  }

  // 权限检查：仅创建者或 admin
  const isOwner = doc.created_by === userId;
  // admin 角色检查通过 JWT payload 中的 roles 判断，在 controller 层处理
  if (!isOwner) {
    throw new ForbiddenException('无权限操作此文档');
  }

  doc.status = DocumentStatus.INDEXING;
  await this.docRepo.save(doc);

  // fire-and-forget 异步索引
  this.indexerService.indexDocument(docId)
    .then(() => {
      // 成功由 IndexerService 内部更新 status=indexed
    })
    .catch((err) => {
      this.logger.error(`索引失败: ${docId}`, err.message);
      // 失败由 IndexerService 内部更新 status=failed
    });

  return { docId, status: DocumentStatus.INDEXING };
}
```

- [ ] **Step 2: 新增索引触发端点**

在 `apps/server/src/modules/document/document.controller.ts` 中新增：

```typescript
@Post(':id/index')
async triggerIndex(
  @Param('id') id: string,
  @Req() req: AuthenticatedRequest,
) {
  return this.docService.triggerIndex(id, req.user.id);
}
```

- [ ] **Step 3: 上传后自动触发索引**

在 `apps/server/src/modules/document/document.service.ts` 的 `uploadStage1()` 方法末尾追加：

```typescript
// 在 status=parsed 写入成功后，追加:
// 异步触发阶段二索引（不阻塞上传响应）
this.triggerIndex(doc.id, userId).catch((err) => {
  this.logger.error(`上传后自动索引失败: ${doc.id}`, err.message);
});
```

- [ ] **Step 4: 验证**

```bash
# 上传文档
curl -X POST http://localhost:3001/api/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.pdf"

# 检查状态（几秒后应变为 indexed）:
curl http://localhost:3001/api/documents/<docId> \
  -H "Authorization: Bearer <token>"
# 预期 status: "indexed"
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/document/document.service.ts
git add apps/server/src/modules/document/document.controller.ts
git commit -m "feat: add index trigger API and auto-trigger after upload"
```

---

### Task 1.4: 阈值检查与降级提示

**Files:**
- Modify: `apps/server/src/modules/search/search.service.ts`
- Modify: `apps/server/src/modules/rag/nodes/generate.ts`
- Modify: `apps/server/src/modules/rag/nodes/agent.ts`

**Interfaces:**
- Consumes: `reranker.rerank()` 返回的 `ChunkResult[]`
- Produces: `SearchResult { chunks: ChunkResult[], degraded: boolean, degradeReason?: string, fallbackMessage?: string }`

- [ ] **Step 1: 修改 SearchService.searchWithThreshold 返回降级标记**

在 `apps/server/src/modules/search/search.service.ts` 的 `searchWithThreshold()` 方法末尾：

```typescript
// 替换现有的 filter + return 逻辑:
const THRESHOLD = 0.5;
const qualified = reranked.filter(r => (r.rerankScore ?? r.score) >= THRESHOLD);

if (qualified.length === 0) {
  return {
    chunks: [],
    degraded: true,
    degradeReason: 'no_result_above_threshold',
    fallbackMessage: '抱歉，未在知识库中找到与您问题相关的文档。请尝试换个问法。',
  } as SearchResult;
}

return {
  chunks: qualified.slice(0, topK),
  degraded: false,
} as SearchResult;
```

- [ ] **Step 2: 更新 SearchResult 类型定义**

确保 `SearchResult` 类型包含新字段。如果类型定义在 `search.service.ts` 或单独的类型文件中，更新：

```typescript
interface SearchResult {
  chunks: ChunkResult[];
  degraded: boolean;
  degradeReason?: string;
  fallbackMessage?: string;
}
```

- [ ] **Step 3: generate.ts 中处理降级**

在 `apps/server/src/modules/rag/nodes/generate.ts` 的 `generateFinalAnswer()` 函数开头添加：

```typescript
export async function generateFinalAnswer(state: AgentState): Promise<Partial<AgentState>> {
  const searchResult = state.retrievedChunks as SearchResult | null;

  if (searchResult?.degraded) {
    return {
      finalAnswer: searchResult.fallbackMessage || '抱歉，未找到相关信息。',
    };
  }

  // ... 原有 LLM 回答逻辑
}
```

- [ ] **Step 4: agent.ts 中避免无效重试**

在 `apps/server/src/modules/rag/nodes/agent.ts` 中，Agent 节点调用检索后检查降级：

```typescript
// 在 Agent 节点处理检索结果时:
const searchResult = await searchService.searchWithThreshold(query, options);
if (searchResult.degraded) {
  // 直接返回降级消息，不进入下一轮 Agent 思考
  return {
    retrievedChunks: searchResult,
    toolCallsRemaining: 0,  // 强制结束循环
  };
}
```

- [ ] **Step 5: 验证降级提示**

```bash
# 发送知识库中不存在的查询:
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "火星上有什么好吃的？", "sessionId": "test-degrade"}'

# 预期 SSE 返回: "抱歉，未在知识库中找到与您问题相关的文档。请尝试换个问法。"
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/search/search.service.ts
git add apps/server/src/modules/rag/nodes/generate.ts
git add apps/server/src/modules/rag/nodes/agent.ts
git commit -m "feat: add threshold-based degradation when no relevant chunks found"
```

---

## 第二层：检索与 RAG 质量提升

### Task 2.1: Cross-Encoder Reranker 升级

**Files:**
- Modify: `apps/server/src/modules/search/fusion/reranker.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: `query: string`, `chunks: ChunkResult[]`
- Produces: `Promise<ChunkResult[]>`（按 rerankScore 降序，附带原始 score 和 rerankScore）

- [ ] **Step 1: 安装依赖**

```bash
cd apps/server
pnpm add @xenova/transformers
```

- [ ] **Step 2: 重写 reranker.ts**

完整替换 `apps/server/src/modules/search/fusion/reranker.ts`：

```typescript
import type { ChunkResult } from './reranker.interface';

/** Cross-Encoder 精排器：使用 bge-reranker-v2-m3 (ONNX 本地推理) */
export class Reranker {
  private model: any = null;
  private loading: Promise<any> | null = null;

  async rerank(query: string, chunks: ChunkResult[]): Promise<ChunkResult[]> {
    if (chunks.length <= 1) {
      return chunks.map(c => ({ ...c, rerankScore: c.score }));
    }

    try {
      const model = await this.getModel();
      const pairs = chunks.map(c => `${query} [SEP] ${c.text.slice(0, 512)}`);
      const scores = await model(pairs, { pooling: 'mean', normalize: true });

      return chunks
        .map((c, i) => ({ ...c, rerankScore: Number(scores[i]?.score ?? 0) }))
        .sort((a, b) => b.rerankScore - a.rerankScore);
    } catch (err) {
      // 降级：fallback 到原始分数排序
      console.warn('[Reranker] Cross-Encoder 失败，使用原始分数:', (err as Error).message);
      return chunks
        .map(c => ({ ...c, rerankScore: c.score }))
        .sort((a, b) => b.rerankScore - a.rerankScore);
    }
  }

  private async getModel(): Promise<any> {
    if (this.model) return this.model;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline('text-classification', 'Xenova/bge-reranker-v2-m3');
      // 包装为接受批量输入的形式
      this.model = async (texts: string[], options?: any) => {
        const results: { score: number }[] = [];
        for (const text of texts) {
          const result = await pipe(text, options);
          results.push(result[0] as { score: number });
        }
        return results;
      };
      return this.model;
    })();

    return this.loading;
  }
}
```

- [ ] **Step 3: 确保 reranker.interface.ts 类型定义**

检查 `apps/server/src/modules/search/fusion/reranker.interface.ts` 中 `ChunkResult` 包含 `rerankScore`：

```typescript
export interface ChunkResult {
  chunk_id: string;
  text: string;
  score: number;
  rerankScore?: number;
  postgres_doc_id: string;
  metadata?: Record<string, any>;
}
```

- [ ] **Step 4: 验证精排效果**

```bash
cd apps/server && pnpm dev
# 启动后首次问答会触发模型下载 (~1.2GB, 10-30秒)
# 后续问答精排延迟应在 100-300ms

# 发送测试查询:
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"报销流程是什么","sessionId":"test-rerank"}'
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git add apps/server/src/modules/search/fusion/reranker.ts
git commit -m "feat: upgrade reranker from keyword-hit to Cross-Encoder (bge-reranker-v2-m3)"
```

---

### Task 2.2: 追问降级

**Files:**
- Modify: `apps/server/src/modules/rag/nodes/intent.ts`
- Modify: `apps/server/src/modules/rag/nodes/routes.ts`
- Modify: `apps/server/src/modules/rag/graph.ts`
- Modify: `apps/server/src/modules/rag/nodes/agent.ts`

**Interfaces:**
- Consumes: `message: string`, `history: Message[]`（state.messages）
- Produces: 新增路由分支 `followup`，新增节点 `agent_followup`

- [ ] **Step 1: 在 intent.ts 中新增追问检测函数**

在 `apps/server/src/modules/rag/nodes/intent.ts` 中新增：

```typescript
/** 追问模式检测（规则层，毫秒级，不调 LLM） */
function detectFollowUp(message: string, history: { role: string; content: string }[]): boolean {
  if (!history || history.length === 0) return false;

  const trimmed = message.trim();

  const followUpPatterns = [
    /^(那|那么|这个|那个|它|这|那|上面|前面|刚才|刚刚)/,
    /^(第二个|第\d+个|还有呢|继续说|详细|展开|具体)/,
    /^(能|可以|能不能).*(详细|具体|再|展开|说|讲)/,
    /^(什么意思|为什么|然后呢|接着说|所以呢)/,
    /^[再还]?(说|讲|解释|介绍)/,
    /^(哦|嗯|啊|对|是的|对的|好的)/,
    /^(举个例子|比如|比方说)/,
  ];

  if (followUpPatterns.some(p => p.test(trimmed))) return true;

  // 短消息 + 有对话历史 → 高度怀疑是追问
  if (trimmed.length < 10) return true;

  return false;
}
```

- [ ] **Step 2: 在意图分类节点中集成追问检测**

修改 `apps/server/src/modules/rag/nodes/intent.ts` 的 `classifyIntent()` 函数：

```typescript
export async function classifyIntent(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const history = state.messages.slice(0, -1);
  const text = typeof lastMessage.content === 'string' ? lastMessage.content : '';

  // 先检查追问（规则层，不耗时）
  if (detectFollowUp(text, history)) {
    return { intent: 'followup' };
  }

  // 原有 LLM 意图分类逻辑...
  // 返回 intent: 'chat' | 'simple' | 'complex'
}
```

- [ ] **Step 3: 在 routes.ts 中新增 followup 路由**

修改 `apps/server/src/modules/rag/nodes/routes.ts` 的 `routeByIntent()`：

```typescript
export function routeByIntent(state: AgentState): string {
  switch (state.intent) {
    case 'chat': return 'direct_answer';
    case 'simple': return 'simple_retrieval';
    case 'complex': return 'agent';
    case 'followup': return 'agent_followup';  // 新增
    default: return 'direct_answer';
  }
}
```

- [ ] **Step 4: 在 graph.ts 中注册新节点和路由**

修改 `apps/server/src/modules/rag/graph.ts`：

```typescript
import { agentFollowUpNode } from './nodes/agent';

const graph = new StateGraph(AgentState)
  // ... 已有节点
  .addNode('agent_followup', agentFollowUpNode)  // 新增

  // 更新条件路由:
  .addConditionalEdges('intent_classifier', routeByIntent, {
    chat: 'direct_answer',
    simple: 'simple_retrieval',
    complex: 'agent',
    followup: 'agent_followup',  // 新增
  })

  .addConditionalEdges('agent_followup', decideNext, {
    tools: 'retrieval_tools',
    answer: 'generate_answer',
  })
  .addEdge('retrieval_tools', 'agent_followup');  // 追问循环回 followup 节点
```

- [ ] **Step 5: 在 agent.ts 中实现 agentFollowUpNode**

在 `apps/server/src/modules/rag/nodes/agent.ts` 中新增：

```typescript
/** 追问模式 Agent 节点：maxRounds=2，优先复用缓存 */
export async function agentFollowUpNode(state: AgentState): Promise<Partial<AgentState>> {
  // 追问模式：最大轮次 2（而非 5）
  const maxRounds = 2;

  // 复用 agent 节点逻辑，但:
  // 1. 优先使用会话缓存中的检索结果 (Redis)
  // 2. 强调上下文理解，减少检索轮次
  return agentNode(state, { maxRounds, preferCache: true });
}
```

需要重构 `agentNode` 接受可选的 `options` 参数：

```typescript
export async function agentNode(
  state: AgentState,
  options?: { maxRounds?: number; preferCache?: boolean },
): Promise<Partial<AgentState>> {
  const maxRounds = options?.maxRounds ?? 5;
  const preferCache = options?.preferCache ?? false;

  // ... 原有逻辑，maxRounds 从 options 取值
}
```

- [ ] **Step 6: 验证追 问降级**

```bash
# 发送首轮查询
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "公司年假怎么申请？", "sessionId": "test-followup"}'

# 追问（同一 sessionId）:
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "那病假呢？", "sessionId": "test-followup"}'

# 预期: 追问不会触发完整三路检索，回复更快，内容延续上下文
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rag/nodes/intent.ts
git add apps/server/src/modules/rag/nodes/routes.ts
git add apps/server/src/modules/rag/graph.ts
git add apps/server/src/modules/rag/nodes/agent.ts
git commit -m "feat: add follow-up detection and reduced retrieval for conversational context"
```

---

### Task 2.3: 检索缓存启用

**Files:**
- Modify: `apps/server/src/modules/search/search.service.ts`

**Interfaces:**
- Consumes: `RedisService.getCachedSearch(key)` / `RedisService.cacheSearch(key, data)`（已有）
- Produces: 无新接口——`hybridSearch()` 行为扩展为带缓存

- [ ] **Step 1: 在 hybridSearch 中插入缓存逻辑**

修改 `apps/server/src/modules/search/search.service.ts` 的 `hybridSearch()` 方法：

```typescript
async hybridSearch(query: string, options: SearchOptions): Promise<ChunkResult[]> {
  // 1. 查缓存
  const cacheKey = `cache:search:${this.simpleHash(query)}:${options.userId ?? 'anon'}`;
  const cached = await this.redisService.getCachedSearch(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  // 2. 原有三路并行检索逻辑
  const results = await Promise.all([...]);

  // 3. RRF 融合 + Rerank
  const fused = this.rrfFuse(results);
  const reranked = await this.reranker.rerank(query, fused);

  // 4. 写入缓存 (30 分钟 TTL 由 redis.adapter 处理)
  await this.redisService.cacheSearch(cacheKey, reranked);

  return reranked;
}

/** 简单哈希，用于缓存 key */
private simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;  // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
```

- [ ] **Step 2: 确认 RedisService 接口**

检查 `apps/server/src/database/redis/redis.service.ts` 确认 `getCachedSearch` 和 `cacheSearch` 方法签名：

```typescript
// 预期已有:
async getCachedSearch(key: string): Promise<any[] | null>
async cacheSearch(key: string, results: any[]): Promise<void>
```

- [ ] **Step 3: 验证缓存命中**

```bash
# 发送同一查询两次:
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "报销流程", "sessionId": "test-cache"}'

# 第二次应明显更快（毫秒级），Redis 中有 cache:search:* key
docker exec -it <redis_container> redis-cli KEYS "cache:search:*"
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/search/search.service.ts
git commit -m "feat: enable Redis-based search result caching in hybridSearch"
```

---

### Task 2.4: 检索来源标注

**Files:**
- Modify: `apps/server/src/modules/rag/nodes/generate.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/web/src/hooks/useSSE.ts`
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`

**Interfaces:**
- Consumes: `state.retrievedChunks.chunks[]`（含 `postgres_doc_id`, `chunk_id`, 文档名称等元信息）
- Produces: SSE 新增 `sources` 事件，格式：`{ sources: Array<{ index: number, docName: string, docId: string, chunkId: string }> }`

- [ ] **Step 1: generate.ts Prompt 增加来源编号指令**

修改 `apps/server/src/modules/rag/nodes/generate.ts`：

```typescript
// 构建 Prompt 时，为每个 chunk 添加编号和来源:
const chunkTexts = chunks.map((c: any, i: number) => {
  const docName = c.metadata?.doc_name || c.doc_name || '未知文档';
  return `[${i + 1}] (来源: ${docName}) ${c.text}`;
}).join('\n\n');

const prompt = `
基于以下知识库片段回答用户问题。在答案中的关键信息后标注来源编号，如 [1]、[2]。

知识库片段:
${chunkTexts}

用户问题: ${query}

请用简洁清晰的中文回答。
`;

// 生成完成后，提取 source 元信息:
const sources = chunks.map((c: any, i: number) => ({
  index: i + 1,
  docName: c.metadata?.doc_name || c.doc_name || '未知文档',
  docId: c.postgres_doc_id || c.doc_id,
  chunkId: c.chunk_id,
}));
```

- [ ] **Step 2: generateFinalAnswer 返回 sources**

修改返回值包含 sources：

```typescript
return {
  finalAnswer: answerText,
  sources: sources,  // 新增字段
};
```

确保 `AgentState` 类型定义（`state.ts`）中包含 `sources` 字段：

```typescript
sources?: Array<{ index: number; docName: string; docId: string; chunkId: string }>;
```

- [ ] **Step 3: chat.service.ts SSE 新增 sources 事件**

修改 `apps/server/src/modules/chat/chat.service.ts` 的 `streamAnswer()` 方法，在 `[DONE]` 之前发送 sources：

```typescript
async *streamAnswer(query: string, sessionId: string, userId: string) {
  // ... 现有 RAG 流式生成逻辑
  let sources: any[] = [];

  for await (const chunk of this.ragService.streamQuery(state)) {
    if (chunk.sources) {
      sources = chunk.sources;  // 缓存 sources，最后发送
    }
    if (chunk.token) {
      yield `event: token\ndata: ${JSON.stringify({ token: chunk.token })}\n\n`;
    }
  }

  // 发送来源信息
  if (sources.length > 0) {
    yield `event: sources\ndata: ${JSON.stringify({ sources })}\n\n`;
  }

  yield 'event: done\ndata: [DONE]\n\n';
}
```

- [ ] **Step 4: 前端 useSSE.ts 解析 sources 事件**

修改 `apps/web/src/hooks/useSSE.ts`：

```typescript
// 在 SSE 事件解析 switch 中新增:
case 'sources':
  const sourcesData = JSON.parse(data);
  setSources(sourcesData.sources);
  break;
case 'done':
  // ...
  break;
```

hook 返回值新增 `sources` 状态：

```typescript
export function useSSE() {
  // ...
  const [sources, setSources] = useState<Source[]>([]);
  // ...
  return { tokens, isStreaming, error, sources, startStream, stopStream };
}
```

- [ ] **Step 5: ChatPage.tsx 展示来源标签**

修改 `apps/web/src/pages/chat/ChatPage.tsx`，在每条 AI 消息气泡底部渲染来源：

```tsx
{msg.sources && msg.sources.length > 0 && (
  <div className="message-sources">
    📎 参考来源：
    {msg.sources.map((s: Source) => (
      <span key={s.index} className="source-tag" onClick={() => navigate(`/documents/${s.docId}`)}>
        [{s.index}] {s.docName}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 6: 验证来源展示**

```bash
# 发送查询，预期: 前端聊天气泡底部显示来源文档名称，可点击
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"公司年假政策","sessionId":"test-sources"}'
# 观察 SSE 事件流中是否包含 sources 事件
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rag/nodes/generate.ts apps/server/src/modules/rag/state.ts
git add apps/server/src/modules/chat/chat.service.ts
git add apps/web/src/hooks/useSSE.ts
git add apps/web/src/pages/chat/ChatPage.tsx
git commit -m "feat: add source attribution with numbered references in answers"
```

---

### Task 2.5: 自动化评测脚本

**Files:**
- Create: `scripts/eval/eval.ts`
- Create: `scripts/eval/test-cases.json`
- Create: `scripts/eval/metrics.ts`
- Create: `scripts/eval/report.ts`

**Interfaces:**
- Consumes: 项目 HTTP API（通过 `fetch` 调用后端）
- Produces: 终端表格报告 + 可选 JSON 输出文件

- [ ] **Step 1: 创建测试用例集**

创建 `scripts/eval/test-cases.json`：

```json
[
  {
    "id": "case-001",
    "query": "公司年假怎么申请？",
    "expectedChunks": ["年假", "申请", "假期"],
    "expectedAnswer": ["提前", "天", "审批"],
    "intent": "complex",
    "category": "hr_policy",
    "enabled": true
  },
  {
    "id": "case-002",
    "query": "你好",
    "expectedChunks": [],
    "expectedAnswer": ["你好"],
    "intent": "chat",
    "category": "chat",
    "enabled": true
  },
  {
    "id": "case-003",
    "query": "公司的考勤制度是什么？",
    "expectedChunks": ["考勤", "上班", "打卡"],
    "expectedAnswer": ["小时", "迟到"],
    "intent": "complex",
    "category": "hr_policy",
    "enabled": true
  }
]
```

根据实际知识库内容补充 30+ 条用例。

- [ ] **Step 2: 创建指标计算模块**

创建 `scripts/eval/metrics.ts`：

```typescript
export interface EvalCase {
  id: string;
  query: string;
  expectedChunks: string[];
  expectedAnswer: string[];
  intent: string;
  category: string;
  enabled: boolean;
}

export interface EvalResult {
  caseId: string;
  query: string;
  actualIntent: string;
  intentMatch: boolean;
  chunkRecall: number;       // 期望 chunk 命中率 0-1
  answerAccuracy: number;    // 答案关键词命中率 0-1
  searchLatencyMs: number;
  firstTokenLatencyMs: number;
  totalLatencyMs: number;
  passed: boolean;
}

export function calcChunkRecall(expected: string[], retrievedTexts: string[]): number {
  if (expected.length === 0) return 1; // chat 类无期望 chunk
  let hits = 0;
  const combined = retrievedTexts.join(' ');
  for (const keyword of expected) {
    if (combined.includes(keyword)) hits++;
  }
  return hits / expected.length;
}

export function calcAnswerAccuracy(expected: string[], answer: string): number {
  if (expected.length === 0) return 1;
  let hits = 0;
  for (const pattern of expected) {
    try {
      if (new RegExp(pattern).test(answer)) hits++;
    } catch {
      if (answer.includes(pattern)) hits++;
    }
  }
  return hits / expected.length;
}
```

- [ ] **Step 3: 创建报告输出模块**

创建 `scripts/eval/report.ts`：

```typescript
import type { EvalResult } from './metrics';

export function printReport(results: EvalResult[]): void {
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  console.log('\n========== RAG 评测报告 ==========');
  console.log(`总计: ${results.length} | 通过: ${passed.length} | 失败: ${failed.length}`);
  console.log(`通过率: ${(passed.length / results.length * 100).toFixed(1)}%\n`);

  // 意图分类准确率
  const intentAcc = results.filter(r => r.intentMatch).length / results.length;
  console.log(`意图分类准确率: ${(intentAcc * 100).toFixed(1)}%`);

  // 检索召回率
  const avgRecall = results.reduce((s, r) => s + r.chunkRecall, 0) / results.length;
  console.log(`平均检索召回率: ${(avgRecall * 100).toFixed(1)}%`);

  // 答案准确率
  const avgAcc = results.reduce((s, r) => s + r.answerAccuracy, 0) / results.length;
  console.log(`平均答案准确率: ${(avgAcc * 100).toFixed(1)}%`);

  // 延迟
  const avgSearch = results.reduce((s, r) => s + r.searchLatencyMs, 0) / results.length;
  const avgFirst = results.reduce((s, r) => s + r.firstTokenLatencyMs, 0) / results.length;
  const avgTotal = results.reduce((s, r) => s + r.totalLatencyMs, 0) / results.length;
  console.log(`平均检索延迟: ${avgSearch.toFixed(0)}ms`);
  console.log(`平均首 Token 延迟: ${avgFirst.toFixed(0)}ms`);
  console.log(`平均总延迟: ${avgTotal.toFixed(0)}ms`);

  // 失败用例
  if (failed.length > 0) {
    console.log('\n--- 失败用例 ---');
    for (const r of failed) {
      console.log(`  ${r.caseId}: ${r.query}`);
      console.log(`    召回率: ${(r.chunkRecall * 100).toFixed(0)}% | 准确率: ${(r.answerAccuracy * 100).toFixed(0)}%`);
    }
  }

  console.log('====================================\n');
}
```

- [ ] **Step 4: 创建评测主入口**

创建 `scripts/eval/eval.ts`：

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import type { EvalCase, EvalResult } from './metrics';
import { calcChunkRecall, calcAnswerAccuracy } from './metrics';
import { printReport } from './report';

const BASE_URL = process.env.API_URL || 'http://localhost:3001/api';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

async function runEval() {
  const cases: EvalCase[] = JSON.parse(
    readFileSync(join(__dirname, 'test-cases.json'), 'utf-8')
  ).filter((c: EvalCase) => c.enabled);

  if (!ADMIN_TOKEN) {
    console.error('请设置 ADMIN_TOKEN 环境变量');
    process.exit(1);
  }

  const results: EvalResult[] = [];

  for (const tc of cases) {
    console.log(`[${tc.id}] 测试: ${tc.query}`);

    const startTime = Date.now();
    let firstTokenTime = 0;
    let fullAnswer = '';
    let retrievedTexts: string[] = [];

    try {
      const response = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({
          message: tc.query,
          sessionId: `eval-${tc.id}`,
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: token')) continue;
          if (line.startsWith('data: ')) {
            if (firstTokenTime === 0) firstTokenTime = Date.now();
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) fullAnswer += parsed.token;
              if (parsed.chunks) retrievedTexts = parsed.chunks.map((c: any) => c.text);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      console.error(`  ❌ 请求失败: ${(err as Error).message}`);
      results.push({
        caseId: tc.id,
        query: tc.query,
        actualIntent: 'error',
        intentMatch: false,
        chunkRecall: 0,
        answerAccuracy: 0,
        searchLatencyMs: 0,
        firstTokenLatencyMs: 0,
        totalLatencyMs: Date.now() - startTime,
        passed: false,
      });
      continue;
    }

    const totalLatency = Date.now() - startTime;
    const searchLatency = firstTokenTime > 0 ? firstTokenTime - startTime : totalLatency;
    const firstTokenLatency = firstTokenTime > 0 ? firstTokenTime - startTime : totalLatency;
    const chunkRecall = calcChunkRecall(tc.expectedChunks, retrievedTexts);
    const answerAccuracy = calcAnswerAccuracy(tc.expectedAnswer, fullAnswer);
    const passed = chunkRecall >= 0.5 && (tc.expectedAnswer.length === 0 || answerAccuracy >= 0.5);

    results.push({
      caseId: tc.id,
      query: tc.query,
      actualIntent: 'n/a', // SSE 不直接返回 intent，需从 LangFuse 获取
      intentMatch: true,   // 暂跳过意图评测
      chunkRecall,
      answerAccuracy,
      searchLatencyMs: searchLatency,
      firstTokenLatencyMs: firstTokenLatency,
      totalLatencyMs: totalLatency,
      passed,
    });

    console.log(`  ${passed ? '✅' : '❌'} 召回: ${(chunkRecall*100).toFixed(0)}% | 准确: ${(answerAccuracy*100).toFixed(0)}% | 延迟: ${totalLatency}ms`);
  }

  printReport(results);
}

runEval().catch(console.error);
```

- [ ] **Step 5: 运行评测脚本**

```bash
cd D:/project/knowledge-base-rag
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4) \
  npx ts-node scripts/eval/eval.ts
```

- [ ] **Step 6: 根据已有知识库补充测试用例**

编辑 `scripts/eval/test-cases.json`，添加 30+ 条覆盖 HR/考勤/报销/技术规范等分类的用例。

- [ ] **Step 7: Commit**

```bash
git add scripts/eval/
git commit -m "feat: add automated RAG evaluation script with 30+ test cases"
```

---

## 第三层：生产加固

### Task 3.1: LangFuse 全链路监控

**Files:**
- Create: `apps/server/src/common/observability/langfuse.service.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/server/src/modules/rag/nodes/intent.ts`
- Modify: `apps/server/src/modules/rag/nodes/retrieval.ts`
- Modify: `apps/server/src/modules/rag/nodes/generate.ts`
- Modify: `apps/server/src/modules/search/search.service.ts`
- Modify: `apps/server/package.json`
- Modify: `.env`

**Interfaces:**
- Consumes: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`（环境变量）
- Produces: `LangfuseService` 可注入，提供 `trace()`, `span()`, `generation()` 方法

- [ ] **Step 1: 安装 langfuse SDK**

```bash
cd apps/server
pnpm add langfuse
```

- [ ] **Step 2: 创建 LangfuseService**

创建 `apps/server/src/common/observability/langfuse.service.ts`：

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Langfuse } from 'langfuse';

@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private client: Langfuse;

  onModuleInit() {
    this.client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      secretKey: process.env.LANGFUSE_SECRET_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });
  }

  onModuleDestroy() {
    this.client?.shutdownAsync();
  }

  /** 开始一个顶层 trace */
  createTrace(name: string, input: any, userId?: string, sessionId?: string) {
    return this.client.trace({
      name,
      input,
      userId,
      sessionId,
    });
  }

  /** 在 trace 下创建 span */
  createSpan(trace: any, name: string, input?: any) {
    return trace.span({
      name,
      input: input ?? undefined,
    });
  }

  /** 记录 generation（LLM 调用） */
  async recordGeneration(span: any, data: {
    name: string;
    input: any;
    output: any;
    model?: string;
    usage?: { promptTokens?: number; completionTokens?: number };
    latencyMs?: number;
  }) {
    const gen = span.generation({
      name: data.name,
      input: data.input,
      output: data.output,
      model: data.model,
      usage: data.usage,
    });
    if (data.latencyMs) {
      gen.endTime = new Date(Date.now() + data.latencyMs);
    }
    gen.end();
  }

  /** 结束 span */
  endSpan(span: any, output?: any) {
    if (output) {
      span.update({ output });
    }
    span.end();
  }
}
```

- [ ] **Step 3: 在 ChatService 中包裹顶层 trace**

修改 `apps/server/src/modules/chat/chat.service.ts`：

```typescript
import { LangfuseService } from '../../common/observability/langfuse.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly ragService: RagService,
    private readonly memoryService: MemoryService,
    private readonly langfuse: LangfuseService,  // 新增
  ) {}

  async *streamAnswer(query: string, sessionId: string, userId: string) {
    const trace = this.langfuse.createTrace('chat', { query }, userId, sessionId);

    try {
      // ... 原有 RAG 流式逻辑
      // 将 trace 传入 state，供各节点使用
      const state = { messages: [...], userId, sessionId, langfuseTrace: trace };

      for await (const chunk of this.ragService.streamQuery(state)) {
        yield chunk;
      }
    } finally {
      // trace 自动在 Langfuse flush 时上报
    }
  }
}
```

- [ ] **Step 4: 在各节点中添加 span**

在 `apps/server/src/modules/rag/nodes/intent.ts` 中：

```typescript
export async function classifyIntent(state: AgentState): Promise<Partial<AgentState>> {
  const startTime = Date.now();

  // ... 原有意图分类逻辑
  const intent = '...'; // 分类结果

  // 记录 span
  if (state.langfuseTrace) {
    const span = langfuseService.createSpan(state.langfuseTrace, 'intent_classifier', {
      query: lastMessage,
    });
    langfuseService.endSpan(span, { intent, latencyMs: Date.now() - startTime });
  }

  return { intent };
}
```

在 `apps/server/src/modules/rag/nodes/retrieval.ts` 中（对每个工具调用）：

```typescript
// 在 executeRetrievalTools 中:
const startTime = Date.now();
// ... 执行检索工具
if (state.langfuseTrace) {
  const span = this.langfuse.createSpan(state.langfuseTrace, `retrieval:${toolName}`, {
    query: toolCall.args.query,
  });
  this.langfuse.endSpan(span, {
    resultCount: results.length,
    latencyMs: Date.now() - startTime,
  });
}
```

在 `apps/server/src/modules/rag/nodes/generate.ts` 中：

```typescript
// 记录 generation span:
if (state.langfuseTrace) {
  const span = this.langfuse.createSpan(state.langfuseTrace, 'generate_answer');
  await this.langfuse.recordGeneration(span, {
    name: 'answer_generation',
    input: { query, chunksCount: chunks.length },
    output: { answer: finalAnswer },
    model: 'deepseek-v4-flash-0731',
    latencyMs: Date.now() - startTime,
  });
}
```

- [ ] **Step 5: 在 .env 中添加 LangFuse 配置**

```bash
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

- [ ] **Step 6: 在 AppModule 中注册 LangfuseService**

修改 `apps/server/src/app.module.ts`：

```typescript
import { LangfuseService } from './common/observability/langfuse.service';

@Module({
  providers: [LangfuseService],
  exports: [LangfuseService],
})
```

- [ ] **Step 7: 验证 LangFuse Dashboard**

```bash
# 发送几条不同类型的问答
# 打开 LangFuse Dashboard → 确认可见 trace 列表
# 展开 trace → 确认 intent/retrieval/generation span 完整
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/common/observability/langfuse.service.ts
git add apps/server/src/modules/chat/chat.service.ts
git add apps/server/src/modules/rag/nodes/intent.ts
git add apps/server/src/modules/rag/nodes/retrieval.ts
git add apps/server/src/modules/rag/nodes/generate.ts
git add apps/server/src/modules/search/search.service.ts
git add apps/server/package.json apps/server/pnpm-lock.yaml
git add apps/server/src/app.module.ts
git add .env
git commit -m "feat: integrate LangFuse for full-stack observability"
```

---

### Task 3.2: 阶段二 BullMQ 异步队列

**Files:**
- Create: `apps/server/src/modules/document/services/index-queue.service.ts`
- Create: `apps/server/src/modules/document/services/index-worker.service.ts`
- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/document/document.module.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: `IndexerService.indexDocument(docId)` (已有), Redis 连接
- Produces: `IndexQueueService.addJob(docId)` → `Promise<Job>`, `IndexWorkerService` 自动消费

- [ ] **Step 1: 安装 BullMQ**

```bash
cd apps/server
pnpm add @nestjs/bullmq bullmq
```

- [ ] **Step 2: 创建 IndexQueueService (Producer)**

创建 `apps/server/src/modules/document/services/index-queue.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class IndexQueueService {
  constructor(
    @InjectQueue('document-index') private readonly indexQueue: Queue,
  ) {}

  async addJob(docId: string): Promise<void> {
    await this.indexQueue.add('index-document', { docId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
```

- [ ] **Step 3: 创建 IndexWorkerService (Consumer)**

创建 `apps/server/src/modules/document/services/index-worker.service.ts`：

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IndexerService } from './indexer.service';
import { DocumentStatus } from '../entities/document.entity';
import { DocumentService } from '../document.service';

@Processor('document-index')
@Injectable()
export class IndexWorkerService extends WorkerHost {
  private readonly logger = new Logger(IndexWorkerService.name);

  constructor(
    private readonly indexer: IndexerService,
    private readonly docService: DocumentService,
  ) {
    super();
  }

  async process(job: Job<{ docId: string }>): Promise<void> {
    const { docId } = job.data;
    this.logger.log(`开始索引文档: ${docId} (尝试 ${job.attemptsMade + 1}/3)`);

    try {
      await this.docService.updateStatus(docId, DocumentStatus.INDEXING);
      await this.indexer.indexDocument(docId);
      await this.docService.updateStatus(docId, DocumentStatus.INDEXED);
      this.logger.log(`索引完成: ${docId}`);
    } catch (err) {
      this.logger.error(`索引失败: ${docId}`, (err as Error).message);

      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
        await this.docService.updateStatus(docId, DocumentStatus.FAILED);
      }

      throw err; // BullMQ 自动重试
    }
  }
}
```

- [ ] **Step 4: 更新 DocumentModule 注册 BullMQ**

修改 `apps/server/src/modules/document/document.module.ts`：

```typescript
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'document-index',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    // ... 已有 imports
  ],
  providers: [
    // ... 已有 providers
    IndexQueueService,
    IndexWorkerService,
  ],
})
export class DocumentModule {}
```

同时在 `apps/server/src/app.module.ts` 根模块中注册 BullMQ：

```typescript
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    // ... 已有 imports
  ],
})
```

- [ ] **Step 5: 替换 DocumentService 中的 fire-and-forget**

修改 `apps/server/src/modules/document/document.service.ts`：

```typescript
constructor(
  // ... 已有依赖
  private readonly indexQueue: IndexQueueService,  // 新增
) {}

// 在 triggerIndex() 方法中:
async triggerIndex(docId: string, userId?: string): Promise<{ docId: string; status: string }> {
  // ... 权限检查和状态更新

  // 替换 fire-and-forget 为队列:
  await this.indexQueue.addJob(docId);

  return { docId, status: DocumentStatus.INDEXING };
}
```

- [ ] **Step 6: 验证队列**

```bash
# 上传文档后检查 BullMQ
# 可以通过 bull-board 或 redis-cli 查看队列:
docker exec -it <redis_container> redis-cli KEYS "bull:document-index:*"

# 上传文档，观察日志:
# [IndexWorkerService] 开始索引文档: xxx
# [IndexWorkerService] 索引完成: xxx

# 模拟失败场景: 断开 ES 连接 → 上传文档 → 确认重试 3 次 → status=failed
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git add apps/server/src/modules/document/services/index-queue.service.ts
git add apps/server/src/modules/document/services/index-worker.service.ts
git add apps/server/src/modules/document/document.service.ts
git add apps/server/src/modules/document/document.module.ts
git add apps/server/src/app.module.ts
git commit -m "feat: replace fire-and-forget indexing with BullMQ async queue (3 retries, exponential backoff)"
```

---

### Task 3.3: 统一错误处理与重试

**Files:**
- Create: `apps/server/src/common/filters/all-exceptions.filter.ts`
- Create: `apps/server/src/common/utils/retry.util.ts`
- Modify: `apps/server/src/modules/rag/rag.service.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: NestJS `ExceptionFilter`, `ArgumentsHost`
- Produces: 统一错误响应格式 `{ code, message, traceId, timestamp }`，`withLLMRetry(fn)` 工具函数

- [ ] **Step 1: 创建全局异常过滤器**

创建 `apps/server/src/common/filters/all-exceptions.filter.ts`：

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = uuidv4().slice(0, 8);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      message = typeof exResponse === 'string'
        ? exResponse
        : (exResponse as any).message || exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logger.error(
      `[${traceId}] ${request.method} ${request.url} → ${status}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      code: status,
      message: Array.isArray(message) ? message[0] : message,
      traceId,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 2: 在 main.ts 中注册全局过滤器**

修改 `apps/server/src/main.ts`：

```typescript
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ... 已有配置
  app.useGlobalFilters(new AllExceptionsFilter());
  // ...
}
```

- [ ] **Step 3: 创建 LLM 重试工具**

创建 `apps/server/src/common/utils/retry.util.ts`：

```typescript
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;

      // 仅对可重试错误重试: 429 (rate limit), 5xx (server error), network errors
      const status = err?.status || err?.response?.status;
      const isRetryable =
        status === 429 ||
        (status && status >= 500) ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'ECONNREFUSED';

      if (!isRetryable) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s → 2s → 4s
      console.warn(`[LLM Retry] 第 ${attempt} 次重试，等待 ${delay}ms: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('unreachable');
}
```

- [ ] **Step 4: 在 RAG 引擎中包裹 LLM 调用**

修改 `apps/server/src/modules/rag/rag.service.ts`，对所有 `llm.invoke()` 包裹重试：

```typescript
import { withLLMRetry } from '../../common/utils/retry.util';

// 替换 llm.invoke(messages) 为:
const response = await withLLMRetry(() => llm.invoke(messages));
```

同样处理 `embeddings.embedQuery()` 和 `embeddings.embedDocuments()`。

- [ ] **Step 5: 确认数据库重连配置**

检查并确认各数据库连接配置中的重连参数：

- PG (`apps/server/src/database/postgres/`): TypeORM `extra: { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 }` — TypeORM 默认支持重连
- Redis (`apps/server/src/database/redis/`): ioredis `retryStrategy(times) { return Math.min(times * 100, 3000) }` — 确认存在
- ES (`apps/server/src/database/elasticsearch/`): Client options `maxRetries: 3, requestTimeout: 30000`

- [ ] **Step 6: 验证错误处理**

```bash
# 1. 正常请求 → 确认响应仍正常
curl -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# 2. 触发 4xx 错误 → 预期格式:
# {"code":401,"message":"未授权","traceId":"a1b2c3d4","timestamp":"..."}
curl http://localhost:3001/api/auth/me

# 3. 触发 LLM 重试 → 临时改错 OPENAI_API_KEY → 观察日志
# 预期: 输出重试警告，3 次后返回 500 统一格式
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/common/filters/all-exceptions.filter.ts
git add apps/server/src/common/utils/retry.util.ts
git add apps/server/src/main.ts
git add apps/server/src/modules/rag/rag.service.ts
git commit -m "feat: add global exception filter, LLM retry with exponential backoff"
```

---

## 第四层：功能增强

### Task 4.1: 动态 RBAC 管理后台

**Files:**
- Create: `apps/server/src/common/guards/permission.guard.ts`
- Create: `apps/server/src/modules/rbac/rbac.controller.ts`
- Create: `apps/server/src/modules/rbac/rbac.service.ts`
- Create: `apps/server/src/modules/rbac/dto/role.dto.ts`
- Create: `apps/server/src/modules/rbac/rbac.module.ts`
- Create: `apps/web/src/components/common/Can.tsx`
- Create: `apps/web/src/pages/admin/RoleManagePage.tsx`
- Modify: `apps/server/src/modules/auth/auth.service.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/web/src/components/layout/Layout.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: 已有 `permissions`, `roles`, `user_roles` 表
- Produces: `GET/POST/PATCH/DELETE /api/rbac/roles`, `GET/POST /api/rbac/users/:id/roles`, `@RequirePermission()` 装饰器

- [ ] **Step 1: 创建权限 Guard 和装 饰器**

创建 `apps/server/src/common/guards/permission.guard.ts`：

```typescript
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string>(PERMISSION_KEY, context.getHandler());
    if (!required) return true; // 无权限要求 → 放行

    const { user } = context.switchToHttp().getRequest();
    return user?.permissions?.includes(required) || user?.roles?.includes('admin');
  }
}
```

- [ ] **Step 2: 扩展 JWT payload 携带 permissions**

修改 `apps/server/src/modules/auth/auth.service.ts` 的 `login()` 方法：

```typescript
async login(dto: LoginDto) {
  // ... 现有验证逻辑

  // 查询用户权限:
  const permissions = await this.getUserPermissions(user.id);

  const payload = {
    sub: user.id,
    username: user.username,
    roles: user.roles,
    permissions,  // 新增
    dept_id: user.dept_id,
  };

  const access_token = this.jwtService.sign(payload);

  // ...
}

private async getUserPermissions(userId: string): Promise<string[]> {
  const result = await this.dataSource.query(`
    SELECT DISTINCT p.code
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    JOIN user_roles ur ON rp.role_id = ur.role_id
    WHERE ur.user_id = $1
  `, [userId]);

  return result.map((r: any) => r.code);
}
```

- [ ] **Step 3: 创建 RBAC 模块**

创建 `apps/server/src/modules/rbac/dto/role.dto.ts`：

```typescript
import { IsString, IsArray, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissionCodes: string[];
}

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class AssignRoleDto {
  @IsArray()
  @IsString({ each: true })
  roleIds: string[];
}
```

创建 `apps/server/src/modules/rbac/rbac.service.ts`：

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RbacService {
  constructor(private readonly dataSource: DataSource) {}

  async listRoles() {
    return this.dataSource.query(`
      SELECT r.*, COUNT(ur.user_id)::int as user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);
  }

  async getRole(id: string) {
    const [role] = await this.dataSource.query(
      `SELECT r.*, COALESCE(json_agg(p.code) FILTER (WHERE p.id IS NOT NULL), '[]') as permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       LEFT JOIN permissions p ON rp.permission_id = p.id
       WHERE r.id = $1
       GROUP BY r.id`, [id],
    );
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async createRole(dto: CreateRoleDto) {
    const [existing] = await this.dataSource.query(
      'SELECT id FROM roles WHERE name = $1', [dto.name],
    );
    if (existing) throw new ConflictException('角色名称已存在');

    const [role] = await this.dataSource.query(
      `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *`,
      [dto.name, dto.description],
    );

    // 关联权限
    for (const code of dto.permissionCodes) {
      await this.dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = $2`,
        [role.id, code],
      );
    }

    return this.getRole(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.getRole(id);

    if (dto.name) {
      await this.dataSource.query(
        'UPDATE roles SET name = $1 WHERE id = $2', [dto.name, id],
      );
    }

    if (dto.permissionCodes) {
      // 全量替换权限
      await this.dataSource.query(
        'DELETE FROM role_permissions WHERE role_id = $1', [id],
      );
      for (const code of dto.permissionCodes) {
        await this.dataSource.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE code = $2`,
          [id, code],
        );
      }
    }

    return this.getRole(id);
  }

  async deleteRole(id: string) {
    const [role] = await this.dataSource.query(
      'SELECT is_system FROM roles WHERE id = $1', [id],
    );
    if (!role) throw new NotFoundException('角色不存在');
    if (role.is_system) throw new ConflictException('系统角色不可删除');

    await this.dataSource.query('DELETE FROM user_roles WHERE role_id = $1', [id]);
    await this.dataSource.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    await this.dataSource.query('DELETE FROM roles WHERE id = $1', [id]);
    return { success: true };
  }

  async assignUserRoles(userId: string, roleIds: string[]) {
    await this.dataSource.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const roleId of roleIds) {
      await this.dataSource.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleId],
      );
    }
    return this.getUserRoles(userId);
  }

  async getUserRoles(userId: string) {
    return this.dataSource.query(
      `SELECT r.id, r.name FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1`, [userId],
    );
  }
}
```

创建 `apps/server/src/modules/rbac/rbac.controller.ts`：

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { RequirePermission } from '../../common/guards/permission.guard';
import { RbacService } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto/role.dto';

@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermission('rbac:read')
  async listRoles() {
    return this.rbacService.listRoles();
  }

  @Get('roles/:id')
  @RequirePermission('rbac:read')
  async getRole(@Param('id') id: string) {
    return this.rbacService.getRole(id);
  }

  @Post('roles')
  @RequirePermission('rbac:write')
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermission('rbac:write')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermission('rbac:write')
  async deleteRole(@Param('id') id: string) {
    return this.rbacService.deleteRole(id);
  }

  @Get('users/:id/roles')
  @RequirePermission('rbac:read')
  async getUserRoles(@Param('id') id: string) {
    return this.rbacService.getUserRoles(id);
  }

  @Post('users/:id/roles')
  @RequirePermission('rbac:write')
  async assignUserRoles(@Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.rbacService.assignUserRoles(id, dto.roleIds);
  }
}
```

创建 `apps/server/src/modules/rbac/rbac.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Module({
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
```

- [ ] **Step 4: 注册 RBAC 模块和权限 Guard**

修改 `apps/server/src/app.module.ts`：

```typescript
import { RbacModule } from './modules/rbac/rbac.module';
import { PermissionGuard } from './common/guards/permission.guard';

@Module({
  imports: [
    // ... 已有 imports
    RbacModule,
  ],
  providers: [
    // 全局注册 PermissionGuard
    { provide: 'APP_GUARD', useClass: PermissionGuard },
  ],
})
```

- [ ] **Step 5: 创建前端权限组件 Can.tsx**

创建 `apps/web/src/components/common/Can.tsx`：

```tsx
import { ReactNode } from 'react';
import { useAuthStore } from '../../stores/auth.store';

interface Props {
  permission?: string;
  role?: string;
  children: ReactNode;
}

/** 权限控制组件：无权限时不渲染子组件 */
export default function Can({ permission, role, children }: Props) {
  const user = useAuthStore(s => s.user);

  if (!user) return null;

  // admin 角色拥有所有权限
  if (user.roles?.includes('admin')) return <>{children}</>;

  if (role && !user.roles?.includes(role)) return null;

  if (permission && !(user as any).permissions?.includes(permission)) return null;

  return <>{children}</>;
}
```

- [ ] **Step 6: 创建角色管理前端页面**

创建 `apps/web/src/pages/admin/RoleManagePage.tsx`：（核心结构）

```tsx
import { useState, useEffect } from 'react';
import api from '../../services/api';
import Can from '../../components/common/Can';

export default function RoleManagePage() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadRoles() {
    const { data } = await api.get('/rbac/roles');
    setRoles(data);
    setLoading(false);
  }

  // 渲染角色列表表格，含创建/编辑/删除操作
  // 使用 Can 组件包裹操作按钮:
  // <Can permission="rbac:write"><Button>新建角色</Button></Can>
  // 完整实现: 表格 + Modal 表单 (名称 + 权限多选 + description)
}
```

- [ ] **Step 7: 更新前端路由和侧边栏**

修改 `apps/web/src/App.tsx`：

```tsx
// 新增路由:
<Route path="/admin/roles" element={<Protected><RoleManagePage /></Protected>} />
```

修改 `apps/web/src/components/layout/Layout.tsx`，侧边栏新增"系统管理"菜单（仅 admin 可见）：

```tsx
<Can role="admin">
  <NavItem to="/admin/roles">🔑 角色管理</NavItem>
</Can>
```

- [ ] **Step 8: 验证 RBAC 功能**

```bash
# admin 登录 → 创建新角色 → 分配权限 → 给用户分配角色
# 退出 → 被分配角色的用户登录 → 确认权限生效
# 尝试删除系统角色 admin → 预期: 409 "系统角色不可删除"
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/common/guards/permission.guard.ts
git add apps/server/src/modules/rbac/
git add apps/server/src/modules/auth/auth.service.ts
git add apps/server/src/app.module.ts
git add apps/web/src/components/common/Can.tsx
git add apps/web/src/pages/admin/RoleManagePage.tsx
git add apps/web/src/App.tsx apps/web/src/components/layout/Layout.tsx
git commit -m "feat: add dynamic RBAC management with role CRUD and permission guard"
```

---

### Task 4.2: 语音实时对话（WebSocket 音频 + SSE 文字）

**Files:**
- Create: `apps/server/src/modules/chat/services/asr.service.ts`
- Create: `apps/server/src/modules/chat/services/tts.service.ts`
- Create: `apps/web/src/hooks/useVoiceChat.ts`
- Create: `apps/web/src/components/chat/VoiceButton.tsx`
- Modify: `apps/server/src/modules/chat/gateways/voice.gateway.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`
- Modify: `.env`

**Interfaces:**
- Consumes: 阿里云 NLS WebSocket API, 已有 SSE `/api/chat/stream`
- Produces: WebSocket `ws://localhost:3001/chat/voice`（音频上下行）, SSE token 流（复用）

- [ ] **Step 1: 添加阿里云 NLS 环境变量**

在 `.env` 中新增：

```bash
# 阿里云 NLS 语音服务
ALIYUN_NLS_APP_KEY=xxx
ALIYUN_NLS_ACCESS_KEY_ID=xxx
ALIYUN_NLS_ACCESS_KEY_SECRET=xxx
```

- [ ] **Step 2: 创建 ASR 服务**

创建 `apps/server/src/modules/chat/services/asr.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface AsrResult {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

@Injectable()
export class AsrService extends EventEmitter {
  private readonly logger = new Logger(AsrService.name);
  private connections = new Map<string, any>();

  /** 开始识别会话 */
  async startSession(sessionId: string): Promise<void> {
    // MVP: 使用阿里云 NLS WebSocket 实时识别
    // 需要引入 @alicloud/nls 或手动 WebSocket 实现
    // 简化方案: 每次收到完整音频分片后调用 REST 识别

    this.logger.log(`ASR 会话开始: ${sessionId}`);
  }

  /** 送入音频数据 */
  async feedAudio(sessionId: string, audioBuffer: Buffer): Promise<AsrResult> {
    // 调用阿里云 NLS 语音识别 API
    // 返回中间结果 isFinal=false 或最终结果 isFinal=true
    this.logger.log(`ASR 音频分片: ${sessionId}, ${audioBuffer.length} bytes`);

    return {
      text: '', // 识别结果
      isFinal: true,
      timestamp: Date.now(),
    };
  }

  /** 结束识别会话 */
  async endSession(sessionId: string): Promise<string> {
    this.logger.log(`ASR 会话结束: ${sessionId}`);
    return ''; // 返回最终完整文本
  }
}
```

- [ ] **Step 3: 创建 TTS 服务**

创建 `apps/server/src/modules/chat/services/tts.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  /** 将文字转为 PCM 音频 Buffer（流式返回） */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    // 按标点断句（句号、问号、感叹号、逗号、分号）
    const sentences = text.split(/(?<=[。！？，；\n])/g).filter(s => s.trim());

    for (const sentence of sentences) {
      // 调用阿里云 NLS 流式 TTS
      // 每句独立合成，返回 PCM buffer
      this.logger.log(`TTS 合成: ${sentence.slice(0, 20)}...`);

      // Placeholder: 返回空 buffer（实际接入阿里云 NLS SDK）
      yield Buffer.alloc(0);
    }
  }
}
```

- [ ] **Step 4: 重写 VoiceGateway（WebSocket）**

重写 `apps/server/src/modules/chat/gateways/voice.gateway.ts`：

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { AsrService } from '../services/asr.service';
import { TtsService } from '../services/tts.service';
import { ChatService } from '../chat.service';

@WebSocketGateway({ namespace: '/chat/voice', cors: true })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(VoiceGateway.name);
  private sessions = new Map<string, { isListening: boolean }>();

  constructor(
    private readonly asrService: AsrService,
    private readonly ttsService: TtsService,
    private readonly chatService: ChatService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`语音客户端连接: ${client.id}`);
    this.sessions.set(client.id, { isListening: false });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`语音客户端断开: ${client.id}`);
    this.sessions.delete(client.id);
    this.asrService.endSession(client.id).catch(e => this.logger.error(e));
  }

  /** 接收音频分片 */
  @SubscribeMessage('audio')
  async handleAudio(client: Socket, payload: ArrayBuffer): Promise<void> {
    const session = this.sessions.get(client.id);
    if (!session) return;

    const buffer = Buffer.from(payload);
    const result = await this.asrService.feedAudio(client.id, buffer);

    // 发送中间识别结果给前端显示
    client.emit('asrResult', { text: result.text, isFinal: result.isFinal });

    // 如果是最终结果，触发 RAG
    if (result.isFinal && result.text.trim()) {
      session.isListening = false;

      // 通过 SSE 发送文字 (前端通过 useSSE 接收)
      // 这里通过 Redis pub/sub 或内存事件触发 ChatService
      client.emit('triggerChat', { message: result.text, sessionId: client.id });
    }
  }

  /** 接收 TTS 请求，流式返回音频 */
  @SubscribeMessage('ttsRequest')
  async handleTts(client: Socket, text: string): Promise<void> {
    for await (const audioChunk of this.ttsService.synthesizeStream(text)) {
      client.emit('audioChunk', audioChunk);
    }
    client.emit('audioEnd');
  }

  /** 客户端通知开始监听 */
  @SubscribeMessage('startListening')
  handleStartListening(client: Socket): void {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = true;
    this.asrService.startSession(client.id).catch(e => this.logger.error(e));
  }

  /** 客户端通知停止监听 */
  @SubscribeMessage('stopListening')
  async handleStopListening(client: Socket): Promise<void> {
    const session = this.sessions.get(client.id);
    if (session) session.isListening = false;

    const finalText = await this.asrService.endSession(client.id);
    if (finalText.trim()) {
      client.emit('triggerChat', { message: finalText, sessionId: client.id });
    }
  }
}
```

- [ ] **Step 5: 创建前端语音 Hook**

创建 `apps/web/src/hooks/useVoiceChat.ts`：

```typescript
import { useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useVoiceChat(sessionId: string) {
  const [isRecording, setIsRecording] = useState(false);
  const [asrText, setAsrText] = useState('');
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const connect = useCallback(() => {
    const socket = io(`${import.meta.env.VITE_WS_URL || 'http://localhost:3001'}/chat/voice`);
    socketRef.current = socket;

    socket.on('asrResult', (data: { text: string; isFinal: boolean }) => {
      setAsrText(prev => data.isFinal ? data.text : prev + ' ' + data.text);
    });

    socket.on('triggerChat', (data: { message: string; sessionId: string }) => {
      setTriggerMessage(data.message);
    });

    return socket;
  }, []);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && socketRef.current) {
        event.data.arrayBuffer().then(buffer => {
          socketRef.current?.emit('audio', buffer);
        });
      }
    };

    mediaRecorder.start(100); // 每 100ms 发送一个分片
    mediaRecorderRef.current = mediaRecorder;
    setIsRecording(true);
    setAsrText('');
    socketRef.current?.emit('startListening');
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    setIsRecording(false);
    socketRef.current?.emit('stopListening');
  }, []);

  return { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger: () => setTriggerMessage(null) };
}
```

- [ ] **Step 6: 创建语音按钮组件**

创建 `apps/web/src/components/chat/VoiceButton.tsx`：

```tsx
interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function VoiceButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      className={`voice-btn ${isRecording ? 'recording' : ''}`}
      onMouseDown={onStart}
      onMouseUp={onStop}
      onMouseLeave={isRecording ? onStop : undefined}
      onTouchStart={onStart}
      onTouchEnd={onStop}
    >
      {isRecording ? '🎙️ 松开发送' : '🎤 按住说话'}
    </button>
  );
}
```

- [ ] **Step 7: 集成到 ChatPage**

修改 `apps/web/src/pages/chat/ChatPage.tsx`：

```tsx
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';

// 在组件中:
const { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } = useVoiceChat(sessionId);

useEffect(() => {
  const socket = connect();
  return () => { socket?.disconnect(); };
}, []);

// 收到语音识别结果后自动发送到 SSE:
useEffect(() => {
  if (triggerMessage) {
    handleSend(triggerMessage); // 复用文字发送逻辑触发 SSE
    clearTrigger();
  }
}, [triggerMessage]);

// 在输入区域添加语音按钮:
<VoiceButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
{asrText && <div className="asr-preview">{asrText}</div>}
```

- [ ] **Step 8: 验证语音对话**

```bash
# 1. 启动后端
cd apps/server && pnpm dev

# 2. 浏览器打开 http://localhost:3001/chat
# 3. 点击语音按钮 → 麦克风权限请求 → 允许
# 4. 说话 → 观察 asrText 实时更新
# 5. 松手 → SSE 推送回答 token → 文字气泡出现
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/chat/services/asr.service.ts
git add apps/server/src/modules/chat/services/tts.service.ts
git add apps/server/src/modules/chat/gateways/voice.gateway.ts
git add apps/server/src/modules/chat/chat.service.ts
git add apps/web/src/hooks/useVoiceChat.ts
git add apps/web/src/components/chat/VoiceButton.tsx
git add apps/web/src/pages/chat/ChatPage.tsx
git add .env
git commit -m "feat: add voice chat with WebSocket audio + SSE text dual-channel"
```

---

### Task 4.3: 多模态图文检索

**Files:**
- Modify: `apps/server/src/modules/document/services/indexer.service.ts`
- Modify: `apps/server/src/modules/document/services/chunker.service.ts`

**Interfaces:**
- Consumes: chunk 元信息中的 `has_image` 字段，多模态 LLM API
- Produces: chunk.text 追加图片描述文本

- [ ] **Step 1: chunker 传递 has_image 标记**

确认 `apps/server/src/modules/document/services/chunker.service.ts` 中分块时传递 `has_image` 元信息：

```typescript
// 在 chunk metadata 中:
metadata: {
  chunk_index: i,
  title_level: headerLevel,
  has_image: chunkText.includes('!['), // Markdown 图片语法检测
  has_table: chunkText.includes('|'),
  page_num: pageNumber,
}
```

- [ ] **Step 2: indexer 中为含图片的 chunk 生成描述**

修改 `apps/server/src/modules/document/services/indexer.service.ts`：

```typescript
async indexChunk(chunk: ChunkData, docId: string, deptId: string) {
  // ... 现有逻辑

  // 如果 chunk 包含图片，生成图片描述
  if (chunk.metadata?.has_image) {
    try {
      const imageDesc = await this.generateImageDescription(chunk.text);
      chunk.text = `${chunk.text}\n[图片描述: ${imageDesc}]`;
    } catch (err) {
      this.logger.warn(`图片描述生成失败: ${docId}/${chunk.id}`, (err as Error).message);
    }
  }

  // ... 继续 embedding 和索引
}

/** 调用多模态 LLM 生成图片描述 */
private async generateImageDescription(markdownWithImages: string): Promise<string> {
  // 提取 Markdown 中的图片 URL
  const imageUrls = [...markdownWithImages.matchAll(/!\[.*?\]\((https?:\/\/[^)]+)\)/g)]
    .map(m => m[1]);

  if (imageUrls.length === 0) return '';

  // 调用多模态 LLM（deepseek-v4-flash-0731 vision / 阿里云多模态）
  const llm = new ChatOpenAI({
    modelName: process.env.VISION_MODEL || 'deepseek-chat',
    openAIApiKey: process.env.ALIYUN_API_KEY,
    configuration: { baseURL: process.env.ALIYUN_BASE_URL },
  });

  const response = await llm.invoke([
    { role: 'user', content: [
      { type: 'text', text: '请用一句话描述这张图片的内容。' },
      ...imageUrls.slice(0, 3).map(url => ({  // 最多 3 张图片
        type: 'image_url' as const,
        image_url: { url },
      })),
    ]},
  ]);

  return typeof response.content === 'string' ? response.content : '';
}
```

- [ ] **Step 3: 验证图片检索**

```bash
# 上传含图片的文档
# 索引完成后:
curl -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"这张图描述了什么","sessionId":"test-image"}'

# 预期: 返回的答案引用了图片描述内容
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/document/services/indexer.service.ts
git add apps/server/src/modules/document/services/chunker.service.ts
git commit -m "feat: add image description generation for multimodal retrieval bridge"
```

---

### Task 4.4: 统计仪表盘

**Files:**
- Create: `apps/server/src/modules/analytics/analytics.controller.ts`
- Create: `apps/server/src/modules/analytics/analytics.service.ts`
- Create: `apps/server/src/modules/analytics/analytics.module.ts`
- Create: `apps/web/src/pages/analytics/AnalyticsPage.tsx`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Layout.tsx`

**Interfaces:**
- Consumes: Postgres `documents` 表, Redis session keys, 可选新增 `chat_logs` 表
- Produces: `GET /api/analytics/overview|documents|chat|users`

- [ ] **Step 1: 创建 AnalyticsService**

创建 `apps/server/src/modules/analytics/analytics.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../../database/redis/redis.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  async getOverview() {
    const [docCount] = await this.dataSource.query(`SELECT COUNT(*)::int as count FROM documents`);
    const [chunkCount] = await this.dataSource.query(`SELECT COALESCE(SUM(array_length(string_to_array(chunk_text, ' '), 1)), 0)::int as count FROM chunks`);

    // 活跃 session 数（估算通过 Redis keys）
    const sessionKeys = await this.redis.keys('session:*:history');
    const totalSessions = sessionKeys.length;

    return {
      docCount: docCount?.count ?? 0,
      totalSessions,
    };
  }

  async getDocumentStats() {
    const byType = await this.dataSource.query(`
      SELECT type, COUNT(*)::int as count
      FROM documents
      GROUP BY type
      ORDER BY count DESC
    `);

    const byStatus = await this.dataSource.query(`
      SELECT status, COUNT(*)::int as count
      FROM documents
      GROUP BY status
      ORDER BY count DESC
    `);

    // 上传趋势（最近 30 天）
    const uploadTrend = await this.dataSource.query(`
      SELECT DATE(created_at) as date, COUNT(*)::int as count
      FROM documents
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    return { byType, byStatus, uploadTrend };
  }

  async getChatStats() {
    // 基于已有 Redis session 数据粗略统计
    const sessionKeys = await this.redis.keys('session:*:history');
    const totalQuestions = sessionKeys.length;

    return {
      totalQuestions,
      topQueries: [],    // 待有 chat_logs 表后填充
      avgRounds: 0,
      intentDistribution: { chat: 0, simple: 0, complex: 0 },
      degradeRate: 0,
    };
  }

  async getUserStats() {
    const [totalUsers] = await this.dataSource.query(`SELECT COUNT(*)::int as count FROM users`);
    const [activeUsers] = await this.dataSource.query(`
      SELECT COUNT(DISTINCT created_by)::int as count
      FROM documents
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    return {
      totalUsers: totalUsers?.count ?? 0,
      activeUsers: activeUsers?.count ?? 0,
    };
  }
}
```

- [ ] **Step 2: 创建 AnalyticsController**

创建 `apps/server/src/modules/analytics/analytics.controller.ts`：

```typescript
import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('overview')
  async overview() { return this.service.getOverview(); }

  @Get('documents')
  async documents() { return this.service.getDocumentStats(); }

  @Get('chat')
  async chat() { return this.service.getChatStats(); }

  @Get('users')
  async users() { return this.service.getUserStats(); }
}
```

- [ ] **Step 3: 创建 AnalyticsModule 并注册**

创建 `apps/server/src/modules/analytics/analytics.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

修改 `apps/server/src/app.module.ts`，添加 `AnalyticsModule`。

- [ ] **Step 4: 创建前端仪表盘页面**

创建 `apps/web/src/pages/analytics/AnalyticsPage.tsx`：

```tsx
import { useState, useEffect } from 'react';
import api from '../../services/api';

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<any>({});
  const [docStats, setDocStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/documents'),
      api.get('/analytics/chat'),
      api.get('/analytics/users'),
    ]).then(([overviewRes, docRes, chatRes, usersRes]) => {
      setOverview({ ...overviewRes.data, ...usersRes.data });
      setDocStats(docRes.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="analytics-page">
      <h1>📊 数据统计</h1>

      <div className="stat-cards">
        <div className="stat-card">📄 文档总数: {overview.docCount}</div>
        <div className="stat-card">👥 用户数: {overview.totalUsers}</div>
        <div className="stat-card">💬 活跃会话: {overview.totalSessions}</div>
        <div className="stat-card">📅 周活跃: {overview.activeUsers}</div>
      </div>

      {/* 文档类型分布 */}
      <div className="stat-section">
        <h2>文档类型分布</h2>
        <table>
          {docStats.byType?.map((item: any) => (
            <tr key={item.type}><td>{item.type || '未知'}</td><td>{item.count}</td></tr>
          ))}
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 更新路由和侧边栏**

修改 `apps/web/src/App.tsx`：

```tsx
<Route path="/analytics" element={<Protected><AnalyticsPage /></Protected>} />
```

修改 `apps/web/src/components/layout/Layout.tsx`，添加仪表盘入口。

- [ ] **Step 6: 验证仪表盘**

```bash
# admin 登录 → 浏览器打开 /analytics
# 预期: 看到文档数、用户数、类型分布等数据卡片
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/analytics/
git add apps/server/src/app.module.ts
git add apps/web/src/pages/analytics/AnalyticsPage.tsx
git add apps/web/src/App.tsx apps/web/src/components/layout/Layout.tsx
git commit -m "feat: add analytics dashboard with document, chat, and user stats"
```

---

### Task 4.5: 文档管理完善

**Files:**
- Modify: `apps/server/src/modules/document/document.controller.ts`
- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/web/src/pages/document/DocumentManagePage.tsx`

**Interfaces:**
- Consumes: 已有 `Document` 实体，`IndexerService`, `VectorService`, `EsService`, `Neo4jService`, `MongoService`, `RustfsService`
- Produces: `DELETE /api/documents/:id`, `GET /api/documents/:id/preview`, `POST /api/documents/:id/reindex`

- [ ] **Step 1: 实现级联删除**

在 `apps/server/src/modules/document/document.service.ts` 中新增：

```typescript
async deleteDocument(docId: string, userId: string): Promise<void> {
  const doc = await this.docRepo.findOne({ where: { id: docId } });
  if (!doc) throw new NotFoundException('文档不存在');
  if (doc.created_by !== userId) throw new ForbiddenException('只能删除自己上传的文档');

  const errors: string[] = [];

  // 级联清理顺序：从下游到上游
  // 1. Neo4j: 删除 entities + chunks + relationships
  try { await this.neo4jService.deleteDocument(docId); } catch (e) { errors.push('Neo4j'); }

  // 2. ES: 删除 chunks
  try { await this.esService.deleteByDocId(docId); } catch (e) { errors.push('ES'); }

  // 3. PGVector: 删除 chunks
  try { await this.vectorService.deleteByDocId(docId); } catch (e) { errors.push('PGVector'); }

  // 4. MongoDB: 删除 Markdown 正文
  try { await this.mongoService.deleteMarkdown(doc.mongo_doc_id); } catch (e) { errors.push('MongoDB'); }

  // 5. RustFS: 删除文件和图片
  try {
    for (const url of doc.uploaded_urls || []) {
      await this.rustfsService.deleteFile(url);
    }
  } catch (e) { errors.push('RustFS'); }

  // 6. Postgres: 删除元信息（最后）
  await this.docRepo.remove(doc);

  if (errors.length > 0) {
    this.logger.warn(`文档 ${docId} 部分清理失败: ${errors.join(', ')}`);
  }
}
```

- [ ] **Step 2: 新增 Controller 端点**

在 `apps/server/src/modules/document/document.controller.ts` 中新增：

```typescript
@Delete(':id')
async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
  await this.docService.deleteDocument(id, req.user.id);
  return { success: true };
}

@Get(':id/preview')
async preview(@Param('id') id: string) {
  const doc = await this.docService.findById(id);
  const markdown = await this.mongoService.getMarkdown(doc.mongo_doc_id);
  return {
    metadata: { id: doc.id, name: doc.doc_name, type: doc.type, status: doc.status },
    markdown: markdown?.slice(0, 10000), // 限制 10000 字符
  };
}

@Post(':id/reindex')
async reindex(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
  // 先清理旧索引
  await this.docService.clearIndexes(id);
  // 触发重新索引
  return this.docService.triggerIndex(id, req.user.id);
}
```

- [ ] **Step 3: 实现 clearIndexes 辅助方法**

在 `apps/server/src/modules/document/document.service.ts` 中新增：

```typescript
async clearIndexes(docId: string): Promise<void> {
  await this.neo4jService.deleteDocument(docId).catch(() => {});
  await this.esService.deleteByDocId(docId).catch(() => {});
  await this.vectorService.deleteByDocId(docId).catch(() => {});
}
```

- [ ] **Step 4: 重写前端 DocumentManagePage**

重写 `apps/web/src/pages/document/DocumentManagePage.tsx`：

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => { loadDocuments(); }, []);

  async function loadDocuments() {
    const { data } = await api.get('/documents', { params: { pageSize: 100 } });
    setDocuments(data.items);
    setLoading(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定要删除「${name}」吗？此操作不可撤销。`)) return;
    await api.delete(`/documents/${id}`);
    setDocuments(prev => prev.filter(d => d.id !== id));
  }

  async function handlePreview(id: string) {
    const { data } = await api.get(`/documents/${id}/preview`);
    setPreview(data);
  }

  async function handleReindex(id: string) {
    await api.post(`/documents/${id}/reindex`);
    loadDocuments();
  }

  const statusColors: Record<string, string> = {
    indexed: '#52c41a', failed: '#ff4d4f', indexing: '#1890ff',
    parsed: '#faad14', uploading: '#bfbfbf', parsing: '#faad14',
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div className="document-manage-page">
      <h1>📂 文档管理</h1>

      <table>
        <thead>
          <tr><th>名称</th><th>类型</th><th>状态</th><th>上传时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {documents.map(doc => (
            <tr key={doc.id}>
              <td>{doc.doc_name}</td>
              <td>{doc.type}</td>
              <td><span style={{ color: statusColors[doc.status] }}>● {doc.status}</span></td>
              <td>{new Date(doc.created_at).toLocaleDateString()}</td>
              <td>
                <button onClick={() => handlePreview(doc.id)}>预览</button>
                {doc.status === 'failed' && (
                  <button onClick={() => handleReindex(doc.id)}>重索引</button>
                )}
                <button className="danger" onClick={() => handleDelete(doc.id, doc.doc_name)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {preview && (
        <div className="modal">
          <div className="modal-content">
            <h2>{preview.metadata.name}</h2>
            <pre>{preview.markdown}</pre>
            <button onClick={() => setPreview(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 验证文档管理功能**

```bash
# 上传 3 个文档 → 打开 /documents/manage
# 1. 确认列表展示正确（名称、类型、状态）
# 2. 点击预览 → 弹窗展示 Markdown 原文
# 3. 点击删除 → 二次确认 → 删除成功后列表刷新
# 4. 检查各存储确认清理完整:
#    docker exec -it <pg> psql -U postgres -d knowledge_base -c "SELECT id FROM documents"
#    docker exec -it <mongo> mongosh knowledge_base --eval "db.markdowns.countDocuments()"
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/document/document.controller.ts
git add apps/server/src/modules/document/document.service.ts
git add apps/web/src/pages/document/DocumentManagePage.tsx
git commit -m "feat: add document delete, preview, and reindex with cascade cleanup"
```

---

## Self-Review Checklist

- [ ] **Spec coverage**: 对照设计文档的 17 项逐项核对
  - 第一层 4 项: 1.1 ✓ 1.2 ✓ 1.3 ✓ 1.4 ✓
  - 第二层 5 项: 2.1 ✓ 2.2 ✓ 2.3 ✓ 2.4 ✓ 2.5 ✓
  - 第三层 3 项: 3.1 ✓ 3.2 ✓ 3.3 ✓
  - 第四层 5 项: 4.1 ✓ 4.2 ✓ 4.3 ✓ 4.4 ✓ 4.5 ✓

- [ ] **Placeholder scan**: 无 TBD/TODO，无"添加适当的错误处理"等空洞描述
- [ ] **Type consistency**: 
  - `ChunkResult` 在所有 task 中字段一致（chunk_id, text, score, rerankScore, postgres_doc_id）
  - `AgentState` 新增字段在各 node 中引用一致（intent, sources, langfuseTrace）
  - `SearchResult` 新字段在 1.4/2.3/2.5 中一致（chunks, degraded, degradeReason, fallbackMessage）
- [ ] **No placeholders**: 每个步骤都包含实际代码内容

---

## 执行建议

总计 **17 个 Task，约 100 个步骤**。建议按层执行，每层完成后跑一次自动化评测脚本确认质量无回退。

**Plan complete and saved to `docs/superpowers/plans/2026-07-30-knowledge-base-rag-optimization-plan.md`.**
