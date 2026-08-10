# RAG 聊天修复 + 对话历史功能 — 设计文档

> 日期：2026-07-30 | 版本：1.0 | 状态：待审阅

## 1. 概述

本次迭代包含 **3 个 bug 修复**（中文文件名乱码、AI 回答重复、前端持续 loading）和 **1 个新功能**（对话历史存储与展示）。

---

## 2. Bug 修复

### 2.1 中文文件名乱码

**根因**：Multer/busboy 解析 multipart `Content-Disposition` 时，将 UTF-8 中文文件名字节按 Latin-1（ISO-8859-1）解码，导致 `file.originalname` 变为乱码（如 `员工手册-综` → `Ô±¹¤ÊÖ²á-×Û`）。

**影响范围**：`document.service.ts` 中 5 处使用 `file.originalname` 的位置（RustFS 上传、扩展名提取、解析器传参、数据库存储），以及 `replaceFile()` 中的同名用法。

**修复方案**：服务层防御性转码

在 `document.service.ts` 的 `uploadStage1()` 和 `replaceFile()` 入口处，检测并修正编码：

```typescript
function fixEncoding(name: string): string {
  // 尝试将 Latin-1 误读的 UTF-8 字节序列还原
  try {
    const buf = Buffer.from(name, 'latin1');
    const utf8 = buf.toString('utf8');
    // 如果还原后包含有效中文字符，说明是误编码
    if (/[一-鿿]/.test(utf8)) return utf8;
  } catch {}
  return name;
}
```

所有 `file.originalname` 替换为 `fixEncoding(file.originalname)`。

**改动文件**：
- `apps/server/src/modules/document/document.service.ts` — 新增 `fixEncoding()` + 替换所有 `file.originalname` 引用

---

### 2.2 AI 回答重复

**根因**：Agent 路径（complex/followup）3 个工具各自单源调用 `hybridSearch()`，RRF 的 `chunk_id` 去重仅在**同一次多源调用**中生效；跨工具、跨 ReAct 轮次均无去重，LLM 收到重复 chunk 后生成重复回答。

**修复方案**：在 `generate_answer` 节点对 `retrievedChunks` 按 `chunk_text` 相似度去重，同时在 Agent 工具函数的 LLM prompt 层添加去重提示作为辅助。

**去重算法**：

1. **完全相等**（`chunk_id` 或 `chunk_text` 完全相同）→ 直接去重，保留 score 最高的
2. **高重叠度**：使用双字符 bigram（character-level 2-gram，兼容中文）的 Jaccard 相似度 >= 0.85 → 判定为重复

```typescript
function dedupChunks(chunks: ChunkResult[]): ChunkResult[] {
  // 第一轮：按 chunk_id 去重（精确匹配）
  const byId = new Map<string, ChunkResult>();
  for (const c of chunks) {
    const existing = byId.get(c.chunk_id);
    if (!existing || c.score > existing.score) byId.set(c.chunk_id, c);
  }

  // 第二轮：按内容 bigram 相似度去重（模糊匹配，兼容中文）
  const seen: ChunkResult[] = [];
  for (const c of byId.values()) {
    const isDup = seen.some((s) => bigramJaccard(s.chunk_text, c.chunk_text) >= 0.85);
    if (!isDup) seen.push(c);
  }
  return seen;
}

function bigrams(text: string): Set<string> {
  const bgs = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) bgs.add(text.slice(i, i + 2));
  return bgs;
}

function bigramJaccard(a: string, b: string): number {
  if (a === b) return 1;
  const setA = bigrams(a), setB = bigrams(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / Math.max(union.size, 1);
}
```

**改动文件**：
- `apps/server/src/modules/rag/nodes/generate.ts` — 在生成前对 `retrievedChunks` 去重
- `apps/server/src/modules/rag/tools.ts` — Agent 工具描述中添加"避免重复检索"提示

---

### 2.3 前端持续 loading

**根因**：`ChatPage.tsx:59` 的 `<Spin>` 条件 `!streaming && messages.length===0` 是页面初始状态，无任何数据请求来消除它。该 Spin 被误用作空状态占位符。

**修复方案**：移除 `<Spin>`，替换为引导性空状态文案。

```tsx
// 修改前
{!streaming && messages.length === 0 && <Spin style={{ display: 'block', margin: '12px 0' }} />}

// 修改后
{!streaming && messages.length === 0 && (
  <div className="chat-empty-hint">
    <p>👋 欢迎使用 AI 知识库问答</p>
    <p>输入您的问题，我将从知识库中检索答案</p>
  </div>
)}
```

**改动文件**：
- `apps/web/src/pages/chat/ChatPage.tsx` — 替换 Spin 为空状态提示
- `apps/web/src/styles/global.css` — 新增 `.chat-empty-hint` 样式

---

## 3. 新功能：对话历史

### 3.1 数据模型

#### 新建表：conversations

```sql
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,                    -- users.id
  title           VARCHAR(255) NOT NULL DEFAULT '新对话',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
```

#### 新建表：messages

```sql
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  sources         JSONB,                             -- 来源引用 [{index, docId, chunkId}]
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conv_id ON messages(conversation_id);
```

#### TypeORM 实体

**`Conversation` entity**：
- `id`, `user_id`, `title`, `created_at`, `updated_at`
- `user_id` + `many-to-one` 关联 User

**`Message` entity**：
- `id`, `conversation_id`, `role`, `content`, `sources` (jsonb), `created_at`
- `conversation_id` + `many-to-one` 关联 Conversation

### 3.2 后端 API

所有端点基于 `@Controller('chat')`，受 `JwtAuthGuard` 保护。

#### `GET /chat/conversations` — 对话列表

```
查询参数：?page=1&pageSize=20
返回：{ items: Conversation[], total, page, pageSize }
排序：updated_at DESC
过滤：仅返回当前用户的对话
```

#### `POST /chat/conversations` — 新建对话

```
请求体：{ title?: string }  // title 可选，默认"新对话"
返回：Conversation 对象
```

#### `GET /chat/conversations/:id/messages` — 对话消息列表

```
返回：{ conversation, messages: Message[] }
消息按 created_at ASC 排序
```

#### `DELETE /chat/conversations/:id` — 删除对话

```
权限：仅创建者可删除
级联删除关联的 messages
返回：{ success: true }
```

#### `PATCH /chat/conversations/:id` — 编辑对话标题

```
请求体：{ title: string }
权限：仅创建者可编辑
返回：更新后的 Conversation
```

#### 修改 `POST /chat/stream` — 关联对话

- 请求体新增可选字段 `conversationId?: string`
- 若未传 `conversationId`，自动创建新对话（title 取首条用户消息前 30 字符）
- 流式回答结束后，持久化 user + assistant 消息到 messages 表
- 现有 Redis 短期记忆机制保持不变

### 3.3 前端设计

#### ChatPage 改造

```
┌──────────────────┬──────────────────────────────────────────┐
│ 📝 对话列表       │  对话标题                    [+ 新对话]  │
│                  │                                          │
│ [+ 新对话]       │  ┌──────────────────────────────────┐   │
│                  │  │ 👤 用户: 绩效考核是怎么执行的？    │   │
│ 历史对话1        │  │ 🤖 AI: 绩效考核分为季度考核...    │   │
│ 历史对话2        │  │       ┌─ 参考来源 ──────────────┐ │   │
│ 历史对话3        │  │       │ [1] 📄 绩效考核制度.docx │ │   │
│                  │  │       └─────────────────────────┘ │   │
│                  │  └──────────────────────────────────┘   │
│                  │                                          │
│                  │  ┌──────────────────────────────────┐   │
│                  │  │ [输入您的问题...]          [发送] │   │
│                  │  └──────────────────────────────────┘   │
└──────────────────┴──────────────────────────────────────────┘
```

#### 组件清单

| 组件 | 作用 |
|------|------|
| `ConversationList` | 左侧对话列表：显示标题 + 时间，支持点击切换、新建 |
| `ChatPage`（改造） | 右侧聊天区：加载选中对话的历史消息 + 发送新消息关联 conversationId |

#### 状态管理

使用 React 组件 state（无需 Zustand）：

```typescript
// ChatPage 核心状态
const [conversations, setConversations] = useState<Conversation[]>([]);
const [activeConvId, setActiveConvId] = useState<string | null>(null);
const [messages, setMessages] = useState<Message[]>([]);
const [streaming, setStreaming] = useState('');
```

#### 交互流程

1. 页面加载 → `GET /chat/conversations` 获取对话列表
2. 默认选中最新对话（如有），加载其消息；否则显示空状态等待输入
3. 用户点击"新建对话" → `POST /chat/conversations` → 清空消息区，等待输入
4. 用户发送消息 → 若有 `activeConvId`，传 `conversationId` 给 `/chat/stream`
5. 流式结束 → 前端直接追加消息到当前列表，无需重新请求
6. 切换对话 → `GET /chat/conversations/:id/messages` 加载历史消息

---

## 4. 文件改动清单

### Bug 修复

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/modules/document/document.service.ts` | 修改 | + `fixEncoding()`, 替换 `file.originalname` |
| `apps/server/src/modules/rag/nodes/generate.ts` | 修改 | + `dedupChunks()` 检索结果去重 |
| `apps/server/src/modules/rag/tools.ts` | 修改 | Agent 工具描述提示去重 |
| `apps/web/src/pages/chat/ChatPage.tsx` | 修改 | Spin → 空状态欢迎提示 |
| `apps/web/src/styles/global.css` | 修改 | + `.chat-empty-hint` |

### 对话历史

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/modules/chat/entities/conversation.entity.ts` | **新建** | Conversation TypeORM 实体 |
| `apps/server/src/modules/chat/entities/message.entity.ts` | **新建** | Message TypeORM 实体 |
| `apps/server/src/modules/chat/dto/create-conversation.dto.ts` | **新建** | 创建对话 DTO |
| `apps/server/src/modules/chat/dto/update-conversation.dto.ts` | **新建** | 编辑对话标题 DTO |
| `apps/server/src/modules/chat/chat.controller.ts` | 修改 | + 5 个端点 |
| `apps/server/src/modules/chat/chat.service.ts` | 修改 | + CRUD 方法, stream 关联 conversationId |
| `apps/server/src/modules/chat/chat.module.ts` | 修改 | 注册新 entity |
| `apps/web/src/pages/chat/ChatPage.tsx` | 改造 | + 对话列表 + 历史消息加载 |
| `apps/web/src/components/chat/ConversationList.tsx` | **新建** | 左侧对话列表 |
| `apps/web/src/styles/global.css` | 修改 | + 对话布局样式 |

---

## 5. 实现顺序

```
阶段一：Bug 修复（3 个）
  1. 中文文件名乱码 — document.service.ts fixEncoding()
  2. 前端 loading — ChatPage.tsx Spin → 空状态
  3. AI 回答重复 — generate.ts + tools.ts 去重

阶段二：对话历史（新功能）
  4. 数据库：conversations + messages entity
  5. 后端：Chat CRUD API
  6. 后端：stream 端点关联 conversationId
  7. 前端：ConversationList 组件
  8. 前端：ChatPage 改造集成
```

---

## 6. 不在范围内

- 对话搜索
- 对话导出/分享
- 对话标签/分类
- 多用户对话共享
- Mem0 替代（对话摘要仍存 Mem0，新功能独立于 Mem0）
