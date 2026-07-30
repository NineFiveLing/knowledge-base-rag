# 📚 企业知识库 RAG 平台

基于 **LangGraph Agentic RAG** 架构的企业级 AI 知识库系统，支持文档智能解析、混合检索、知识图谱推理、分层记忆与流式语音交互。

## 架构概览

```
React 前端 (SSE/WebSocket)
        │
NestJS 后端 (TypeScript)
  ├── Auth (JWT + RBAC)
  ├── Document (9格式解析 + 分块 + 三路索引)
  ├── Search (PGVector + ES + Neo4j + RRF + Rerank)
  ├── Memory (Redis 短期 + Mem0 长期)
  ├── RAG (LangGraph Agentic 工作流)
  └── Chat (SSE 流式 + WebSocket 语音)
        │
PostgreSQL/PGVector │ MongoDB │ ES │ Neo4j │ Redis │ RustFS
```

## 快速启动

### 1. 环境要求
- Docker Desktop
- Node.js >= 20
- pnpm >= 9

### 2. 启动基础服务
```bash
# 复制环境变量并填写 API Key
cp .env.example .env

# 启动 10 个基础服务（Postgres/MongoDB/ES/Neo4j/Redis/RustFS等）
docker compose up -d
```

### 3. 启动应用
```bash
pnpm install

# 后端 (localhost:3001)
cd apps/server && pnpm dev

# 前端 (localhost:3000)
cd apps/web && pnpm dev
```

## 端口一览

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:3001 |
| pgAdmin | http://localhost:5050 |
| Mongo Express | http://localhost:8081 |
| Kibana | http://localhost:5601 |
| RedisInsight | http://localhost:5540 |
| Neo4j Browser | http://localhost:7474 |

## 默认账号

- 管理员：admin / admin123
- 首次启动自动创建角色、权限、部门种子数据

## 核心能力

- ✅ **9 种格式解析**：PDF/Word/Excel/PPT/Markdown/文本/图片(OCR)/音频(ASR)/视频
- ✅ **混合检索**：PGVector 语义搜索 + ES BM25 全文 + Neo4j 知识图谱多跳
- ✅ **Agentic RAG**：LangGraph 自适应路由（直接回答/简单检索/Agent ReAct循环）
- ✅ **分层记忆**：Redis 会话滑动窗口 + Mem0 用户长期记忆
- ✅ **权限隔离**：JWT 认证 + RBAC 三角色 + 部门数据过滤
- ✅ **流式问答**：SSE 流式输出 + WebSocket 语音网关
- ✅ **Docker 一键部署**

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + Zustand |
| 后端 | NestJS + TypeORM + Mongoose |
| RAG 引擎 | @langchain/langgraph (TS) + @langchain/openai |
| 数据库 | PostgreSQL(pgvector) / MongoDB / Elasticsearch(8.11+IK) / Neo4j / Redis |
| 对象存储 | RustFS (S3 兼容) |
| 记忆管理 | Redis (短) + Mem0 (长) |
| 监控 | LangFuse |
| 部署 | Docker Compose |

## 项目结构

```
knowledge-base-rag/
├── docker/
│   └── Dockerfile.elasticsearch
├── docker-compose.yml
├── apps/
│   ├── server/          # NestJS 后端
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/        # JWT + RBAC
│   │       │   ├── document/    # 文档解析 + 分块 + 索引
│   │       │   ├── search/      # 混合检索 + RRF + Rerank
│   │       │   ├── memory/      # Redis + Mem0 分层记忆
│   │       │   ├── rag/         # LangGraph Agentic RAG
│   │       │   └── chat/        # SSE 流式 + WebSocket
│   │       └── database/
│   │           ├── postgres/    # PGVector
│   │           ├── mongodb/
│   │           ├── elasticsearch/
│   │           ├── neo4j/
│   │           ├── redis/
│   │           └── rustfs/
│   └── web/             # React 前端
└── docs/superpowers/
    ├── specs/           # 设计方案
    └── plans/           # 实现计划
```
