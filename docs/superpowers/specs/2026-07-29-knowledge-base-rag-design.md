# 企业级知识库 RAG 平台 — 设计方案

> 日期：2026-07-29
> 状态：已确认
> MVP 定位：聚焦核心链路，文档解析 → 混合检索 → Agentic RAG 问答

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (React + TypeScript)                 │
│              SSE/WebSocket 流式接收                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP + SSE/WS
┌──────────────────────▼──────────────────────────────────────┐
│                 NestJS 后端 (Node)                            │
│  ┌──────────┬──────────┬──────────┬──────────┐              │
│  │ 文档管理  │ AI 问答   │ 权限控制  │ 数据统计  │              │
│  └──────────┴──────────┴──────────┴──────────┘              │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────────┐     │
│  │       LangGraph Agentic RAG 引擎 (@langchain/langgraph)│     │
│  │  意图分类 → 路由分发 → 工具检索 → Agent ReAct 循环   │     │
│  └────────────────────────────────────────────────────┘     │
└───────┬──────────────┬──────────────┬──────────────┬────────┘
        │              │              │              │
   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
   │ Postgres│   │ MongoDB │   │  Redis   │   │ RustFS  │
   │(元信息) │   │(MD正文) │   │(短记忆) │   │(文件存储)│
   └─────────┘   └─────────┘   └─────────┘   └─────────┘
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │PGVector │   │   ES    │   │  Neo4j  │
   │(向量)   │   │(全文)   │   │(知识图谱)│
   └─────────┘   └─────────┘   └─────────┘
   ┌─────────┐   ┌─────────┐
   │  Mem0   │   │LangFuse │
   │(长记忆) │   │(可观测) │
   └─────────┘   └─────────┘
```

### 存储职责与关联键

| 存储 | 用途 | 存储内容 | 关联键 |
|------|------|---------|--------|
| **Postgres** | 元信息中心 | 文档元信息、用户、角色、权限 | `id`（全局唯一文档 ID） |
| **MongoDB** | 正文原文 | Markdown 正文、postgres_doc_id | `postgres_doc_id` → Postgres |
| **PGVector** | 向量检索 | chunk 文本 + embedding(1536维) + 元数据 | `postgres_doc_id` → Postgres |
| **Elasticsearch** | 全文检索 | chunk 文本（IK 中文分词 + 拼音）+ 关键词 | `postgres_doc_id` → Postgres |
| **Neo4j** | 知识图谱 | 实体关系，关联到 chunk 级 | `postgres_doc_id` → Postgres |
| **Redis** | 短期记忆 | 会话滑动窗口（8轮）、检索缓存 | `session_id` |
| **Mem0** | 长期记忆 | 用户画像、历史摘要、偏好 | `user_id` |
| **RustFS** | 文件存储 | 原文件、提取的图片/附件 | URL 存入 Postgres / MongoDB |

**全局关联规则**：
- **Postgres `documents.id`** 是全局唯一文档 ID（主键），在创建文档记录时由 Postgres 生成
- 所有其他存储（MongoDB / PGVector / ES / Neo4j）持有 `postgres_doc_id` 字段作为外键指向 Postgres
- MongoDB 有自己的 `_id`（ObjectId）仅用于内部索引，跨存储关联统一走 `postgres_doc_id`
- MongoDB 正文是 Markdown 原文的 Single Source of Truth，Postgres 是元信息的 Single Source of Truth

### 技术选型

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite |
| 后端 | NestJS (Node) |
| RAG 引擎 | `@langchain/langgraph` (TypeScript)，嵌入 NestJS 内部运行 |
| LLM 回答 | deepseek-v4-flash-0731（阿里云兼容 OpenAI API） |
| 意图识别 | deepseek-v4-flash-0731（轻量 prompt，~100ms） |
| OCR | 阿里云兼容 OpenAI 多模态 |
| ASR / TTS | 阿里云 / 腾讯云，可切换 |
| 视频处理 | ffmpeg (抽帧 + 抽音频) → OCR + ASR |
| 流式 | SSE（文本流）、WebSocket（语音双向） |
| 监控 | LangFuse 全链路 |
| 部署 | Docker Compose 基础服务 + 本地 pnpm dev |

---

## 二、文档上传与解析流水线

### 支持的格式

PDF / Word / Excel / PPT / Markdown / 文本 / 图片 / 音频 / 视频

### 流程架构：阶段化流水线 + 回滚边界

```
用户上传文件
      │
      ▼
┌─────────────────────────────────────────────┐
│  阶段一：同步解析（任一失败即回滚，返回错误）   │
├─────────────────────────────────────────────┤
│                                             │
│  1. 文件接收                                 │
│     → 原文件上传 RustFS，获得 file_url        │
│                                             │
│  2. 类型识别 & 路由解析                       │
│     ├─ PDF      → PyMuPDF / Marker → MD     │
│     ├─ Word     → mammoth / docx2md → MD    │
│     ├─ Excel    → 转 Markdown Table → MD     │
│     ├─ PPT      → python-pptx 提取 → MD      │
│     ├─ Markdown → 格式校验 + 透传            │
│     ├─ 文本     → UTF-8 编码规范化 → MD       │
│     ├─ 图片     → OCR (阿里云OpenAI) → MD    │
│     ├─ 音频     → ASR (阿里云/腾讯云) → MD    │
│     └─ 视频     → ffmpeg 抽帧+抽音频         │
│                   → 图片走 OCR + 音频走 ASR   │
│                   → 合并为 MD                │
│                                             │
│  3. 图片/附件提取                             │
│     → PDF/Word/PPT 内嵌图片 → 上传 RustFS     │
│     → Markdown 中以 ![](rustfs_url) 引用      │
│                                             │
│  4. 存储                                     │
│     → 原文件 URL + Markdown 正文 → MongoDB    │
│     → 文档元信息 → Postgres                   │
│       (doc_name, type, size, uploader,       │
│        dept_id, mongo_doc_id, rustfs_url,    │
│        status: "parsing")                    │
│                                             │
│  ⬆ 任一步失败 → 清理 RustFS 文件 → 回滚       │
│  成功 → Postgres status 更新为 "parsed"       │
└────────────────────┬────────────────────────┘
                     │ 阶段一成功 = 回滚边界
                     ▼
┌─────────────────────────────────────────────┐
│  阶段二：异步分块 & 索引（失败可重试）          │
├─────────────────────────────────────────────┤
│                                             │
│  5. 语义分块                                 │
│     → Markdown 按标题层级(H1/H2/H3)识别边界   │
│     → 表格不在中间切断，保持完整               │
│     → chunk_size ≈ 800 token                 │
│     → overlap ≈ 150 token                    │
│     → 每个 chunk 附加元数据：                 │
│        {chunk_index, title_level,            │
│         has_image, has_table, page_num}      │
│                                             │
│  6. 并行写入（三路）                          │
│     ├─ PGVector: chunk → embedding(deepseek) │
│     ├─ ES: chunk → IK 分词 + 拼音索引         │
│     └─ Neo4j: chunk → LLM 实体关系抽取        │
│        (实体)-[:MENTIONED_IN]->(Chunk)       │
│        (Chunk)-[:BELONGS_TO]->(Document)     │
│                                             │
│  7. Postgres status → "indexed"              │
│     状态流转: uploading → parsing → parsed    │
│              → indexing → indexed / failed    │
│                                             │
└─────────────────────────────────────────────┘
```

### 关键设计决策

- **阶段一同步**：保证 RustFS + MongoDB 一致性。解析失败不会留下孤儿文件。
- **阶段二异步**：向量化等耗时操作不阻塞上传接口。失败通过 status 标记 + 重试机制处理。
- **统一输出 Markdown**：无论输入什么格式，阶段一统一为 Markdown。阶段二分块逻辑只需处理 Markdown 一种格式。

---

## 三、LangGraph Agentic RAG 工作流

### 核心原则：代码护栏 + 大模型自主决策

```
代码做（确定性）：
  - 意图路由分发规则（LLM 返回意图标签 → 代码判断走哪个分支）
  - RRF 融合算法（数学公式，写死）
  - Rerank 精排（独立小模型，非 LLM）
  - 检索质量阈值检查（最高分 < 0.5 → 直接返回"未找到"）
  - 记忆加载规则（取什么、取多少、Token 控制）
  - 最大轮次强制终止（上限 5 轮）
  - 敏感词过滤

大模型做（需要"理解"）：
  - 用户意图分类（闲聊 / 简单事实 / 综合知识 / 复杂推理）
  - Agent 循环内工具选择（向量？ES？图谱？组合？）
  - 检索结果充分性判断（够了 → 回答，不够 → 换关键词再搜）
  - 最终答案的语言组织
```

### 工作流图

```
                        用户提问
                           │
                           ▼
                 ┌─────────────────┐
                 │   意图分类节点    │  ← deepseek-v4-flash-0731
                 │   4 分类 prompt  │     轻量单次调用
                 └────────┬────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐ ┌──────────┐ ┌──────────────┐
     │ 闲聊/问候 │ │简单事实查询│ │ 综合/复杂查询  │
     │ LLM 直接 │ │PGVector   │ │ 进入 Agent    │
     │ 回答     │ │单路 top-3 │ │ ReAct 循环    │
     └────┬─────┘ └────┬─────┘ └──────┬───────┘
          │            │              │
          │            ▼              ▼
          │    ┌──────────┐   ┌─────────────────────────┐
          │    │拼接Prompt│   │  Agent 节点 (ReAct 循环)  │
          │    │LLM 回答  │   │  bind_tools(llm, [       │
          │    └────┬─────┘   │    向量检索, ES搜索,     │
          │         │         │    Neo4j图谱查询         │
          │         │         │  ])                     │
          │         │         └──────────┬──────────────┘
          │         │                    │
          │         │         ┌──────────▼──────────┐
          │         │         │  addConditionalEdges │
          │         │         │  返回数组 → 并行执行   │
          │         │         └──────────┬──────────┘
          │         │                    │
          │         │    ┌───────────────┼───────────────┐
          │         │    ▼               ▼               ▼
          │         │ ┌──────┐    ┌──────────┐    ┌──────────┐
          │         │ │向量检│    │ES 全文检 │    │Neo4j图谱│
          │         │ │索工具│    │ 索工具   │    │ 查询工具 │
          │         │ └──┬───┘    └────┬─────┘    └────┬─────┘
          │         │    │             │               │
          │         │    └─────────────┼───────────────┘
          │         │                 │
          │         │          ┌──────▼──────┐
          │         │          │  RRF 融合    │  ← 代码（数学公式）
          │         │          │  Rerank 精排 │  ← 代码（Cross-Encoder）
          │         │          │  阈值检查    │  ← 代码
          │         │          │  记忆注入    │  ← 代码
          │         │          │  重构Prompt  │  ← 代码
          │         │          └──────┬──────┘
          │         │                 │
          │         │          ┌──────▼──────┐
          │         │          │ LLM 决策     │─→ 需要更多 → Agent 节点
          │         │          │ (tool_calls  │
          │         │          │  还是 text?) │
          │         │          └──────┬──────┘
          │         │                 │ 够了
          │         │                 ▼
          └─────────┴─────────→ ┌──────────┐
                                │ 生成答案  │
                                └────┬─────┘
                                     │
                                     ▼
                             ┌──────────────┐
                             │ SSE 流式输出  │
                             └──────────────┘
```

### Agent 自主决策范围

Agent（大模型）在循环中**只能决定一件事**：

> "在 向量检索 / ES 关键字 / Neo4j 图谱 这三个工具里，
>  我现在该调哪个？调完了够不够？不够再调哪个？"

检索如何执行、结果如何排序、阈值如何判断、Prompt 如何拼接——全部由代码确定。

### LangGraph 图结构（伪代码）

```typescript
import { StateGraph, END } from "@langchain/langgraph";

const graph = new StateGraph(AgentState)
  // 节点注册
  .addNode("intent_classifier", classifyIntent)
  .addNode("direct_answer", directLlmAnswer)
  .addNode("simple_retrieval", simpleVectorSearch)
  .addNode("agent", agentReActNode)
  .addNode("retrieval_tools", executeRetrievalTools)
  .addNode("generate_answer", generateFinalAnswer)

  // 路由
  .addConditionalEdges("intent_classifier", routeByIntent, {
    chat: "direct_answer",
    simple: "simple_retrieval",
    complex: "agent",
  })

  .addEdge("direct_answer", END)
  .addEdge("simple_retrieval", "generate_answer")

  // Agent ReAct 循环
  .addConditionalEdges("agent", decideNext, {
    tools: "retrieval_tools",   // LLM 决定调工具 → 执行 → 回 agent
    answer: "generate_answer",  // LLM 决定够了 → 生成答案
  })
  .addEdge("retrieval_tools", "agent")
  .addEdge("generate_answer", END);

// 编译 + 运行
const app = graph.compile();
const result = await app.invoke({ messages: [userMessage] });
```

### 检索融合参数

| 参数 | 值 | 说明 |
|------|-----|------|
| PGVector top_k | 10 | 单路召回量 |
| ES top_k | 10 | 单路召回量 |
| Neo4j 多跳深度 | 2 | 实体关系跳数 |
| RRF k | 60 | Reciprocal Rank 平滑参数 |
| Rerank 模型 | bge-reranker-v2-m3 | Cross-Encoder |
| Rerank 后保留 | top 5 | 最终注入 Prompt 的片段数 |

---

## 四、分层记忆设计

### Redis（会话级短期记忆）

```
Layer 1 — 对话滑动窗口
  Key:   session:{session_id}:history
  Value: [
    {role: "user", content: "报销流程是什么？"},
    {role: "assistant", content: "报销流程分为..."},
    ... (最多保留最近 8 轮)
  ]
  TTL: 30 分钟（会话过期自动清理）

Layer 2 — 检索结果缓存
  Key:   cache:search:{query_hash}
  Value: [{chunk_id, text, score}, ...]
  TTL: 30 分钟
  作用: 同一 session 相同 query 不重复检索
```

### Mem0（用户级长期记忆，持久化）

Mem0 支持三级记忆粒度，我们利用其中两级：

```
用户画像（user_id 级，跨会话持久化）
  user_id: "zhangsan"
  department: "研发部"
  role: "工程师"
  preferences:
    answer_style: "简洁"
    common_topics: ["报销", "年假", "研发规范"]

重要事实（user_id 级，LLM 自动提取）
  - "张三工位在 A 栋 3 楼 301"
  - "张三的直属上级是李四"
  - "研发部使用 GitLab 做代码管理"

用户明确记忆（user_id 级，用户主动要求记住）
  - 用户说"记住我工号是 12345" → 写入 Mem0，source: explicit
  - 用户说"以后都用表格回答" → 写入 Mem0 preferences，source: explicit
  特征: priority 高于自动提取的隐式记忆，检索返回时优先展示

会话摘要（session_id 级，会话结束后异步写入）
  session_id: "sess-20260729-001"
  summary: "用户询问了年假政策、报销流程，对审批节点有追问"
  key_conclusions:
    - "年假需提前 3 天申请"
    - "报销单需部门负责人 + 财务双重审批"
  created_at: "2026-07-29T10:30:00Z"
```

**Mem0 记忆生命周期**：
1. 会话进行中 → Redis 维护原始消息
2. 会话结束 → 异步调用 Mem0，LLM 提取摘要 + 关键事实，写入 `session_id` + `user_id`
3. 下次对话 → Mem0 检索相似历史记忆，注入 System Prompt
4. 用户画像持续更新 → 常用主题、偏好风格逐步沉淀

### 记忆注入时序

```
用户提问
    │
    ├── 并行加载
    │   ├── Redis → 最近 8 轮消息 → 拼入 messages[]
    │   └── Mem0  → 用户画像/偏好  → 拼入 System Prompt
    │
    ▼
重构后的 Prompt:
    ┌────────────────────────────┐
    │ System Prompt              │
    │  - 角色定义                │
    │  - 用户明确记忆 (Mem0)     │  ← 🟢 优先级最高，用户指定
    │  - 用户画像 + 偏好 (Mem0)  │
    │  - 历史会话摘要 (Mem0)     │
    │  - 检索到的文档片段         │
    ├────────────────────────────┤
    │ Messages                   │
    │  - 最近 8 轮 (Redis)       │
    │  - 当前提问                │
    └────────────────────────────┘
```

### Token 控制策略

- Redis 最多保留 8 轮对话（硬限制，超出自动丢弃旧轮次）
- Mem0 存摘要而非原始消息（会话结束异步生成摘要写入）
- Prompt 构建时 Token 计数校验 → 超限则压缩轮次（8 → 6 → 4）
- 总 Token 上限：8192（留给生成 2048 余量）

---

## 五、权限设计

### 数据模型

```
users ──→ user_roles ←── roles ──→ role_permissions ←── permissions
  │                   │
  │                   ├── admin       → 所有资源
  │                   ├── dept_admin  → 本部门所有资源 + 用户管理
  │                   └── user        → 本部门文档读取 + 个人文档管理
  │
  └── dept_id ──→ departments (支持 parent_id 层级)
                      │
documents ────────────┘  (dept_id + visibility: public/dept/private)
```

### MVP 实现范围

| 层级 | MVP 实现 | 后续扩展 |
|------|---------|---------|
| **认证** | JWT 登录/注册 | SSO/LDAP 集成 |
| **功能权限** | 3 个固定角色，NestJS Guard 路由拦截 | 动态角色管理、按钮级控制 |
| **数据权限** | 检索强制注入 dept_id 过滤 + visibility 检查 | 跨部门授权审批、细粒度文档 ACL |
| **管理 UI** | 无（直接改数据库配角色） | 角色权限管理后台 |

### 检索数据过滤（核心实现）

```typescript
// 所有检索接口自动注入权限过滤，用户不可绕过
async function searchWithPermission(user: User, query: string) {
  const deptFilter = {
    $or: [
      { visibility: "public" },          // 全公司可见
      { dept_id: user.dept_id },          // 同部门可见
      { created_by: user.id },            // 自己创建的
    ]
  };

  // ES 查询 → filter 子句强制拼接
  // PGVector 查询 → 多取 + 后置过滤
  // Neo4j 查询  → WHERE 条件过滤
}
```

---

## 六、部署架构

### docker-compose 基础服务清单

| 服务 | 镜像 | 端口 |
|------|------|------|
| postgres | pgvector/pgvector:pg16 | 5432 |
| pgAdmin | dpage/pgadmin4:latest | 5050 |
| elasticsearch | 自定义 Dockerfile (IK + 拼音) | 9200 |
| kibana | kibana:8.11.0 | 5601 |
| neo4j | neo4j:latest | 7474 / 7687 |
| redis | redis:7-alpine | 6379 |
| redisinsight | redislabs/redisinsight:latest | 5540 |
| mongo | mongo:7 | 27017 |
| mongo-express | mongo-express:latest | 8081 |
| rustfs | rustfs (S3 兼容对象存储) | 9000 / 9001 |

### 开发环境启动

```bash
# 1. 启动所有基础服务
docker compose up -d

# 2. 启动 NestJS 后端
cd apps/server && pnpm install && pnpm dev   # → localhost:3001

# 3. 启动 React 前端
cd apps/web && pnpm install && pnpm dev      # → localhost:3000
```

### 端口一览

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:3001 |
| pgAdmin | http://localhost:5050 |
| Mongo Express | http://localhost:8081 |
| Kibana | http://localhost:5601 |
| RedisInsight | http://localhost:5540 |
| Neo4j Browser | http://localhost:7474 |

### 项目目录结构（MVP）

```
knowledge-base-rag/
├── docker/
│   ├── Dockerfile.elasticsearch    # ES + IK 中文分词 + 拼音分词
│   └── init-pgvector/              # PG 初始化 SQL 脚本
├── docker-compose.yml              # 基础设施服务
├── .env                            # 环境变量
├── .env.example
├── apps/
│   ├── server/                     # NestJS 后端
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # 认证授权 (JWT + RBAC)
│   │   │   │   ├── document/       # 文档管理 + 上传解析
│   │   │   │   ├── rag/            # Agentic RAG 引擎
│   │   │   │   │   ├── graph.ts             # StateGraph 定义
│   │   │   │   │   ├── state.ts             # AgentState 类型
│   │   │   │   │   ├── nodes/
│   │   │   │   │   │   ├── intent.ts        # 意图分类节点
│   │   │   │   │   │   ├── agent.ts         # Agent ReAct 节点
│   │   │   │   │   │   ├── retrieval.ts     # 检索执行节点
│   │   │   │   │   │   └── generate.ts      # 答案生成节点
│   │   │   │   │   └── tools/
│   │   │   │   │       ├── vector-search.ts  # PGVector 检索工具
│   │   │   │   │       ├── es-search.ts      # ES 全文检索工具
│   │   │   │   │       └── neo4j-query.ts    # Neo4j 图谱查询工具
│   │   │   │   ├── chat/           # SSE/WS 聊天接口
│   │   │   │   └── search/         # 混合检索服务
│   │   │   └── common/             # Guard / Filter / Interceptor
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                        # React + TS 前端
│       ├── src/
│       │   ├── pages/              # 知识库 / AI 问答 / 文档管理
│       │   ├── components/         # 通用组件
│       │   ├── hooks/              # SSE / WebSocket hooks
│       │   └── stores/             # 状态管理
│       ├── package.json
│       └── vite.config.ts
├── scripts/
│   └── setup.sh                    # 一键初始化脚本
└── README.md
```

---

## 附录：大模型选型

| 场景 | 模型 | 提供商 |
|------|------|--------|
| 意图识别 | deepseek-v4-flash-0731 | DeepSeek API |
| 问答生成 | deepseek-v4-flash-0731 | DeepSeek API |
| Embedding | deepseek-v4-flash-0731 (或 text-embedding-3) | — |
| OCR (图片→文字) | 阿里云兼容 OpenAI 多模态 | 阿里云 |
| ASR (语音→文字) | 阿里云 / 腾讯云 ASR | 阿里云 / 腾讯云 |
| TTS (文字→语音) | 阿里云 / 腾讯云 TTS | 阿里云 / 腾讯云 |
| 视频处理 | ffmpeg 预处理 + OCR/ASR | — |

---

## 附录：后续优化方向（非 MVP）

- [ ] 阈值检查与轻量信号检测（检索质量不足时自动降级提示）
- [ ] 追问降级（识别追问时减少检索轮次，优先用缓存）
- [ ] 阶段二消息队列异步（RabbitMQ / BullMQ）
- [ ] 动态 RBAC 管理后台
- [ ] 按钮级权限控制
- [ ] 多模态 Embedding（CLIP 图文检索）
- [ ] 自动化评测脚本（批量量化问答准确率、召回率、响应耗时）
- [ ] 语音实时对话（WebSocket 全双工）
