# 企业级知识库 RAG 平台 — 实现计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐步实现。步骤使用 checkbox 语法。

**Goal:** 从零搭建支持文档解析、混合检索、Agentic RAG 问答的企业知识库平台 MVP。

**Architecture:** 纯 TypeScript 栈 — NestJS 内嵌 `@langchain/langgraph` 引擎，React 前端 SSE 流式接收。Postgres(元信息+全局ID)、MongoDB(正文)、PGVector(向量)、ES(全文,IK+拼音)、Neo4j(图谱)、Redis(会话记忆)、Mem0(长期记忆)、RustFS(文件)。10 个基础服务 Docker Compose 一键启动。

**Tech Stack:** NestJS + TypeScript, `@langchain/langgraph`, `@langchain/openai`, React + Vite, PostgreSQL/pgvector, MongoDB 7, Elasticsearch 8.11 (IK+拼音), Neo4j, Redis 7, Mem0, RustFS, LangFuse

## 全局约束

- 所有服务通过 docker-compose 本地启动，前后端 `pnpm dev` 开发
- Postgres `documents.id` 是全局唯一文档 ID，所有其他存储持有 `postgres_doc_id` 外键
- 代码护栏：LLM 只在 Agent 循环中决策工具选择，检索/排序/阈值/记忆加载全部代码确定
- MVP 权限：3 个固定角色(admin/dept_admin/user)，Guards + 数据过滤
- SSE 流式问答，WebSocket 语音双向
- 敏感信息 `.env` 管理

---

## 任务清单总览

| 阶段 | 任务 | 产出 |
|------|------|------|
| 阶段一：项目骨架 | Task 1-3 | Monorepo + NestJS + React 项目可启动 |
| 阶段二：数据库 | Task 4-8 | 5 个数据库连接 + 实体定义 |
| 阶段三：认证授权 | Task 9-11 | JWT 登录/注册 + RBAC Guards |
| 阶段四：文档管理 | Task 12-18 | 多格式上传解析 + 分块 + 三路索引 |
| 阶段五：检索引擎 | Task 19-22 | PGVector/ES/Neo4j 并行检索 + RRF + Rerank |
| 阶段六：记忆系统 | Task 23-25 | Redis 滑动窗口 + Mem0 长记忆 |
| 阶段七：RAG 引擎 | Task 26-31 | LangGraph StateGraph + 意图分类 + Agent ReAct |
| 阶段八：聊天接口 | Task 32-34 | SSE 流式问答 + WebSocket 语音 |
| 阶段九：前端 | Task 35-40 | 登录/知识库/文档上传/AI 问答页面 |
| 阶段十：收尾 | Task 41-43 | LangFuse 监控 + 测试 + README |

---

### Task 1: 初始化 Monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`

```bash
mkdir -p /d/project/knowledge-base-rag/apps/server /d/project/knowledge-base-rag/apps/web
cd /d/project/knowledge-base-rag
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
```

根 `package.json`:
```json
{
  "name": "knowledge-base-rag",
  "private": true,
  "scripts": {
    "dev:server": "pnpm --filter server dev",
    "dev:web": "pnpm --filter web dev",
    "dev": "concurrently \"pnpm dev:server\" \"pnpm dev:web\""
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] 创建 `package.json`, `pnpm-workspace.yaml`, `.gitignore`
- [ ] 运行 `pnpm install`
- [ ] Commit: `chore: init monorepo`

---

### Task 2: 搭建 NestJS 后端骨架

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/nest-cli.json`
- Create: `apps/server/src/main.ts`, `apps/server/src/app.module.ts`

```bash
cd apps/server
pnpm init
pnpm add @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/config @nestjs/typeorm typeorm pg reflect-metadata rxjs class-validator class-transformer
pnpm add -D @nestjs/cli @nestjs/testing typescript @types/node ts-node
```

`apps/server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`apps/server/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.SERVER_PORT || 3001);
}
bootstrap();
```

`apps/server/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
  ],
})
export class AppModule {}
```

- [ ] 创建所有文件
- [ ] 运行 `pnpm dev` 确认服务启动在 localhost:3001
- [ ] Commit: `feat: nestjs server scaffold`

---

### Task 3: 搭建 React 前端骨架

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`

```bash
cd apps/web
pnpm init
pnpm add react react-dom react-router-dom zustand axios
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

`apps/web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

`apps/web/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>企业知识库</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

`apps/web/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>企业知识库平台 - 建设中</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] 创建所有文件，运行 `pnpm dev` 确认 http://localhost:3000 显示占位页面
- [ ] Commit: `feat: react frontend scaffold`

---

### Task 4: PostgreSQL 连接与文档实体

**Files:**
- Create: `apps/server/src/database/postgres/postgres.module.ts`
- Create: `apps/server/src/modules/document/entities/document.entity.ts`
- Create: `docker/init-pgvector/01-init.sql`

先在 `apps/server` 安装依赖:
```bash
pnpm add @nestjs/typeorm typeorm pg
```

`apps/server/src/database/postgres/postgres.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: config.get('POSTGRES_PORT', 5432),
        username: config.get('POSTGRES_USER', 'postgres'),
        password: config.get('POSTGRES_PASSWORD', 'password'),
        database: config.get('POSTGRES_DB', 'ai_agent'),
        autoLoadEntities: true,
        synchronize: true, // MVP 开发用，生产改为 migration
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class PostgresModule {}
```

在 `app.module.ts` 中导入 `PostgresModule`。

`apps/server/src/modules/document/entities/document.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum DocumentStatus {
  UPLOADING = 'uploading',
  PARSING = 'parsing',
  PARSED = 'parsed',
  INDEXING = 'indexing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}

export enum DocumentVisibility {
  PUBLIC = 'public',
  DEPT = 'dept',
  PRIVATE = 'private',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ['pdf','word','excel','ppt','markdown','text','image','audio','video'] })
  type: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column()
  uploader_id: string;

  @Column({ nullable: true })
  dept_id: string;

  @Column({ type: 'enum', enum: DocumentVisibility, default: DocumentVisibility.DEPT })
  visibility: DocumentVisibility;

  @Column()
  mongo_doc_id: string; // MongoDB _id 字符串

  @Column()
  rustfs_file_url: string; // 原文件在 RustFS 的 URL

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.UPLOADING })
  status: DocumentStatus;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

`docker/init-pgvector/01-init.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

- [ ] 创建所有文件，确保 `app.module.ts` 导入 `PostgresModule`
- [ ] 运行后端，确认 TypeORM 自动创建 `documents` 表
- [ ] Commit: `feat: postgres connection and document entity`

---

### Task 5: MongoDB 连接

**Files:**
- Create: `apps/server/src/database/mongodb/mongodb.module.ts`
- Create: `apps/server/src/database/mongodb/mongodb.service.ts`

```bash
cd apps/server && pnpm add mongoose @nestjs/mongoose
```

`apps/server/src/database/mongodb/mongodb.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get('MONGO_HOST', 'localhost');
        const port = config.get('MONGO_PORT', '27017');
        const user = config.get('MONGO_USER', 'admin');
        const pass = config.get('MONGO_PASSWORD', 'admin123');
        const db = config.get('MONGO_DB', 'knowledge_base');
        return {
          uri: `mongodb://${user}:${pass}@${host}:${port}/${db}?authSource=admin`,
        };
      },
    }),
  ],
  exports: [MongooseModule],
})
export class MongoDBModule {}
```

`apps/server/src/database/mongodb/mongodb.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DocMarkdown, DocMarkdownDocument } from './schemas/doc-markdown.schema';

@Injectable()
export class MongoDBService {
  constructor(
    @InjectModel(DocMarkdown.name) private docMdModel: Model<DocMarkdownDocument>,
  ) {}

  async saveMarkdown(postgresDocId: string, markdown: string, rawMetadata?: Record<string, any>) {
    return this.docMdModel.create({ postgres_doc_id: postgresDocId, markdown_content: markdown, raw_metadata: rawMetadata });
  }

  async getMarkdown(postgresDocId: string) {
    return this.docMdModel.findOne({ postgres_doc_id: postgresDocId }).exec();
  }
}
```

创建 `apps/server/src/database/mongodb/schemas/doc-markdown.schema.ts`:
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document as MongoDoc } from 'mongoose';

export type DocMarkdownDocument = DocMarkdown & MongoDoc;

@Schema({ timestamps: true })
export class DocMarkdown {
  @Prop({ required: true, index: true })
  postgres_doc_id: string;

  @Prop({ required: true, type: String })
  markdown_content: string;

  @Prop({ type: Object })
  raw_metadata: Record<string, any>;
}

export const DocMarkdownSchema = SchemaFactory.createForClass(DocMarkdown);
```

- [ ] 创建所有文件，在 `app.module.ts` 导入 `MongoDBModule`
- [ ] 启动后端，确认 MongoDB 连接成功
- [ ] Commit: `feat: mongodb connection and doc-markdown schema`

---

### Task 6: Elasticsearch 连接

**Files:**
- Create: `apps/server/src/database/elasticsearch/es.module.ts`
- Create: `apps/server/src/database/elasticsearch/es.service.ts`

```bash
cd apps/server && pnpm add @elastic/elasticsearch
```

`apps/server/src/database/elasticsearch/es.module.ts`:
```typescript
import { Module, Global } from '@nestjs/common';
import { ElasticsearchService } from './es.service';

@Global()
@Module({
  providers: [ElasticsearchService],
  exports: [ElasticsearchService],
})
export class ElasticsearchModule {}
```

`apps/server/src/database/elasticsearch/es.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  public client: Client;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get('ES_HOST', 'localhost');
    const port = this.config.get('ES_PORT', '9200');
    this.client = new Client({ node: `http://${host}:${port}` });
    await this.ensureIndex();
  }

  private async ensureIndex() {
    const exists = await this.client.indices.exists({ index: 'chunks' });
    if (!exists) {
      await this.client.indices.create({
        index: 'chunks',
        body: {
          settings: {
            analysis: {
              analyzer: {
                ik_smart_analyzer: { type: 'custom', tokenizer: 'ik_smart' },
                ik_max_analyzer: { type: 'custom', tokenizer: 'ik_max_word' },
              },
            },
          },
          mappings: {
            properties: {
              chunk_id: { type: 'keyword' },
              postgres_doc_id: { type: 'keyword' },
              chunk_text: { type: 'text', analyzer: 'ik_max_analyzer', search_analyzer: 'ik_smart_analyzer' },
              keywords: { type: 'keyword' },
              metadata: { type: 'object' },
              dept_id: { type: 'keyword' },
              visibility: { type: 'keyword' },
            },
          },
        },
      });
    }
  }

  async indexChunk(chunk: { chunk_id: string; postgres_doc_id: string; chunk_text: string; keywords: string[]; metadata: any; dept_id: string; visibility: string }) {
    await this.client.index({ index: 'chunks', id: chunk.chunk_id, body: chunk });
  }

  async search(query: string, deptFilter: object, topK: number = 10) {
    const result = await this.client.search({
      index: 'chunks',
      body: {
        query: {
          bool: {
            must: [{ multi_match: { query, fields: ['chunk_text^2', 'keywords'], type: 'best_fields' } }],
            filter: deptFilter,
          },
        },
      },
      size: topK,
    });
    return result.hits.hits.map(h => ({ chunk_id: h._id, ...h._source as object, score: h._score }));
  }
}
```

- [ ] 创建所有文件，在 `app.module.ts` 导入 `ElasticsearchModule`
- [ ] 启动后端，验证 ES 索引 `chunks` 自动创建
- [ ] Commit: `feat: elasticsearch connection with IK index setup`

---

### Task 7: Neo4j 连接

**Files:**
- Create: `apps/server/src/database/neo4j/neo4j.module.ts`
- Create: `apps/server/src/database/neo4j/neo4j.service.ts`

```bash
cd apps/server && pnpm add neo4j-driver
```

`apps/server/src/database/neo4j/neo4j.service.ts`:
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get('NEO4J_HOST', 'localhost');
    const port = this.config.get('NEO4J_BOLT_PORT', '7687');
    const user = this.config.get('NEO4J_USER', 'neo4j');
    const pass = this.config.get('NEO4J_PASSWORD', 'neo4j123456');
    this.driver = neo4j.driver(`bolt://${host}:${port}`, neo4j.auth.basic(user, pass));
  }

  async onModuleDestroy() { await this.driver.close(); }

  async run(cypher: string, params?: Record<string, any>) {
    const session = this.driver.session();
    try { return await session.run(cypher, params); }
    finally { await session.close(); }
  }

  async createDocumentNode(postgresDocId: string, docName: string) {
    await this.run(
      `MERGE (d:Document {postgres_doc_id: $id}) SET d.name = $name`,
      { id: postgresDocId, name: docName },
    );
  }

  async createChunkRelation(postgresDocId: string, chunkId: string) {
    await this.run(
      `MATCH (d:Document {postgres_doc_id: $docId})
       MERGE (c:Chunk {chunk_id: $chunkId, postgres_doc_id: $docId})
       MERGE (d)-[:HAS_CHUNK]->(c)`,
      { docId: postgresDocId, chunkId },
    );
  }

  async createEntityRelation(entityName: string, entityType: string, chunkId: string, postgresDocId: string) {
    await this.run(
      `MATCH (c:Chunk {chunk_id: $chunkId})
       MERGE (e:Entity {name: $name, type: $type})
       MERGE (e)-[:MENTIONED_IN]->(c)`,
      { chunkId, name: entityName, type: entityType },
    );
  }

  async queryEntities(query: string, maxHops: number = 2) {
    const result = await this.run(
      `MATCH path = (e:Entity)-[:MENTIONED_IN]->(c:Chunk)
       WHERE toLower(e.name) CONTAINS toLower($query)
       MATCH (c)-[:BELONGS_TO]->(d:Document)
       RETURN e.name AS entity, e.type AS type, c.chunk_id AS chunkId, c.text AS chunkText, d.postgres_doc_id AS docId
       LIMIT 10`,
      { query },
    );
    return result.records.map(r => r.toObject());
  }
}
```

- [ ] 创建 `Neo4jModule` (Global) 和 `Neo4jService`
- [ ] 启动后端，验证 Neo4j 连接
- [ ] Commit: `feat: neo4j connection with graph operations`

---

### Task 8: Redis & RustFS 连接

**Files:**
- Create: `apps/server/src/database/redis/redis.module.ts`, `redis.service.ts`
- Create: `apps/server/src/database/rustfs/rustfs.module.ts`, `rustfs.service.ts`

```bash
cd apps/server && pnpm add ioredis @aws-sdk/client-s3 @aws-sdk/lib-storage
```

`apps/server/src/database/redis/redis.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService implements OnModuleInit {
  public client: Redis;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
    });
  }

  async setSessionHistory(sessionId: string, messages: Array<{role: string; content: string}>, ttl = 1800) {
    await this.client.setex(`session:${sessionId}:history`, ttl, JSON.stringify(messages.slice(-16))); // 最多8轮=16条
  }

  async getSessionHistory(sessionId: string) {
    const raw = await this.client.get(`session:${sessionId}:history`);
    return raw ? JSON.parse(raw) : [];
  }

  async cacheSearchResult(queryHash: string, results: any[], ttl = 1800) {
    await this.client.setex(`cache:search:${queryHash}`, ttl, JSON.stringify(results));
  }

  async getCachedSearch(queryHash: string) {
    const raw = await this.client.get(`cache:search:${queryHash}`);
    return raw ? JSON.parse(raw) : null;
  }
}
```

`apps/server/src/database/rustfs/rustfs.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';

@Injectable()
export class RustFSService {
  private s3: S3Client;
  private bucket = 'knowledge-base';

  constructor(private config: ConfigService) {
    this.s3 = new S3Client({
      endpoint: config.get('RUSTFS_ENDPOINT', 'http://localhost:9000'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.get('RUSTFS_ACCESS_KEY', 'rustfsadmin'),
        secretAccessKey: config.get('RUSTFS_SECRET_KEY', 'rustfsadmin'),
      },
      forcePathStyle: true,
    });
  }

  async uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const key = `documents/${uuid()}/${filename}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
    return `${this.config.get('RUSTFS_ENDPOINT')}/${this.bucket}/${key}`;
  }

  async deleteFile(fileUrl: string) {
    const key = fileUrl.split(`${this.bucket}/`)[1];
    if (key) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getFileStream(fileUrl: string) {
    const key = fileUrl.split(`${this.bucket}/`)[1];
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return response.Body;
  }
}
```

- [ ] 分别创建 `RedisModule`(Global) + `RedisService`、`RustFSModule`(Global) + `RustFSService`
- [ ] 添加 `uuid` 依赖: `pnpm add uuid && pnpm add -D @types/uuid`
- [ ] 启动后端，验证 Redis 连接（ping）、RustFS bucket 可创建
- [ ] Commit: `feat: redis and rustfs connections`

---

### Task 9: 用户实体与 Auth 模块基础

**Files:**
- Create: `apps/server/src/modules/user/entities/user.entity.ts`
- Create: `apps/server/src/modules/user/entities/role.entity.ts`
- Create: `apps/server/src/modules/user/entities/department.entity.ts`
- Create: `apps/server/src/modules/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`
- Create: `apps/server/src/modules/auth/dto/register.dto.ts`, `login.dto.ts`

```bash
cd apps/server && pnpm add @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt
pnpm add -D @types/passport-jwt @types/bcrypt
```

`apps/server/src/modules/user/entities/user.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, JoinTable, CreateDateColumn } from 'typeorm';
import { Department } from './department.entity';
import { Role } from './role.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  password_hash: string;

  @Column()
  real_name: string;

  @ManyToOne(() => Department, { nullable: true })
  department: Department;

  @Column({ nullable: true })
  dept_id: string;

  @ManyToMany(() => Role)
  @JoinTable({ name: 'user_roles' })
  roles: Role[];

  @CreateDateColumn()
  created_at: Date;
}
```

`apps/server/src/modules/user/entities/role.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from 'typeorm';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  code: string; // 'admin' | 'dept_admin' | 'user'

  @ManyToMany(() => Permission)
  @JoinTable({ name: 'role_permissions' })
  permissions: Permission[];
}
```

`apps/server/src/modules/user/entities/permission.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  resource: string; // e.g. 'document:read', 'document:delete'

  @Column()
  action: string;   // 'read' | 'create' | 'update' | 'delete'
}
```

`apps/server/src/modules/user/entities/department.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  parent_id: string;

  @ManyToOne(() => Department, { nullable: true })
  parent: Department;

  @OneToMany(() => Department, d => d.parent)
  children: Department[];
}
```

`apps/server/src/modules/auth/auth.service.ts` (核心方法):
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../user/entities/user.entity';
import { Role } from '../user/entities/role.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const password_hash = await bcrypt.hash(dto.password, 10);
    const defaultRole = await this.roleRepo.findOne({ where: { code: 'user' } });
    const user = this.userRepo.create({
      username: dto.username,
      password_hash,
      real_name: dto.real_name,
      dept_id: dto.dept_id,
      roles: [defaultRole],
    });
    await this.userRepo.save(user);
    return { id: user.id, username: user.username };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { username: dto.username }, relations: ['roles', 'department'] });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('用户名或密码错误');
    const payload = { sub: user.id, username: user.username };
    return { access_token: this.jwtService.sign(payload), user: { id: user.id, username: user.username, real_name: user.real_name, dept_id: user.dept_id, roles: user.roles.map(r => r.code) } };
  }
}
```

- [ ] 创建所有实体(User/Role/Permission/Department)和 DTO
- [ ] 实现 `AuthService.register()` 和 `AuthService.login()`
- [ ] 实现 `AuthController`（POST /auth/register, POST /auth/login）
- [ ] 创建 `JwtStrategy` (`apps/server/src/modules/auth/strategies/jwt.strategy.ts`)
- [ ] 启动后端，测试注册+登录返回 JWT
- [ ] Commit: `feat: user entities and auth module with JWT login`

---

### Task 10: RBAC Guards

**Files:**
- Create: `apps/server/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/server/src/common/guards/roles.guard.ts`
- Create: `apps/server/src/common/decorators/roles.decorator.ts`
- Create: `apps/server/src/common/decorators/current-user.decorator.ts`

`apps/server/src/common/guards/jwt-auth.guard.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`apps/server/src/common/decorators/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/server/src/common/guards/roles.guard.ts`:
```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

`apps/server/src/common/decorators/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
```

- [ ] 创建所有 Guard 和 Decorator
- [ ] 在 `AppModule` 全局注册 `JwtAuthGuard`
- [ ] 写一个测试端点 `GET /auth/me` (用 `@UseGuards(JwtAuthGuard)`) 验证 Guard 生效
- [ ] Commit: `feat: rbac guards and decorators`

---

### Task 11: 数据库种子脚本（预置角色+部门+管理员）

**Files:**
- Create: `apps/server/src/database/seeds/seed.service.ts`
- Create: `apps/server/src/database/seeds/seed.module.ts`

`apps/server/src/database/seeds/seed.service.ts`:
```typescript
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../../modules/user/entities/role.entity';
import { Permission } from '../../modules/user/entities/permission.entity';
import { Department } from '../../modules/user/entities/department.entity';
import { User } from '../../modules/user/entities/user.entity';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
    @InjectRepository(Department) private deptRepo: Repository<Department>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async onApplicationBootstrap() {
    await this.seed();
  }

  async seed() {
    // 权限
    const perms = await this.permRepo.save([
      { resource: 'document', action: 'read' },
      { resource: 'document', action: 'create' },
      { resource: 'document', action: 'delete' },
      { resource: 'admin', action: 'manage' },
    ]);

    // 角色
    const adminRole = await this.roleRepo.save({ name: '管理员', code: 'admin', permissions: perms });
    const deptAdminRole = await this.roleRepo.save({ name: '部门管理员', code: 'dept_admin', permissions: perms.filter(p => p.resource === 'document') });
    const userRole = await this.roleRepo.save({ name: '普通员工', code: 'user', permissions: perms.filter(p => p.action === 'read') });

    // 部门
    const dept = await this.deptRepo.save([{ name: '总经办' }, { name: '研发部' }, { name: '财务部' }, { name: '人事部' }]);

    // 管理员账号
    const existing = await this.userRepo.findOne({ where: { username: 'admin' } });
    if (!existing) {
      await this.userRepo.save({
        username: 'admin',
        password_hash: await bcrypt.hash('admin123', 10),
        real_name: '系统管理员',
        dept_id: dept[0].id,
        roles: [adminRole],
      });
    }
  }
}
```

- [ ] 创建 `SeedModule`，导入所有 Entity + 注册 `SeedService`
- [ ] 在 `app.module.ts` 中导入 `SeedModule`
- [ ] 启动后端，验证数据库自动创建角色/权限/部门/管理员
- [ ] Commit: `feat: database seed with default roles, departments, and admin user`

---

### Task 12: 文档上传控制器 + 阶段一解析框架

**Files:**
- Create: `apps/server/src/modules/document/document.module.ts`, `document.controller.ts`, `document.service.ts`
- Create: `apps/server/src/modules/document/dto/upload.dto.ts`
- Create: `apps/server/src/modules/document/parsers/parser.interface.ts`

`apps/server/src/modules/document/parsers/parser.interface.ts`:
```typescript
export interface ParseResult {
  markdown: string;
  images: Array<{ originalName: string; buffer: Buffer; mimeType: string; placeholderInMd: string }>;
  metadata: Record<string, any>;
}

export interface DocumentParser {
  readonly supportedTypes: string[];
  parse(buffer: Buffer, filename: string): Promise<ParseResult>;
}
```

`apps/server/src/modules/document/document.service.ts` 核心流程:
```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from './entities/document.entity';
import { RustFSService } from '../../database/rustfs/rustfs.service';
import { MongoDBService } from '../../database/mongodb/mongodb.service';
import { DocumentParser, ParseResult } from './parsers/parser.interface';

@Injectable()
export class DocumentService {
  private parsers: Map<string, DocumentParser> = new Map();

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private rustfs: RustFSService,
    private mongo: MongoDBService,
  ) {}

  registerParser(parser: DocumentParser) {
    for (const type of parser.supportedTypes) {
      this.parsers.set(type, parser);
    }
  }

  async uploadStage1(file: Express.Multer.File, uploaderId: string, deptId: string) {
    // 阶段一：同步解析（任一失败即回滚）
    const uploadedUrls: string[] = [];

    try {
      // 1. 上传原文件到 RustFS
      const fileUrl = await this.rustfs.uploadFile(file.buffer, file.originalname, file.mimetype);
      uploadedUrls.push(fileUrl);

      // 2. 类型识别 & 路由解析
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      const typeMap: Record<string, string> = {
        pdf: 'pdf', doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel',
        ppt: 'ppt', pptx: 'ppt', md: 'markdown', txt: 'text', csv: 'text',
        png: 'image', jpg: 'image', jpeg: 'image',
        mp3: 'audio', wav: 'audio', mp4: 'video', avi: 'video',
      };
      const type = typeMap[ext || ''] || 'text';

      const parser = this.parsers.get(type);
      if (!parser) throw new BadRequestException(`不支持的文件类型: ${ext}`);

      const result: ParseResult = await parser.parse(file.buffer, file.originalname);

      // 3. 上传提取的图片到 RustFS，替换 Markdown 引用
      for (const img of result.images) {
        const imgUrl = await this.rustfs.uploadFile(img.buffer, img.originalName, img.mimeType);
        uploadedUrls.push(imgUrl);
        result.markdown = result.markdown.replace(img.placeholderInMd, imgUrl);
      }

      // 4. 存 MongoDB（Markdown 正文）
      const mongoDoc = await this.mongo.saveMarkdown('pending', result.markdown, result.metadata);

      // 5. 存 Postgres（元信息）
      const doc = this.docRepo.create({
        name: file.originalname,
        type,
        size: file.size,
        uploader_id: uploaderId,
        dept_id: deptId,
        mongo_doc_id: mongoDoc._id.toString(),
        rustfs_file_url: fileUrl,
        status: DocumentStatus.PARSED,
      });
      const saved = await this.docRepo.save(doc);

      // 6. 回填 MongoDB 中的 postgres_doc_id
      await this.mongo.saveMarkdown(saved.id, result.markdown, result.metadata);

      return { docId: saved.id, status: saved.status };
    } catch (error) {
      // 回滚：清理已上传的 RustFS 文件
      for (const url of uploadedUrls) {
        await this.rustfs.deleteFile(url).catch(() => {});
      }
      throw error;
    }
  }
}
```

- [ ] 创建 `DocumentModule`、`DocumentController`（POST /documents/upload, 使用 multer）
- [ ] 实现 `DocumentService` 阶段一核心流程
- [ ] 提交基本结构（解析器逐个添加）
- [ ] Commit: `feat: document upload controller and stage1 framework`

---

### Task 13: PDF 解析器

**Files:**
- Create: `apps/server/src/modules/document/parsers/pdf.parser.ts`

```bash
cd apps/server && pnpm add pdf-parse mammoth
```

```typescript
import { Injectable } from '@nestjs/common';
import { DocumentParser, ParseResult } from './parser.interface';
import * as pdfParse from 'pdf-parse';

@Injectable()
export class PdfParser implements DocumentParser {
  readonly supportedTypes = ['pdf'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const data = await pdfParse(buffer);
    const markdown = `# ${filename}\n\n${data.text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n\n')}`;

    return {
      markdown,
      images: [],
      metadata: { pageCount: data.numpages, info: data.info },
    };
  }
}
```

- [ ] 实现 `PdfParser`，在 `DocumentModule` 中注册
- [ ] 用示例 PDF 测试上传，验证 MongoDB 中存储了 Markdown 正文
- [ ] Commit: `feat: pdf parser`

---

### Task 14: Word / Markdown / 文本解析器

**Files:**
- Create: `apps/server/src/modules/document/parsers/word.parser.ts`
- Create: `apps/server/src/modules/document/parsers/markdown.parser.ts`
- Create: `apps/server/src/modules/document/parsers/text.parser.ts`

Word parser:
```typescript
import * as mammoth from 'mammoth';
// mammoth.convertToMarkdown({ buffer }) → { value: markdownString }
```

Markdown parser (直接透传 + 格式校验):
```typescript
// 校验是否为有效 Markdown，直接返回原内容
```

Text parser:
```typescript
// UTF-8 解码 → 规范化换行 → 包装为 Markdown
```

- [ ] 实现三种解析器，语义明确，各自注册到 `DocumentModule`
- [ ] Commit: `feat: word, markdown, and text parsers`

---

### Task 15: Excel / PPT 解析器

**Files:**
- Create: `apps/server/src/modules/document/parsers/excel.parser.ts`
- Create: `apps/server/src/modules/document/parsers/ppt.parser.ts`

```bash
cd apps/server && pnpm add xlsx
```

Excel parser:
```typescript
import * as XLSX from 'xlsx';
// workbook = XLSX.read(buffer)
// 每个 sheet → Markdown Table (| col1 | col2 |)
```

PPT parser (使用 `pptx-parser` 或手动提取):
```typescript
// 提取每页文本 → Markdown 标题 + 内容
```

- [ ] 实现 Excel/PPT 解析器，注册到 `DocumentModule`
- [ ] Commit: `feat: excel and ppt parsers`

---

### Task 16: 图片 / 音频 / 视频解析器

**Files:**
- Create: `apps/server/src/modules/document/parsers/image.parser.ts`
- Create: `apps/server/src/modules/document/parsers/audio.parser.ts`
- Create: `apps/server/src/modules/document/parsers/video.parser.ts`

```bash
cd apps/server && pnpm add @langchain/openai
```

Image parser (OCR via Aliyun OpenAI multimodal):
```typescript
import { ChatOpenAI } from '@langchain/openai';
// base64 encode image → ChatOpenAI({ model: 'qwen-vl-plus', baseURL: aliyunUrl })
// prompt: "请提取图片中的所有文字，以 Markdown 格式输出"
// → response.content as string
```

Audio parser (ASR via Aliyun/Tencent):
```typescript
// 调用阿里云 ASR API (一句话识别)
// → text → Markdown
```

Video parser:
```typescript
import { exec } from 'child_process';
// 1. ffmpeg -i input.mp4 -q:v 2 -f image2 frame_%03d.jpg (抽帧, 每分钟1帧)
// 2. ffmpeg -i input.mp4 -vn -acodec pcm_s16le audio.wav (抽音频)
// 3. 图片帧 → ImageParser (OCR)
// 4. 音频 → AudioParser (ASR)
// 5. 合并 OCR + ASR 文本 → Markdown
```

- [ ] 实现 Image/Audio/Video 解析器
- [ ] Video parser 内部使用 `child_process.exec` 调用 ffmpeg
- [ ] 注册到 `DocumentModule`
- [ ] Commit: `feat: image ocr, audio asr, and video parsers`

---

### Task 17: 分块器 (Chunker)

**Files:**
- Create: `apps/server/src/modules/document/services/chunker.service.ts`

```bash
cd apps/server && pnpm add langchain @langchain/textsplitters
```

```typescript
import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface Chunk {
  chunk_id: string;
  postgres_doc_id: string;
  chunk_index: number;
  chunk_text: string;
  title_level: number;
  has_image: boolean;
  has_table: boolean;
  page_num?: number;
}

@Injectable()
export class ChunkerService {
  private splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 150,
    separators: ['\n## ', '\n### ', '\n#### ', '\n', '。', '.', ' ', ''],
  });

  async chunk(markdown: string, postgresDocId: string): Promise<Chunk[]> {
    const docs = await this.splitter.createDocuments([markdown]);
    return docs.map((doc, i) => {
      const titleLevel = this.detectTitleLevel(doc.pageContent);
      return {
        chunk_id: `${postgresDocId}-chunk-${String(i).padStart(4, '0')}`,
        postgres_doc_id: postgresDocId,
        chunk_index: i,
        chunk_text: doc.pageContent,
        title_level: titleLevel,
        has_image: /!\[.*\]\(.*\)/.test(doc.pageContent),
        has_table: /\|.*\|/.test(doc.pageContent),
      };
    });
  }

  private detectTitleLevel(text: string): number {
    const match = text.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
  }
}
```

- [ ] 实现 `ChunkerService`，注册到 `DocumentModule`
- [ ] 单元测试：用示例 Markdown 验证分块数、块内图片/表格检测
- [ ] Commit: `feat: semantic chunker with markdown structure awareness`

---

### Task 18: 三路索引器 (Indexer) — 阶段二

**Files:**
- Create: `apps/server/src/modules/document/services/indexer.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../entities/document.entity';
import { ChunkerService, Chunk } from './chunker.service';
import { ElasticsearchService } from '../../../database/elasticsearch/es.service';
import { Neo4jService } from '../../../database/neo4j/neo4j.service';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IndexerService {
  private llm: ChatOpenAI;
  private pgVector: any; // TypeORM PGVector repository

  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private chunker: ChunkerService,
    private es: ElasticsearchService,
    private neo4j: Neo4jService,
    private config: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      model: config.get('MODEL_NAME'),
      apiKey: config.get('ALIYUN_API_KEY'),
      configuration: { baseURL: config.get('ALIYUN_BASE_URL') },
    });
  }

  async indexDocument(postgresDocId: string) {
    const doc = await this.docRepo.findOne({ where: { id: postgresDocId } });
    if (!doc || doc.status !== DocumentStatus.PARSED) return;

    // 标记开始索引
    doc.status = DocumentStatus.INDEXING;
    await this.docRepo.save(doc);

    try {
      // 1. 从 MongoDB 取 Markdown 正文
      const mongoDoc = await this.mongo.getMarkdown(postgresDocId);

      // 2. 分块
      const chunks = await this.chunker.chunk(mongoDoc.markdown_content, postgresDocId);

      // 3. 三路并行写入
      await Promise.all(chunks.map(chunk => this.indexChunk(chunk, doc)));

      // 4. 更新状态
      doc.status = DocumentStatus.INDEXED;
      await this.docRepo.save(doc);
    } catch (error) {
      doc.status = DocumentStatus.FAILED;
      await this.docRepo.save(doc);
      throw error;
    }
  }

  private async indexChunk(chunk: Chunk, doc: Document) {
    // PGVector: embedding + insert (依赖后续 Task 19)
    // ES: 全文索引
    await this.es.indexChunk({
      chunk_id: chunk.chunk_id,
      postgres_doc_id: chunk.postgres_doc_id,
      chunk_text: chunk.chunk_text,
      keywords: await this.extractKeywords(chunk.chunk_text),
      metadata: { title_level: chunk.title_level, has_image: chunk.has_image, has_table: chunk.has_table, chunk_index: chunk.chunk_index },
      dept_id: doc.dept_id,
      visibility: doc.visibility,
    });

    // Neo4j: 实体关系抽取
    await this.neo4j.createChunkRelation(chunk.postgres_doc_id, chunk.chunk_id);
    const entities = await this.extractEntities(chunk.chunk_text);
    for (const entity of entities) {
      await this.neo4j.createEntityRelation(entity.name, entity.type, chunk.chunk_id, chunk.postgres_doc_id);
    }
  }

  private async extractKeywords(text: string): Promise<string[]> {
    const res = await this.llm.invoke(`从以下文本中提取5个关键词，用逗号分隔:\n${text.slice(0, 500)}`);
    return (res.content as string).split(/[,，]/).map(k => k.trim()).filter(Boolean);
  }

  private async extractEntities(text: string): Promise<Array<{name: string; type: string}>> {
    const res = await this.llm.invoke(`从以下文本中提取命名实体(name,type)，type为person/organization/process/document/rule之一。JSON数组格式输出:\n${text.slice(0, 800)}`);
    try {
      return JSON.parse(res.content as string);
    } catch {
      return [];
    }
  }
}
```

- [ ] 实现 `IndexerService`，注册到 `DocumentModule`
- [ ] 文档上传成功后，手动触发 `indexDocument()` 测试三路写入
- [ ] Commit: `feat: three-way indexer (ES + Neo4j + keyword extraction)`

---

### Task 19: PGVector 向量存储

**Files:**
- Create: `apps/server/src/database/postgres/vector.service.ts`

```bash
cd apps/server && pnpm add @langchain/core
```

`apps/server/src/database/postgres/vector.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

@Injectable()
export class VectorService {
  constructor(@InjectEntityManager() private em: EntityManager) {}

  async ensureTable() {
    await this.em.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        postgres_doc_id UUID NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(postgres_doc_id);
    `);
  }

  async insertChunk(chunkId: string, postgresDocId: string, chunkText: string, embedding: number[], metadata: any) {
    await this.em.query(
      `INSERT INTO chunks (chunk_id, postgres_doc_id, chunk_text, embedding, metadata)
       VALUES ($1, $2, $3, $4::vector, $5)
       ON CONFLICT (chunk_id) DO UPDATE SET embedding = $4::vector`,
      [chunkId, postgresDocId, chunkText, `[${embedding.join(',')}]`, JSON.stringify(metadata)],
    );
  }

  async similaritySearch(embedding: number[], topK: number = 10, deptFilter?: { deptIds: string[]; includePublic: boolean }) {
    let query = `
      SELECT c.chunk_id, c.postgres_doc_id, c.chunk_text, c.metadata,
             1 - (c.embedding <=> $1::vector) AS similarity
      FROM chunks c
      JOIN documents d ON c.postgres_doc_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [embedding];

    if (deptFilter) {
      const conditions: string[] = [];
      if (deptFilter.includePublic) {
        conditions.push(`d.visibility = 'public'`);
      }
      if (deptFilter.deptIds.length > 0) {
        params.push(deptFilter.deptIds);
        conditions.push(`d.dept_id = ANY($${params.length}::text[])`);
      }
      query += ` AND (${conditions.join(' OR ')})`;
    }

    query += ` ORDER BY c.embedding <=> $1::vector LIMIT $${params.length + 1}`;
    params.push(topK);

    return this.em.query(query, params);
  }
}
```

- [ ] 实现 `VectorService`，在 `PostgresModule` 中注册
- [ ] 启动时调用 `ensureTable()` 建表和 HNSW 索引
- [ ] 集成到 `IndexerService` 的 `indexChunk()` 中（调用 embedding + insert）
- [ ] Commit: `feat: pgvector chunk embedding and similarity search`

---

### Task 20: 混合检索服务（RRF 融合）

**Files:**
- Create: `apps/server/src/modules/search/search.module.ts`, `search.service.ts`
- Create: `apps/server/src/modules/search/fusion/rrf.ts`

`apps/server/src/modules/search/fusion/rrf.ts`:
```typescript
export interface ScoredResult {
  chunk_id: string;
  postgres_doc_id: string;
  chunk_text: string;
  score: number;
  source: 'pgvector' | 'es' | 'neo4j';
}

export function reciprocalRankFusion(
  resultSets: ScoredResult[][],
  k: number = 60,
): ScoredResult[] {
  const scoreMap = new Map<string, ScoredResult & { rrfScore: number }>();

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const existing = scoreMap.get(r.chunk_id);
      const rrfScore = 1 / (k + rank + 1);
      if (existing) {
        existing.rrfScore += rrfScore;
        existing.score = Math.max(existing.score, r.score);
      } else {
        scoreMap.set(r.chunk_id, { ...r, rrfScore });
      }
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ rrfScore, ...rest }) => ({ ...rest, score: rrfScore }));
}
```

`apps/server/src/modules/search/search.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { VectorService } from '../../database/postgres/vector.service';
import { ElasticsearchService } from '../../database/elasticsearch/es.service';
import { Neo4jService } from '../../database/neo4j/neo4j.service';
import { reciprocalRankFusion, ScoredResult } from './fusion/rrf';

@Injectable()
export class SearchService {
  constructor(
    private vector: VectorService,
    private es: ElasticsearchService,
    private neo4j: Neo4jService,
  ) {}

  async hybridSearch(query: string, queryEmbedding: number[], deptFilter: any, options?: { useES?: boolean; useNeo4j?: boolean }) {
    const { useES = true, useNeo4j = true } = options || {};

    const fetchers: Promise<ScoredResult[]>[] = [
      // PGVector always on
      this.vector.similaritySearch(queryEmbedding, 10, deptFilter).then(rows =>
        rows.map(r => ({ chunk_id: r.chunk_id, postgres_doc_id: r.postgres_doc_id, chunk_text: r.chunk_text, score: r.similarity, source: 'pgvector' as const }))
      ),
    ];

    if (useES) {
      fetchers.push(
        this.es.search(query, deptFilter, 10).then(hits =>
          hits.map(h => ({ chunk_id: h.chunk_id, postgres_doc_id: h.postgres_doc_id, chunk_text: h.chunk_text, score: (h as any).score || 0, source: 'es' as const }))
        ),
      );
    }

    if (useNeo4j) {
      fetchers.push(
        this.neo4j.queryEntities(query, 2).then(rows =>
          rows.map(r => ({ chunk_id: r.chunkId, postgres_doc_id: r.docId, chunk_text: r.chunkText || '', score: 0.5, source: 'neo4j' as const }))
        ),
      );
    }

    const results = await Promise.all(fetchers);
    return reciprocalRankFusion(results);
  }
}
```

- [ ] 实现 RRF 融合算法 + `SearchService.hybridSearch()`
- [ ] 单元测试：验证 RRF 公式对多路结果的融合排序
- [ ] Commit: `feat: hybrid search with reciprocal rank fusion`

---

### Task 21: Reranker 精排

**Files:**
- Create: `apps/server/src/modules/search/fusion/reranker.ts`

```bash
cd apps/server && pnpm add @xenova/transformers
```

```typescript
import { pipeline } from '@xenova/transformers';

let rerankerPipeline: any = null;

async function getReranker() {
  if (!rerankerPipeline) {
    rerankerPipeline = await pipeline('feature-extraction', 'Xenova/bge-reranker-v2-m3');
  }
  return rerankerPipeline;
}

export async function rerank(
  query: string,
  candidates: Array<{ chunk_id: string; postgres_doc_id: string; chunk_text: string; score: number }>,
  topK: number = 5,
) {
  const model = await getReranker();
  const pairs = candidates.map(c => ({
    ...c,
    rerankScore: 0,
  }));

  // Cross-encoder scoring: score(query, chunk_text) for each pair
  for (const pair of pairs) {
    const result = await model(`${query} [SEP] ${pair.chunk_text}`, { pooling: 'mean', normalize: true });
    pair.rerankScore = result.data[0];
  }

  return pairs
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);
}
```

- [ ] 实现 `rerank()` 函数
- [ ] 集成到 `SearchService`：RRF 融合后 → Rerank → 返回 top 5
- [ ] Commit: `feat: cross-encoder reranker with bge-reranker-v2-m3`

---

### Task 22: 检索阈值检查 + 降级逻辑

**Files:**
- Modify: `apps/server/src/modules/search/search.service.ts`

在 `hybridSearch` 返回后添加:
```typescript
async searchWithThreshold(query: string, embedding: number[], deptFilter: any) {
  const fused = await this.hybridSearch(query, embedding, deptFilter);
  const reranked = await rerank(query, fused, 5);

  // 阈值检查
  const MIN_SCORE = 0.5;
  const validResults = reranked.filter(r => r.rerankScore >= MIN_SCORE);

  if (validResults.length === 0) {
    return { hit: false, message: '抱歉，未找到与该问题相关的文档。请尝试更换关键词或联系相关部门获取帮助。', results: [] };
  }

  return { hit: true, results: validResults };
}
```

- [ ] 在 `SearchService` 中添加阈值检查
- [ ] 集成测试：低质量 query 返回降级回答
- [ ] Commit: `feat: retrieval quality threshold and fallback`

---

### Task 23: Redis 会话记忆适配器

**Files:**
- Create: `apps/server/src/modules/memory/adapters/redis.adapter.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis/redis.service';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class RedisMemoryAdapter {
  private readonly MAX_ROUNDS = 8;

  constructor(private redis: RedisService) {}

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    return this.redis.getSessionHistory(sessionId);
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const history = await this.getHistory(sessionId);
    history.push(message);
    // 保持滑动窗口，超过 MAX_ROUNDS*2 条则截断
    const trimmed = history.slice(-this.MAX_ROUNDS * 2);
    await this.redis.setSessionHistory(sessionId, trimmed);
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.redis.client.del(`session:${sessionId}:history`);
  }

  async getCachedSearch(sessionId: string, query: string): Promise<any> {
    const hash = this.simpleHash(query);
    return this.redis.getCachedSearch(`${sessionId}:${hash}`);
  }

  async cacheSearch(sessionId: string, query: string, results: any): Promise<void> {
    const hash = this.simpleHash(query);
    await this.redis.cacheSearchResult(`${sessionId}:${hash}`, results);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }
}
```

- [ ] 实现 `RedisMemoryAdapter`，注册到 `MemoryModule`
- [ ] Commit: `feat: redis session memory adapter with sliding window`

---

### Task 24: Mem0 长期记忆适配器

**Files:**
- Create: `apps/server/src/modules/memory/adapters/mem0.adapter.ts`

```bash
cd apps/server && pnpm add mem0ai
```

```typescript
import { Injectable } from '@nestjs/common';
import Memory from 'mem0ai';

@Injectable()
export class Mem0Adapter {
  private memory: Memory;

  constructor() {
    this.memory = new Memory({
      apiKey: process.env.MEM0_API_KEY,
      // Mem0 默认使用 OpenAI API，这里用 deepseek 替代
      config: {
        openai_api_key: process.env.ALIYUN_API_KEY,
        openai_api_base: process.env.ALIYUN_BASE_URL,
        model: process.env.MODEL_NAME,
      },
    });
  }

  async getUserContext(userId: string): Promise<string> {
    const memories = await this.memory.search({
      user_id: userId,
      limit: 10,
    });
    return memories.map(m => m.memory).join('\n');
  }

  async rememberFact(userId: string, fact: string, source: 'auto' | 'explicit' = 'auto'): Promise<void> {
    await this.memory.add({
      user_id: userId,
      memory: fact,
      metadata: { source, timestamp: new Date().toISOString() },
    });
  }

  async saveSessionSummary(userId: string, sessionId: string, summary: string): Promise<void> {
    await this.memory.add({
      user_id: userId,
      memory: `[会话 ${sessionId}] ${summary}`,
      metadata: { type: 'session_summary', session_id: sessionId, timestamp: new Date().toISOString() },
    });
  }
}
```

- [ ] 实现 `Mem0Adapter`，注册到 `MemoryModule`
- [ ] 测试 `getUserContext()` 和 `rememberFact()` 的写入/检索
- [ ] Commit: `feat: mem0 long-term memory adapter`

---

### Task 25: MemoryService — 统一记忆接口

**Files:**
- Create: `apps/server/src/modules/memory/memory.module.ts`, `memory.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { RedisMemoryAdapter } from './adapters/redis.adapter';
import { Mem0Adapter } from './adapters/mem0.adapter';

@Injectable()
export class MemoryService {
  constructor(
    private redis: RedisMemoryAdapter,
    private mem0: Mem0Adapter,
  ) {}

  async buildPromptContext(sessionId: string, userId: string, query: string) {
    // 并行加载
    const [history, userContext] = await Promise.all([
      this.redis.getHistory(sessionId),
      this.mem0.getUserContext(userId),
    ]);

    // Token 控制：总上下文不超过 6144
    const historyStr = history.map(m => `${m.role}: ${m.content}`).join('\n');
    const systemContext = userContext ? `\n用户背景:\n${userContext}\n` : '';

    return {
      history: historyStr.slice(-4096), // 硬截断
      systemContext: systemContext.slice(-2048),
    };
  }

  async onMessage(sessionId: string, userId: string, role: 'user' | 'assistant', content: string) {
    await this.redis.appendMessage(sessionId, { role, content });
  }

  async onSessionEnd(sessionId: string, userId: string, llm: any) {
    const history = await this.redis.getHistory(sessionId);
    if (history.length === 0) return;

    const summary = await llm.invoke(`总结以下对话的要点（200字以内）:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}`);
    await this.mem0.saveSessionSummary(userId, sessionId, summary.content as string);
    await this.redis.clearHistory(sessionId);
  }
}
```

- [ ] 实现 `MemoryService`，构建统一记忆接口
- [ ] Commit: `feat: unified memory service with token control`

---

### Task 26: LangGraph StateGraph 定义

**Files:**
- Create: `apps/server/src/modules/rag/state.ts`, `graph.ts`
- Create: `apps/server/src/modules/rag/rag.module.ts`

```bash
cd apps/server && pnpm add @langchain/langgraph @langchain/core
```

`apps/server/src/modules/rag/state.ts`:
```typescript
import { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  intent: Annotation<string>({ default: () => '' }),
  userId: Annotation<string>({ default: () => '' }),
  sessionId: Annotation<string>({ default: () => '' }),
  retrievedChunks: Annotation<Array<{ chunk_text: string; score: number }>>({ default: () => [] }),
  finalAnswer: Annotation<string>({ default: () => '' }),
  toolCallsRemaining: Annotation<number>({ default: () => 5 }),
});

export type AgentStateType = typeof AgentState.State;
```

`apps/server/src/modules/rag/graph.ts`:
```typescript
import { StateGraph, END } from '@langchain/langgraph';
import { AgentState } from './state';

export function createRAGGraph(
  classifyIntent: any,
  directAnswer: any,
  simpleRetrieval: any,
  agentReAct: any,
  executeTools: any,
  generateAnswer: any,
  routeByIntent: any,
  decideNext: any,
) {
  return new StateGraph(AgentState)
    .addNode('intent_classifier', classifyIntent)
    .addNode('direct_answer', directAnswer)
    .addNode('simple_retrieval', simpleRetrieval)
    .addNode('agent', agentReAct)
    .addNode('retrieval_tools', executeTools)
    .addNode('generate_answer', generateAnswer)

    .addConditionalEdges('__start__', routeByIntent, {
      chat: 'direct_answer',
      simple: 'simple_retrieval',
      complex: 'agent',
    })

    .addEdge('direct_answer', END)
    .addEdge('simple_retrieval', 'generate_answer')

    .addConditionalEdges('agent', decideNext, {
      tools: 'retrieval_tools',
      answer: 'generate_answer',
    })
    .addEdge('retrieval_tools', 'agent')
    .addEdge('generate_answer', END)

    .compile();
}
```

- [ ] 创建 `AgentState` 类型定义和 `createRAGGraph()` 工厂函数
- [ ] Commit: `feat: langgraph state and graph factory`

---

### Task 27: 意图分类节点

**Files:**
- Create: `apps/server/src/modules/rag/nodes/intent.ts`

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

const INTENT_PROMPT = `你是企业知识库助手的意图分类器。分析用户问题，归类为以下之一：

- chat: 问候、闲聊、无关话题
- simple: 简单事实查询，单一知识点即可回答（如"年假有几天？""公司地址在哪？"）
- complex: 需要综合多份文档、多步推理、或涉及流程/规范的问题（如"报销完整流程是怎样的？""跨部门协作需要哪些审批？"）

只回复一个词：chat / simple / complex`;

export function createIntentClassifier(llm: ChatOpenAI) {
  return async function classifyIntent(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);

    // 检测"记住xxx"模式 → 走 memory write 路径
    if (/^(记住|请记住|帮我记住)/.test(content)) {
      return { intent: 'chat' };
    }

    const response = await llm.invoke([
      new SystemMessage(INTENT_PROMPT),
      new HumanMessage(content),
    ]);

    const intent = (response.content as string).trim().toLowerCase();
    return { intent: ['chat', 'simple', 'complex'].includes(intent) ? intent : 'simple' };
  };
}
```

- [ ] 实现 `createIntentClassifier`
- [ ] Commit: `feat: intent classifier node`

---

### Task 28: Agent ReAct 节点 + 工具注册

**Files:**
- Create: `apps/server/src/modules/rag/nodes/agent.ts`
- Create: `apps/server/src/modules/rag/tools/vector-search.tool.ts`
- Create: `apps/server/src/modules/rag/tools/es-search.tool.ts`
- Create: `apps/server/src/modules/rag/tools/neo4j-query.tool.ts`

`apps/server/src/modules/rag/tools/vector-search.tool.ts`:
```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createVectorSearchTool(searchFn: (query: string) => Promise<string>) {
  return tool(
    async ({ query }) => {
      const results = await searchFn(query);
      return results;
    },
    {
      name: 'vector_search',
      description: '搜索文档库中与查询语义相似的文本片段。适合概念性问题、描述性问题。',
      schema: z.object({ query: z.string().describe('搜索查询文本') }),
    },
  );
}
```

`apps/server/src/modules/rag/tools/es-search.tool.ts`:
```typescript
export function createESSearchTool(searchFn: (query: string) => Promise<string>) {
  return tool(
    async ({ query }) => {
      const results = await searchFn(query);
      return results;
    },
    {
      name: 'keyword_search',
      description: '按关键字全文搜索文档，基于 BM25 倒排索引。适合查找特定名词、编号、流程名。',
      schema: z.object({ query: z.string().describe('关键字搜索查询') }),
    },
  );
}
```

`apps/server/src/modules/rag/tools/neo4j-query.tool.ts`:
```typescript
export function createNeo4jQueryTool(queryFn: (entityQuery: string) => Promise<string>) {
  return tool(
    async ({ entity }) => {
      const results = await queryFn(entity);
      return results;
    },
    {
      name: 'knowledge_graph_query',
      description: '查询企业知识图谱，获取实体间的关联关系。适合"xxx和xxx的关系"、"xxx属于哪个部门"等问题。',
      schema: z.object({ entity: z.string().describe('要查询的实体名称') }),
    },
  );
}
```

`apps/server/src/modules/rag/nodes/agent.ts`:
```typescript
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

const AGENT_SYSTEM_PROMPT = `你是企业知识库智能助手。你可以使用以下工具来查找信息：

1. vector_search - 语义搜索文档内容
2. keyword_search - 关键字全文搜索
3. knowledge_graph_query - 查询知识图谱中的实体关系

工作规则：
- 先理解用户问题，选择合适的工具
- 如果第一次检索结果不充分，尝试换关键词或用不同工具
- 信息充分后，基于检索结果生成准确回答
- 用户明确说"记住xxx"时，直接确认已记住`;

export function createAgentNode(llm: ChatOpenAI, tools: any[]) {
  const llmWithTools = llm.bindTools(tools);

  return async function agentReAct(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const messages = [
      new SystemMessage(AGENT_SYSTEM_PROMPT),
      ...state.messages,
    ];

    const response = await llmWithTools.invoke(messages);
    return { messages: [response] };
  };
}
```

- [ ] 实现三个检索工具 + Agent ReAct 节点
- [ ] 确保工具 schema 使用 zod 定义
- [ ] Commit: `feat: agent react node and three retrieval tools`

---

### Task 29: 检索执行节点

**Files:**
- Create: `apps/server/src/modules/rag/nodes/retrieval.ts`

```typescript
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

export function createRetrievalNode(
  vectorSearchFn: (q: string) => Promise<string>,
  esSearchFn: (q: string) => Promise<string>,
  neo4jQueryFn: (q: string) => Promise<string>,
) {
  const toolMap: Record<string, (q: string) => Promise<string>> = {
    vector_search: vectorSearchFn,
    keyword_search: esSearchFn,
    knowledge_graph_query: neo4jQueryFn,
  };

  return async function executeRetrievalTools(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolMessages: ToolMessage[] = [];

    if (lastMessage.tool_calls) {
      for (const call of lastMessage.tool_calls) {
        const fn = toolMap[call.name];
        if (fn) {
          const args = call.args as { query?: string; entity?: string };
          const queryStr = args.query || args.entity || '';
          const result = await fn(queryStr);
          toolMessages.push(new ToolMessage({ content: result, tool_call_id: call.id! }));
        }
      }
    }

    return {
      messages: toolMessages,
      toolCallsRemaining: state.toolCallsRemaining - 1,
    };
  };
}
```

- [ ] 实现 `createRetrievalNode`，根据 tool_calls 分发并行执行
- [ ] Commit: `feat: retrieval execution node with tool dispatch`

---

### Task 30: 答案生成节点 + 路由函数

**Files:**
- Create: `apps/server/src/modules/rag/nodes/generate.ts`
- Create: `apps/server/src/modules/rag/nodes/routes.ts`

`apps/server/src/modules/rag/nodes/generate.ts`:
```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { AgentStateType } from '../state';

const ANSWER_PROMPT = `基于以下检索到的企业知识库内容回答用户问题。如果知识库内容不足以回答，请诚实说明。

要求：
- 回答准确、简洁，引用文档来源
- 涉及流程的用步骤式说明
- 用户明确记忆的信息优先使用`;

export function createGenerateNode(llm: ChatOpenAI, getUserContext: (uid: string) => Promise<string>) {
  return async function generateAnswer(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const userContext = await getUserContext(state.userId);

    const context = [
      userContext ? `## 用户记忆\n${userContext}` : '',
      state.retrievedChunks.length > 0 ? `## 检索结果\n${state.retrievedChunks.map((c, i) => `[${i+1}] ${c.chunk_text}`).join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const messages = [
      new SystemMessage(`${ANSWER_PROMPT}\n\n${context}`),
      state.messages.filter(m => m.getType() === 'human').slice(-3)[0], // 最近一条用户消息
    ];

    const response = await llm.invoke(messages);
    return { finalAnswer: response.content as string, messages: [response] };
  };
}
```

`apps/server/src/modules/rag/nodes/routes.ts`:
```typescript
import { AIMessage } from '@langchain/core/messages';
import { AgentStateType } from '../state';

export function routeByIntent(state: AgentStateType): string {
  return state.intent || 'simple';
}

export function decideNext(state: AgentStateType): string {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0 && state.toolCallsRemaining > 0) {
    return 'tools';
  }
  return 'answer';
}
```

- [ ] 实现 `createGenerateNode` 和两个路由函数
- [ ] Commit: `feat: answer generation node and route functions`

---

### Task 31: RAG Service — 组装完整工作流

**Files:**
- Create: `apps/server/src/modules/rag/rag.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { createRAGGraph } from './graph';
import { createIntentClassifier } from './nodes/intent';
import { createAgentNode } from './nodes/agent';
import { createRetrievalNode } from './nodes/retrieval';
import { createGenerateNode } from './nodes/generate';
import { routeByIntent, decideNext } from './nodes/routes';
import { createVectorSearchTool, createESSearchTool, createNeo4jQueryTool } from './tools';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class RAGService {
  private graph: any;
  private llm: ChatOpenAI;

  constructor(
    private config: ConfigService,
    private search: SearchService,
    private memory: MemoryService,
  ) {
    this.llm = new ChatOpenAI({
      model: config.get('MODEL_NAME'),
      apiKey: config.get('ALIYUN_API_KEY'),
      configuration: { baseURL: config.get('ALIYUN_BASE_URL') },
    });
  }

  async initialize() {
    // 创建工具（检索函数闭包）
    const vectorTool = createVectorSearchTool(async (q) => {
      const results = await this.search.hybridSearch(q, await this.getEmbedding(q), { deptFilter: {} }, { useES: false, useNeo4j: false });
      return JSON.stringify(results.slice(0, 5));
    });

    const esTool = createESSearchTool(async (q) => {
      const results = await this.search.hybridSearch(q, [0], { deptFilter: {} }, { useES: true, useNeo4j: false });
      return JSON.stringify(results.slice(0, 5));
    });

    const neo4jTool = createNeo4jQueryTool(async (entity) => {
      const results = await this.search.hybridSearch(entity, [0], { deptFilter: {} }, { useES: false, useNeo4j: true });
      return JSON.stringify(results.slice(0, 5));
    });

    const tools = [vectorTool, esTool, neo4jTool];

    this.graph = createRAGGraph(
      createIntentClassifier(this.llm),
      async (state) => ({ finalAnswer: (await this.llm.invoke(state.messages)).content, messages: [] }),
      createRetrievalNode(
        async (q) => JSON.stringify((await this.search.hybridSearch(q, await this.getEmbedding(q), {}, { useES: false, useNeo4j: false })).slice(0, 3)),
        async (q) => JSON.stringify(await this.search.hybridSearch(q, [0], {}, { useES: true, useNeo4j: false }).then(r => r.slice(0, 3))),
        async (q) => JSON.stringify(await this.search.hybridSearch(q, [0], {}, { useES: false, useNeo4j: true }).then(r => r.slice(0, 3))),
      ),
      createAgentNode(this.llm, tools),
      async (state) => ({...state}), // 简化：检索节点直接处理
      createGenerateNode(this.llm, (uid) => this.memory.buildPromptContext('', uid, '').then(c => c.systemContext)),
      routeByIntent,
      decideNext,
    );
  }

  async query(userMessage: string, userId: string, sessionId: string) {
    if (!this.graph) await this.initialize();
    const result = await this.graph.invoke({
      messages: [new HumanMessage(userMessage)],
      userId,
      sessionId,
    });
    return result.finalAnswer;
  }

  async streamQuery(userMessage: string, userId: string, sessionId: string) {
    if (!this.graph) await this.initialize();
    return this.graph.streamEvents(
      { messages: [new HumanMessage(userMessage)], userId, sessionId },
      { version: 'v2' },
    );
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const res = await this.llm.embeddings.embedQuery(text);
    return res;
  }
}
```

- [ ] 实现 `RAGService`，组装完整 LangGraph 工作流
- [ ] 集成测试：输入测试问题，验证意图分类 → 检索 → Agent → 生成 全链路
- [ ] Commit: `feat: rag service with complete langgraph workflow`

---

### Task 32: SSE 流式聊天控制器

**Files:**
- Create: `apps/server/src/modules/chat/chat.module.ts`, `chat.controller.ts`, `chat.service.ts`
- Create: `apps/server/src/modules/chat/dto/chat.dto.ts`

`apps/server/src/modules/chat/chat.controller.ts`:
```typescript
import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('stream')
  async streamChat(@Body() dto: ChatDto, @CurrentUser() user: any, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await this.chatService.streamAnswer(dto.message, user.id, dto.sessionId);
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.end();
  }
}
```

`apps/server/src/modules/chat/chat.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { RAGService } from '../rag/rag.service';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class ChatService {
  constructor(
    private rag: RAGService,
    private memory: MemoryService,
  ) {}

  async *streamAnswer(message: string, userId: string, sessionId: string) {
    // 检测"记住xxx"模式
    if (/^(记住|请记住|帮我记住)/.test(message)) {
      const fact = message.replace(/^(记住|请记住|帮我记住)[，,：:\s]*/, '');
      await this.memory.mem0.rememberFact(userId, fact, 'explicit');
      yield { type: 'text', content: `已记住：${fact}` };
      return;
    }

    // 保存用户消息到记忆
    await this.memory.onMessage(sessionId, userId, 'user', message);

    // 流式调用 RAG
    const stream = await this.rag.streamQuery(message, userId, sessionId);

    let fullAnswer = '';
    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        fullAnswer += token;
        yield { type: 'text', content: token };
      }
    }

    // 保存助手回复到记忆
    await this.memory.onMessage(sessionId, userId, 'assistant', fullAnswer);
  }
}
```

- [ ] 实现 `ChatController` + `ChatService`，SSE 流式问答
- [ ] 测试：curl POST /chat/stream 验证 SSE 推送
- [ ] Commit: `feat: sse streaming chat endpoint`

---

### Task 33: WebSocket 语音网关

**Files:**
- Create: `apps/server/src/modules/chat/voice.gateway.ts`

```bash
cd apps/server && pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

```typescript
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from './ws-jwt.guard';

@WebSocketGateway({ namespace: '/voice', cors: { origin: '*' } })
@UseGuards(WsJwtGuard)
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  handleConnection(client: Socket) { /* 认证已在 Guard 中处理 */ }
  handleDisconnect(client: Socket) { /* 清理会话资源 */ }

  @SubscribeMessage('audio_stream')
  async handleAudioStream(@ConnectedSocket() client: Socket, @MessageBody() data: { audio: ArrayBuffer; sessionId: string }) {
    // 1. ASR 转文字 → 2. ChatService 流式回答 → 3. TTS 转语音 → 4. 推回客户端
    // MVP 阶段可暂不做全双工，只做"音频上→文字下"的简化版
  }
}
```

- [ ] 创建 `VoiceGateway` + `WsJwtGuard`
- [ ] MVP 阶段：搭建 WebSocket 框架，语音流处理可在后续完善
- [ ] Commit: `feat: websocket voice gateway scaffold`

---

### Task 34: 会话结束 Hook

**Files:**
- Modify: `apps/server/src/modules/chat/chat.controller.ts`

在 chat controller 中添加会话结束端点:
```typescript
@Post('session/end')
async endSession(@Body() dto: { sessionId: string }, @CurrentUser() user: any) {
  await this.memory.onSessionEnd(dto.sessionId, user.id, this.llm);
  return { success: true };
}
```

- [ ] 添加 `POST /chat/session/end` 端点
- [ ] 测试：对话后调用 end → 验证 Mem0 中有会话摘要
- [ ] Commit: `feat: session end hook with mem0 summary generation`

---

### Task 35: 前端登录 + 权限路由

**Files:**
- Create: `apps/web/src/pages/login/LoginPage.tsx`
- Create: `apps/web/src/stores/auth.store.ts`
- Create: `apps/web/src/services/api.ts`

`apps/web/src/services/api.ts`:
```typescript
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;
```

`apps/web/src/stores/auth.store.ts`:
```typescript
import { create } from 'zustand';
import api from '../services/api';

interface AuthState {
  user: { id: string; username: string; real_name: string; roles: string[]; dept_id: string } | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  login: async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    set({ user: null });
    window.location.href = '/login';
  },
  isAuthenticated: () => !!localStorage.getItem('access_token'),
}));
```

`LoginPage.tsx`: 登录表单组件（username + password → login() → 跳转首页）

- [ ] 实现 `api.ts`, `auth.store.ts`, `LoginPage.tsx`
- [ ] 实现受保护路由 `ProtectedRoute` 组件
- [ ] 配置 React Router：`/login` → LoginPage，`/` → 受保护首页
- [ ] Commit: `feat: frontend login and auth routing`

---

### Task 36: 前端布局 + 导航

**Files:**
- Create: `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/components/Sidebar.tsx`

```
┌──────────────────────────────────────┐
│  Header (用户信息 + 退出)             │
├────────┬─────────────────────────────┤
│ Sidebar│                             │
│ 📁知识库│        主内容区              │
│ 💬AI问答│                             │
│ 📄文档管│                             │
│ 📊统计  │                             │
└────────┴─────────────────────────────┘
```

- [ ] 实现 `Layout.tsx`（Header + Sidebar + Outlet）
- [ ] Sidebar 含四个导航项（知识库/AI问答/文档管理/统计），MVP 统计可显示"开发中"
- [ ] Commit: `feat: frontend layout with navigation sidebar`

---

### Task 37: 文档上传页面

**Files:**
- Create: `apps/web/src/pages/document/DocumentUploadPage.tsx`
- Create: `apps/web/src/components/document/FileUploader.tsx`

核心功能:
- 拖拽/点击上传文件
- 显示上传进度
- 支持多文件
- 上传成功显示文档 ID 和状态
- 上传失败显示错误信息

```typescript
const handleUpload = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => setProgress(Math.round((e.loaded * 100) / (e.total || 1))),
  });
  return data;
};
```

- [ ] 实现文档上传页面（拖拽上传 + 进度条 + 结果展示）
- [ ] Commit: `feat: document upload page`

---

### Task 38: 知识库浏览页面

**Files:**
- Create: `apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx`
- Create: `apps/web/src/components/knowledge/DocumentList.tsx`

核心功能:
- 已上传文档列表（表格形式）
- 列：文档名、类型、大小、状态、上传时间
- 状态标签：解析中 / 已就绪 / 失败
- 搜索+过滤

```typescript
const { data } = await api.get('/documents', { params: { page, pageSize, status } });
```

- [ ] 实现知识库文档列表页面
- [ ] Commit: `feat: knowledge base document list page`

---

### Task 39: AI 问答页面（核心）

**Files:**
- Create: `apps/web/src/pages/chat/ChatPage.tsx`
- Create: `apps/web/src/components/chat/ChatMessages.tsx`, `ChatInput.tsx`
- Create: `apps/web/src/hooks/useSSE.ts`

`apps/web/src/hooks/useSSE.ts`:
```typescript
import { useCallback } from 'react';

export function useSSE() {
  const sendMessage = useCallback(async (message: string, sessionId: string, onToken: (token: string) => void, onDone: () => void) => {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      body: JSON.stringify({ message, sessionId }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) { onDone(); break; }

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'text') onToken(data.content);
      }
    }
  }, []);

  return { sendMessage };
}
```

`ChatPage.tsx`:
```tsx
export default function ChatPage() {
  const [messages, setMessages] = useState<Array<{role: string; content: string}>>([]);
  const [streaming, setStreaming] = useState('');
  const { sendMessage } = useSSE();
  const sessionId = useRef(uuid()).current;

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setStreaming('');
    await sendMessage(text, sessionId,
      (token) => setStreaming(prev => prev + token),
      () => {
        setStreaming(prev => {
          setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
          return '';
        });
      },
    );
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)}
        {streaming && <ChatBubble role="assistant" content={streaming} isStreaming />}
      </div>
      <ChatInput onSend={handleSend} disabled={!!streaming} />
    </div>
  );
}
```

- [ ] 实现 `useSSE` hook + `ChatPage` + 消息气泡组件
- [ ] 测试流式回答逐字显示效果
- [ ] Commit: `feat: ai chat page with sse streaming`

---

### Task 40: 文档管理页面（增删查）

**Files:**
- Create: `apps/web/src/pages/document/DocumentManagePage.tsx`

核心功能:
- 查看已上传文档详情（Markdown 预览）
- 删除文档（软删除 → 更新 Postgres status）
- 重新索引（status=failed 的文档重试）

- [ ] 实现文档管理页面（预览/删除/重试）
- [ ] Commit: `feat: document management page`

---

### Task 41: LangFuse 全链路监控

**Files:**
- Create: `apps/server/src/common/observability/langfuse.service.ts`

```bash
cd apps/server && pnpm add langfuse
```

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import Langfuse from 'langfuse';

@Injectable()
export class LangfuseService implements OnModuleInit {
  private langfuse: Langfuse;

  onModuleInit() {
    this.langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      host: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });
  }

  createTrace(name: string, userId: string, sessionId: string) {
    return this.langfuse.trace({ name, userId, sessionId });
  }

  logGeneration(trace: any, model: string, input: string, output: string, tokens: number, latency: number) {
    trace.generation({
      name: 'llm_call',
      model,
      input,
      output,
      usage: { totalTokens: tokens },
      metadata: { latencyMs: latency },
    });
  }

  async flush() { await this.langfuse.flushAsync(); }
}
```

- [ ] 实现 `LangfuseService`
- [ ] 在 `ChatService.streamAnswer()` 中包裹 LangFuse trace
- [ ] 验证 LangFuse Dashboard 可见调用链
- [ ] Commit: `feat: langfuse observability integration`

---

### Task 42: 完整流程集成测试

**Files:**
- Create: `apps/server/src/test/integration.test.ts`

测试场景:
1. 注册 → 登录 → 获取 JWT
2. 上传 PDF 文档 → 验证 status=PARSED
3. 触发索引 → 验证 status=INDEXED
4. 提问问题 → 验证 SSE 流式返回非空答案
5. 会话结束 → 验证 Mem0 有摘要
6. 权限测试：普通用户不能访问其他部门文档

```bash
cd apps/server && pnpm add -D @nestjs/testing jest @types/jest ts-jest
```

- [ ] 编写 6 个集成测试场景
- [ ] 运行 `pnpm test` 全部通过
- [ ] Commit: `feat: integration tests for full rag pipeline`

---

### Task 43: README + setup.sh

**Files:**
- Create: `README.md`
- Create: `scripts/setup.sh`

`README.md` 包含:
- 项目简介
- 架构图（ASCII）
- 快速启动步骤（3 步）
- 端口一览表
- 环境变量说明

`scripts/setup.sh`:
```bash
#!/bin/bash
echo "=== 企业知识库 RAG 平台 - 一键初始化 ==="
# 1. 检查 Docker
# 2. 启动基础服务
docker compose up -d
# 3. 等待服务就绪
sleep 10
# 4. 安装依赖
pnpm install
# 5. 初始化数据库
cd apps/server && pnpm run seed
echo "=== 初始化完成 ==="
echo "后端: http://localhost:3001"
echo "前端: http://localhost:3000"
```

- [ ] 编写 `README.md` 和 `scripts/setup.sh`
- [ ] Commit: `docs: readme and one-click setup script`

---

## 实施顺序依赖

```
Task 1 ──→ Task 2 ──→ Task 3
              │
         ┌────┴────────────┐
         ▼    ▼    ▼    ▼  ▼
        T4   T5   T6  T7  T8   (数据库连接，可并行)
         │    │    │   │   │
         └────┴────┴───┴───┘
              │
         ┌────▼────┐
         T9 → T10 → T11  (认证授权)
              │
         ┌────▼────────────────┐
         T12 → T13 → T14 → T15 → T16  (文档解析器)
              │
         ┌────▼────┐
         T17 → T18 → T19  (分块+索引+向量)
              │
         ┌────▼──────────┐
         T20 → T21 → T22  (混合检索+RRF+Rerank)
              │
         ┌────▼────┐
         T23 → T24 → T25  (分层记忆)
              │
         ┌────▼────────────────────────┐
         T26 → T27 → T28 → T29 → T30 → T31  (LangGraph RAG 引擎)
              │
         ┌────▼────┐
         T32 → T33 → T34  (SSE+WS+会话Hook)
              │
         ┌────▼────────────────────┐
         T35 → T36 → T37 → T38 → T39 → T40  (前端页面)
              │
         ┌────▼────┐
         T41 → T42 → T43  (监控+测试+收尾)
```
