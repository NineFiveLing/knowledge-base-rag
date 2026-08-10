# RAG 聊天修复 + 对话历史功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 3 个 bug（中文文件名乱码、AI 回答重复、前端 loading）并实现对话历史存储与展示功能。

**Architecture:** 服务层修正文件名编码，generate_answer 节点两轮去重，ChatPage 替换空状态；新建 conversations/messages 表 + 5 个 REST API + 左侧对话列表组件。

**Tech Stack:** NestJS + TypeORM (Postgres) + React + Ant Design + SSE 流式

## Global Constraints

- 所有 API 端点受 `JwtAuthGuard` 保护
- 对话仅当前用户可访问（`conversations.user_id` 过滤）
- 现有 Redis 短期记忆机制保持不变
- TypeORM `autoLoadEntities: true` 已开启，新实体需在 module 中 `forFeature()`
- 中文文件名修复需兼容已存储的乱码数据（仅新上传文件）

---

## File Structure

```
Bug 修复:
  apps/server/src/modules/document/document.service.ts   — + fixEncoding()，替换 file.originalname
  apps/server/src/modules/rag/nodes/generate.ts          — + dedupChunks()
  apps/web/src/pages/chat/ChatPage.tsx                   — Spin → 空状态
  apps/web/src/styles/global.css                         — + .chat-empty-hint

对话历史:
  apps/server/src/modules/chat/entities/conversation.entity.ts   — 新建
  apps/server/src/modules/chat/entities/message.entity.ts        — 新建
  apps/server/src/modules/chat/dto/create-conversation.dto.ts    — 新建
  apps/server/src/modules/chat/dto/update-conversation.dto.ts    — 新建
  apps/server/src/modules/chat/chat.module.ts            — 注册 entity + DTO
  apps/server/src/modules/chat/chat.service.ts           — + CRUD 方法 + conversationId
  apps/server/src/modules/chat/chat.controller.ts        — + 5 端点
  apps/web/src/components/chat/ConversationList.tsx       — 新建
  apps/web/src/pages/chat/ChatPage.tsx                   — 改造集成
  apps/web/src/styles/global.css                         — + 对话布局样式
```

---

## Bug 修复

### Task 1: 修复中文文件名乱码

**Files:**
- Modify: `apps/server/src/modules/document/document.service.ts`

**Interfaces:**
- Produces: `fixEncoding(name: string): string` — 检测并修正 Latin-1 误读的 UTF-8 文件名

- [ ] **Step 1: 在 `document.service.ts` 顶部添加 `fixEncoding` 函数**

在 `DocumentService` 类定义之前，添加：

```typescript
/** 修正 Multer/busboy 将 UTF-8 文件名字节按 Latin-1 误读的编码问题 */
function fixEncoding(name: string): string {
  try {
    const buf = Buffer.from(name, 'latin1');
    const utf8 = buf.toString('utf8');
    // 如果还原后包含有效中文字符或日文/韩文，说明是误编码
    if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(utf8)) return utf8;
  } catch {}
  return name;
}
```

- [ ] **Step 2: 在 `uploadStage1()` 入口处应用修正**

修改第 57 行附近，在函数体第一行（`const uploadedUrls` 之前）添加：

```typescript
file.originalname = fixEncoding(file.originalname);
```

- [ ] **Step 3: 在 `replaceFile()` 入口处应用修正**

找到 `replaceFile()` 方法（约第 310 行），在函数体第一行添加同样的：

```typescript
file.originalname = fixEncoding(file.originalname);
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

预期：无 TS 编译错误。

- [ ] **Step 5: 手工验证**

用 curl 上传带中文名的文件，检查数据库中 `name` 是否正确存储：

```bash
curl -X POST http://localhost:3001/api/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@员工手册.pdf;filename=员工手册.pdf" \
  -F "dept_id=test-dept"
# 然后 GET /api/documents 检查返回的 name 字段
```

---

### Task 2: 修复 AI 回答重复 — 检索结果去重

**Files:**
- Modify: `apps/server/src/modules/rag/nodes/generate.ts`

**Interfaces:**
- Produces: `dedupChunks(chunks: RetrievedChunk[]): RetrievedChunk[]` — 两轮去重（chunk_id 精确 + bigram 模糊）

- [ ] **Step 1: 在 `generate.ts` 中添加 bigram Jaccard 去重函数**

在 `ANSWER_PROMPT` 常量之后、`createGenerateNode` 函数之前添加：

```typescript
/** 文本双字符 bigram（兼容中文） */
function bigrams(text: string): Set<string> {
  const bgs = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) bgs.add(text.slice(i, i + 2));
  return bgs;
}

/** 基于 character-level bigram 的 Jaccard 相似度 */
function bigramJaccard(a: string, b: string): number {
  if (a === b) return 1;
  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / Math.max(union.size, 1);
}

/** 对检索结果去重：第一轮 chunk_id 精确去重，第二轮内容 bigram 模糊去重 */
function dedupChunks(
  chunks: Array<{ chunk_text: string; score: number; chunk_id?: string; postgres_doc_id?: string }>,
) {
  // 第一轮：按 chunk_id 精确去重，保留 score 最高的
  const byId = new Map<string, (typeof chunks)[number]>();
  for (const c of chunks) {
    const key = c.chunk_id || c.chunk_text;
    const existing = byId.get(key);
    if (!existing || c.score > existing.score) byId.set(key, c);
  }

  // 第二轮：按 bigram Jaccard 模糊去重（阈值 0.85）
  const seen: (typeof chunks)[number][] = [];
  for (const c of byId.values()) {
    const isDup = seen.some((s) => bigramJaccard(s.chunk_text, c.chunk_text) >= 0.85);
    if (!isDup) seen.push(c);
  }
  return seen;
}
```

- [ ] **Step 2: 在 `generateAnswer` 函数中应用去重**

修改 `generateAnswer` 函数（约第 14 行），在第 28 行 `const contextParts` 之前，对 `state.retrievedChunks` 去重：

```typescript
// 在 const ctx = await memory.buildPromptContext(...) 之前添加：
const deduped = dedupChunks(state.retrievedChunks);
```

然后将第 28-29 行中的 `state.retrievedChunks` 替换为 `deduped`：

```typescript
// 修改前
if (state.retrievedChunks.length > 0) {
  contextParts.push(`## 检索结果\n${state.retrievedChunks.map(...

// 修改后
if (deduped.length > 0) {
  contextParts.push(`## 检索结果\n${deduped.map(...
```

- [ ] **Step 3: sources 也使用去重后的 chunks**

将第 49-53 行构建 sources 的代码也改为使用 `deduped`：

```typescript
const sources = deduped.map((c, i) => ({
  index: i + 1,
  docId: c.postgres_doc_id || '',
  chunkId: c.chunk_id || '',
}));
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 运行检索测试验证**

```bash
ADMIN_TOKEN="<token>" npx tsx scripts/test/test-retrieval.ts
```

---

### Task 3: 修复前端持续 loading

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: 替换 Spin 为空状态引导提示**

修改 [ChatPage.tsx:59](apps/web/src/pages/chat/ChatPage.tsx#L59)，将：

```tsx
{!streaming && messages.length === 0 && <Spin style={{ display: 'block', margin: '12px 0' }} />}
```

替换为：

```tsx
{!streaming && messages.length === 0 && (
  <div className="chat-empty-hint">
    <div className="chat-empty-icon">💬</div>
    <h3>AI 知识库问答</h3>
    <p>输入您的问题，我将从知识库中检索答案</p>
  </div>
)}
```

- [ ] **Step 2: 移除未使用的 Spin import**

修改 [ChatPage.tsx:2](apps/web/src/pages/chat/ChatPage.tsx#L2)，从 antd import 中移除 `Spin`：

```tsx
// 修改前
import { Input, Button, Tag, Spin } from 'antd';
// 修改后
import { Input, Button, Tag } from 'antd';
```

- [ ] **Step 3: 添加空状态样式**

在 [global.css](apps/web/src/styles/global.css) 末尾添加：

```css
.chat-empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  text-align: center;
  padding: 48px 24px;
}
.chat-empty-hint .chat-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.chat-empty-hint h3 {
  font-size: 18px;
  color: #666;
  margin: 0 0 8px 0;
}
.chat-empty-hint p {
  font-size: 14px;
  color: #999;
  margin: 0;
}
```

- [ ] **Step 4: 前端编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

---

## 对话历史功能

### Task 4: 创建数据库实体

**Files:**
- Create: `apps/server/src/modules/chat/entities/conversation.entity.ts`
- Create: `apps/server/src/modules/chat/entities/message.entity.ts`

**Interfaces:**
- Produces: `Conversation` entity — `id`, `user_id`, `title`, `created_at`, `updated_at`
- Produces: `Message` entity — `id`, `conversation_id`, `role`, `content`, `sources`, `created_at`

- [ ] **Step 1: 创建 Conversation 实体**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ default: '新对话' })
  title!: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @OneToMany(() => Message, (m) => m.conversation)
  messages!: Message[];
}
```

- [ ] **Step 2: 创建 Message 实体**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  conversation_id!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  sources?: Array<{ index: number; docId: string; chunkId: string }>;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;
}
```

- [ ] **Step 3: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 5: 后端 — 对话 CRUD API

**Files:**
- Create: `apps/server/src/modules/chat/dto/create-conversation.dto.ts`
- Create: `apps/server/src/modules/chat/dto/update-conversation.dto.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/server/src/modules/chat/chat.controller.ts`
- Modify: `apps/server/src/modules/chat/chat.module.ts`

**Interfaces:**
- Consumes: `Conversation`, `Message` entities (Task 4)
- Produces: `ChatService.createConversation()`, `listConversations()`, `getMessages()`, `deleteConversation()`, `updateConversation()`
- Produces: Controller endpoints — `GET/POST /chat/conversations`, `GET /chat/conversations/:id/messages`, `DELETE /chat/conversations/:id`, `PATCH /chat/conversations/:id`

- [ ] **Step 1: 创建 DTO 文件**

`create-conversation.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
```

`update-conversation.dto.ts`:

```typescript
import { IsString, MaxLength } from 'class-validator';

export class UpdateConversationDto {
  @IsString()
  @MaxLength(255)
  title!: string;
}
```

- [ ] **Step 2: 修改 ChatModule — 注册实体**

在 [chat.module.ts](apps/server/src/modules/chat/chat.module.ts#L1-L17) 中添加 TypeOrmModule：

```typescript
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

// imports 数组中添加：
TypeOrmModule.forFeature([Conversation, Message]),
```

- [ ] **Step 3: 修改 ChatService — 添加 CRUD 方法**

在 `ChatService` 类中添加（注入 `@InjectRepository`）：

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

// constructor 中添加：
@InjectRepository(Conversation) private convRepo: Repository<Conversation>,
@InjectRepository(Message) private msgRepo: Repository<Message>,

/** 新建对话 */
async createConversation(userId: string, title?: string) {
  const conv = this.convRepo.create({ user_id: userId, title: title || '新对话' });
  return this.convRepo.save(conv);
}

/** 当前用户的对话列表 */
async listConversations(userId: string, page = 1, pageSize = 20) {
  const [items, total] = await this.convRepo.findAndCount({
    where: { user_id: userId },
    order: { updated_at: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { items, total, page, pageSize };
}

/** 获取对话消息列表 */
async getMessages(conversationId: string, userId: string) {
  const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
  if (!conv) throw new Error('对话不存在');
  const messages = await this.msgRepo.find({
    where: { conversation_id: conversationId },
    order: { created_at: 'ASC' },
  });
  return { conversation: conv, messages };
}

/** 删除对话 */
async deleteConversation(conversationId: string, userId: string) {
  const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
  if (!conv) throw new Error('对话不存在');
  await this.convRepo.remove(conv);
  return { success: true };
}

/** 编辑对话标题 */
async updateConversation(conversationId: string, userId: string, title: string) {
  const conv = await this.convRepo.findOne({ where: { id: conversationId, user_id: userId } });
  if (!conv) throw new Error('对话不存在');
  conv.title = title;
  return this.convRepo.save(conv);
}

/** 持久化一条消息 */
async saveMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string, sources?: Array<{ index: number; docId: string; chunkId: string }>) {
  const msg = this.msgRepo.create({ conversation_id: conversationId, role, content, sources });
  // 更新对话的 updated_at
  await this.convRepo.update(conversationId, { updated_at: new Date() });
  return this.msgRepo.save(msg);
}
```

- [ ] **Step 4: 修改 ChatController — 添加端点**

```typescript
import { NotFoundException } from '@nestjs/common';

/** 对话列表 */
@Get('conversations')
@UseGuards(JwtAuthGuard)
async listConversations(
  @CurrentUser() user: { id: string },
  @Query('page') page?: number,
  @Query('pageSize') pageSize?: number,
) {
  return this.chatService.listConversations(user.id, page || 1, pageSize || 20);
}

/** 新建对话 */
@Post('conversations')
@UseGuards(JwtAuthGuard)
async createConversation(
  @CurrentUser() user: { id: string },
  @Body() dto: CreateConversationDto,
) {
  return this.chatService.createConversation(user.id, dto.title);
}

/** 对话消息列表 */
@Get('conversations/:id/messages')
@UseGuards(JwtAuthGuard)
async getMessages(
  @Param('id') id: string,
  @CurrentUser() user: { id: string },
) {
  try {
    return await this.chatService.getMessages(id, user.id);
  } catch (err) {
    throw new NotFoundException((err as Error).message);
  }
}

/** 删除对话 */
@Delete('conversations/:id')
@UseGuards(JwtAuthGuard)
async deleteConversation(
  @Param('id') id: string,
  @CurrentUser() user: { id: string },
) {
  try {
    return await this.chatService.deleteConversation(id, user.id);
  } catch (err) {
    throw new NotFoundException((err as Error).message);
  }
}

/** 编辑对话标题 */
@Patch('conversations/:id')
@UseGuards(JwtAuthGuard)
async updateConversation(
  @Param('id') id: string,
  @Body() dto: UpdateConversationDto,
  @CurrentUser() user: { id: string },
) {
  try {
    return await this.chatService.updateConversation(id, user.id, dto.title);
  } catch (err) {
    throw new NotFoundException((err as Error).message);
  }
}
```

需要在 `ChatController` 的 imports 中新增：
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
```

- [ ] **Step 5: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 6: API 手工验证**

```bash
TOKEN="<token>"
# 创建对话
curl -X POST http://localhost:3001/api/chat/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试对话"}'

# 列表
curl http://localhost:3001/api/chat/conversations -H "Authorization: Bearer $TOKEN"

# 删除
curl -X DELETE http://localhost:3001/api/chat/conversations/<id> -H "Authorization: Bearer $TOKEN"
```

---

### Task 6: SSE 流式端点关联 conversationId

**Files:**
- Modify: `apps/server/src/modules/chat/chat.dto.ts`
- Modify: `apps/server/src/modules/chat/chat.service.ts`
- Modify: `apps/server/src/modules/chat/chat.controller.ts`

**Interfaces:**
- Consumes: `ChatService.saveMessage()` (Task 5)
- Produces: `ChatDto.conversationId?: string` — 新增可选字段
- Produces: `streamAnswer()` 流结束后自动持久化 user + assistant 消息

- [ ] **Step 1: 修改 ChatDto — 新增 conversationId**

```typescript
export class ChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
```

- [ ] **Step 2: 修改 ChatService.streamAnswer — 支持 conversationId**

修改 `streamAnswer` 签名和逻辑：

```typescript
async *streamAnswer(message: string, userId: string, sessionId: string, conversationId?: string) {
  // ... 现有的"记住xxx"处理和 memory.onMessage ...

  // 如果传入了 conversationId，创建关联（不阻塞流）
  let resolvedConvId = conversationId;
  const convPromise = (async () => {
    if (!resolvedConvId) {
      // 自动创建对话，title 取首条消息前 30 字符
      const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
      const conv = await this.createConversation(userId, title);
      resolvedConvId = conv.id;
    }
  })();

  // ... 现有流式循环 ...

  // 流结束后持久化消息
  if (resolvedConvId) {
    await convPromise; // 确保对话已创建
    await this.saveMessage(resolvedConvId, 'user', message).catch(() => {});
    if (fullAnswer) {
      await this.saveMessage(resolvedConvId, 'assistant', fullAnswer).catch(() => {});
    }
  }
}
```

简化实现——只在流结束时持久化，不阻塞首 token：

```typescript
async *streamAnswer(message: string, userId: string, sessionId: string, conversationId?: string) {
  // 检测"记住xxx"模式 → 写入 Mem0 明确记忆
  if (/^(记住|请记住|帮我记住)/.test(message)) {
    // ... 现有逻辑 ...
    return;
  }

  // 记录用户消息到 Redis
  await this.memory.onMessage(sessionId, userId, 'user', message);

  // 如果没有传入 conversationId，自动创建
  let resolvedConvId = conversationId;
  if (!resolvedConvId) {
    const title = message.length > 30 ? message.slice(0, 30) + '…' : message;
    const conv = await this.createConversation(userId, title);
    resolvedConvId = conv.id;
  }

  // 持久化用户消息
  await this.saveMessage(resolvedConvId, 'user', message).catch(() => {});

  // ... 现有流式循环（不变）...

  // 流结束后持久化助手回答
  try {
    // ... 现有流式循环代码 ...（保持不变）
    
    // 记录助手回答到 Redis
    if (fullAnswer) {
      await this.memory.onMessage(sessionId, userId, 'assistant', fullAnswer);
      // 持久化到 Postgres
      await this.saveMessage(resolvedConvId, 'assistant', fullAnswer).catch(() => {});
    }
  } finally {
    if (traceId) {
      await this.langfuse.flush();
    }
  }
}
```

- [ ] **Step 3: 修改 ChatController.streamChat — 传递 conversationId**

```typescript
async streamChat(
  @Body() dto: ChatDto,
  @CurrentUser() user: { id: string },
  @Res() res: Response,
) {
  // ... 现有 SSE 设置 ...
  const stream = this.chatService.streamAnswer(
    dto.message,
    user.id,
    sessionId,
    dto.conversationId,
  );
  // ... 其余不变 ...
}
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 集成验证**

```bash
# 1. 先创建对话
curl -X POST http://localhost:3001/api/chat/conversations \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"测试"}'

# 2. 发送消息流
curl -N -X POST http://localhost:3001/api/chat/stream \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"你好","sessionId":"test-sess","conversationId":"<conv-id>"}'

# 3. 验证消息已持久化
curl http://localhost:3001/api/chat/conversations/<conv-id>/messages \
  -H "Authorization: Bearer $TOKEN"
```

---

### Task 7: 前端 — ConversationList 组件

**Files:**
- Create: `apps/web/src/components/chat/ConversationList.tsx`

**Interfaces:**
- Consumes: `GET /chat/conversations`, `POST /chat/conversations`, `DELETE /chat/conversations/:id`
- Produces: `ConversationList` React 组件 — props 含 `activeId`, `onSelect`, `onNew`, `onDelete`, `onRename`

- [ ] **Step 1: 创建 ConversationList 组件**

```tsx
import { useState, useEffect } from 'react';
import { Button, List, Popconfirm, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons';

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: (refreshFn: () => Promise<void>) => void;
}

export default function ConversationList({ activeId, onSelect, onRefresh }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/chat/conversations?pageSize=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setConversations(data.items || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchList();
    if (onRefresh) onRefresh(fetchList);
  }, []);

  const handleNew = async () => {
    const token = localStorage.getItem('access_token');
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: '新对话' }),
    });
    const conv = await res.json();
    await fetchList();
    onSelect(conv.id);
  };

  const handleDelete = async (id: string) => {
    const token = localStorage.getItem('access_token');
    await fetch(`/api/chat/conversations/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchList();
    if (activeId === id) onSelect('');
  };

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <Typography.Text strong>对话列表</Typography.Text>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleNew}>
          新建
        </Button>
      </div>
      <List
        loading={loading}
        dataSource={conversations}
        locale={{ emptyText: '暂无对话' }}
        renderItem={(item) => (
          <List.Item
            className={`conversation-item ${item.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
            actions={[
              <Popconfirm
                key="del"
                title="确定删除此对话？"
                onConfirm={(e) => { e?.stopPropagation(); handleDelete(item.id); }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={<MessageOutlined />}
              title={item.title.length > 20 ? item.title.slice(0, 20) + '…' : item.title}
              description={new Date(item.updated_at).toLocaleDateString()}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

---

### Task 8: 前端 — ChatPage 集成对话列表

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `ConversationList` (Task 7)
- Consumes: `GET /chat/conversations/:id/messages`
- Produces: 改造后的 ChatPage — 左侧列表 + 右侧聊天区

- [ ] **Step 1: 改造 ChatPage — 添加状态和对话切换逻辑**

重写 [ChatPage.tsx](apps/web/src/pages/chat/ChatPage.tsx)：

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Tag, message as antMsg } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';
import ConversationList from '../../components/chat/ConversationList';

interface Message { role: 'user' | 'assistant'; content: string; }

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<Array<{ index: number; docId: string; chunkId: string }>>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { sendMessage } = useSSE();
  const sessionId = useRef(`sess-${Date.now()}`).current;
  const { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } = useVoiceChat(sessionId);

  useEffect(() => {
    const socket = connect();
    return () => { socket?.disconnect(); };
  }, []);

  useEffect(() => {
    if (triggerMessage) {
      handleSend(triggerMessage);
      clearTrigger();
    }
  }, [triggerMessage]);

  /** 加载对话历史消息 */
  const loadConversation = useCallback(async (convId: string) => {
    setLoadingHistory(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      setActiveConvId(convId);
    } catch {
      antMsg.error('加载对话失败');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  /** 新建对话 */
  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setActiveConvId(null);
    setStreaming('');
    setSources([]);
  }, []);

  const handleSend = async (voiceText?: string) => {
    const text = (voiceText || input).trim();
    if (!text || streaming) return;
    if (!voiceText) setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming('');

    await sendMessage(
      text,
      sessionId,
      (token) => setStreaming((prev) => prev + token),
      () => {
        setStreaming((prev) => {
          if (prev) {
            setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
            // 如果没有活跃对话，刷新列表以显示新创建的对话
            if (!activeConvId) {
              // 延迟刷新以确保后端已创建
              setTimeout(() => {
                const event = new CustomEvent('refresh-conversations');
                window.dispatchEvent(event);
              }, 500);
            }
          }
          return '';
        });
      },
      (srcs) => setSources(srcs),
      activeConvId,
    );
  };

  return (
    <div className="chat-layout">
      {/* 左侧对话列表 */}
      <aside className="chat-sidebar">
        <ConversationList
          activeId={activeConvId}
          onSelect={(id) => loadConversation(id)}
        />
      </aside>

      {/* 右侧聊天区 */}
      <main className="chat-main">
        <div className="chat-messages">
          {loadingHistory && <div style={{ textAlign: 'center', color: '#999' }}>加载中…</div>}
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
          ))}
          {!streaming && messages.length === 0 && !loadingHistory && (
            <div className="chat-empty-hint">
              <div className="chat-empty-icon">💬</div>
              <h3>AI 知识库问答</h3>
              <p>输入您的问题，我将从知识库中检索答案</p>
            </div>
          )}
          {streaming && <div className="chat-bubble assistant streaming">{streaming}</div>}
        </div>
        {sources.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ marginRight: 8, color: '#666', fontSize: 13 }}>参考来源：</span>
            {sources.map((s) => (
              <Tag key={s.index} color="blue" title={`文档: ${s.docId} | 片段: ${s.chunkId}`}>
                [{s.index}]
              </Tag>
            ))}
          </div>
        )}
        <div className="chat-input-area">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => handleSend()}
            placeholder="输入您的问题..."
            disabled={!!streaming}
            size="large"
            style={{ flex: 1 }}
          />
          <VoiceButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => handleSend()}
            disabled={!!streaming}
            size="large"
          >
            发送
          </Button>
        </div>
        {asrText && <div className="asr-preview">{asrText}</div>}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 更新 useSSE hook — 支持 conversationId**

修改 [useSSE.ts](apps/web/src/hooks/useSSE.ts) 的 `sendMessage` 签名：

```typescript
const sendMessage = useCallback(
  async (
    message: string,
    sessionId: string,
    onToken: (token: string) => void,
    onDone: () => void,
    onSources?: (sources: Array<{ index: number; docId: string; chunkId: string }>) => void,
    conversationId?: string | null,
  ) => {
    const token = localStorage.getItem('access_token');
    const body: any = { message, sessionId };
    if (conversationId) body.conversationId = conversationId;

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    // ... 其余不变 ...
  },
  [],
);
```

- [ ] **Step 3: 添加对话布局样式**

在 [global.css](apps/web/src/styles/global.css) 末尾添加：

```css
/* 对话布局 */
.chat-layout {
  display: flex;
  height: calc(100vh - 64px);
  overflow: hidden;
}
.chat-sidebar {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid #f0f0f0;
  overflow-y: auto;
  background: #fafafa;
}
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 对话列表 */
.conversation-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
}
.conversation-item {
  cursor: pointer;
  padding: 8px 12px !important;
  border-bottom: 1px solid #f5f5f5;
}
.conversation-item:hover { background: #e6f7ff; }
.conversation-item.active { background: #bae7ff; }
```

- [ ] **Step 4: 前端编译验证**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 5: 端到端验证**

1. 打开前端 http://localhost:3000/chat
2. 验证左侧对话列表显示
3. 点击"新建"按钮创建对话
4. 发送消息，验证出现在对话中
5. 刷新页面，验证对话历史和消息仍然存在
6. 删除对话，验证从列表中消失

---

## 验证清单

所有任务完成后，运行以下验证：

- [ ] **Bug 1 验证**: 上传中文文件名文件 → 数据库中 `name` 正确显示中文
- [ ] **Bug 2 验证**: 对已索引文档问一个宽泛问题 → 回答不再包含重复段落
- [ ] **Bug 3 验证**: 打开 ChatPage → 显示"AI 知识库问答"引导文案，无 Spin
- [ ] **对话历史验证**:
  - 新建对话 → 列表中显示
  - 发送消息 → 对话自动创建（若未预先创建）+ 消息持久化
  - 切换对话 → 历史消息正确加载
  - 删除对话 → 从列表消失
