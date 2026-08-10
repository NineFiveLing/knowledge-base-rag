# AI 聊天参考来源 — 去重 + 消息级关联 设计文档

> **目标：** 来源按文档去重 + 每条 AI 消息独立保存和展示其来源卡片

## 架构概述

**问题：**
1. 同一文档的多个 chunk 产生重复来源卡片
2. 来源未持久化，切换/刷新对话后丢失
3. 来源是全局 state，不跟随对应消息

**方案：**
1. 后端 sources 按 docId 去重
2. 后端 SSE 流中捕获 sources 数据，传入 saveMessage 持久化
3. 前端 Message 接口增加 sources 字段，来源卡片渲染在对应 AI 消息气泡下方

**数据流：**
```
RAG 检索 chunks → 按 docId 去重 → sources JSON → SSE 推送 → 前端消息.sources
                                       ↓
                              saveMessage(sources) → Postgres jsonb
                                       ↓
                          加载历史 → messages 含 sources → 每条 AI 消息下方渲染卡片
```

---

## 一、后端改动

### 1.1 generate.ts — sources 按 docId 去重

**文件：** `apps/server/src/modules/rag/nodes/generate.ts:108-115`

当前 sources 按 chunk 生成（同一文档多 chunk 产生多张卡片），改为按 docId 去重：

```typescript
// 构建来源列表，按 docId 去重
const seen = new Set<string>();
const sources = deduped
  .filter((c) => {
    const id = c.postgres_doc_id || '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  })
  .map((c, i) => ({
    index: i + 1,
    docId: c.postgres_doc_id || '',
    chunkId: c.chunk_id || '',
    docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
    docType: docTypeMap.get(c.postgres_doc_id || '') || 'text',
    docSize: docSizeMap.get(c.postgres_doc_id || '') || 0,
  }));
```

### 1.2 chat.service.ts — 捕获 sources 并持久化

**文件：** `apps/server/src/modules/chat/chat.service.ts`

**改动点：**

1. `sourcesSent` boolean 改为 `sourcesData` 数组变量（line 60）：
```typescript
let sourcesData: any[] | null = null;
```

2. yield sources 时捕获数据（lines 93-94, 152-154 等）：
```typescript
sourcesData = sources;
```

3. saveMessage 时传入 sources（line 202）：
```typescript
await this.saveMessage(resolvedConvId, 'assistant', fullAnswer, sourcesData || undefined)
```

---

## 二、前端改动

### 2.1 Message 接口增加 sources

**文件：** `apps/web/src/pages/chat/ChatPage.tsx`

```typescript
interface Message { 
  role: 'user' | 'assistant'; 
  content: string; 
  sources?: SourceRef[];   // 新增
}
```

### 2.2 移除全局 sources state

删除 `const [sources, setSources] = useState<SourceRef[]>([]);`

`onSources` 回调改为将 sources 写入消息列表中的当前 AI 消息：
```typescript
(srcs) => {
  setMessages((prev) => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last && last.role === 'assistant') {
      last.sources = srcs;
    }
    return next;
  });
}
```

`ConvLive` 中的 sources 保留（跨对话切换时需要）。

### 2.3 加载历史消息时解析 sources

**文件：** `apps/web/src/pages/chat/ChatPage.tsx` — `handleSelectConv`

```typescript
const msgs: Message[] = data.messages.map((m: any) => ({
  role: m.role,
  content: m.content,
  sources: m.sources || undefined,
}));
```

### 2.4 来源卡片渲染位置

从输入框上方移到每条 AI 消息气泡下方。

历史消息渲染（messages.map 中）：
```tsx
{messages.map((m, i) => (
  <div key={i} className={`chat-bubble-row ${m.role}`}>
    <div className={`chat-avatar ${m.role}`}>
      {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
    </div>
    <div className="chat-bubble-wrapper">
      <div className={`chat-bubble ${m.role}`}>{m.content}</div>
      {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
        <div className="chat-sources">
          <div className="chat-sources-header">
            <span>📎 参考来源</span>
          </div>
          <div className="chat-sources-cards">
            {m.sources.map((s) => (
              <SourceCard key={s.docId} source={s} onClick={() => setSourceDetailDocId(s.docId)} />
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
))}
```

流式输出区域也显示来源：
```tsx
{displayStreaming && (
  <div className="chat-bubble-row assistant">
    <div className="chat-avatar assistant"><RobotOutlined /></div>
    <div className="chat-bubble-wrapper">
      <div className="chat-bubble assistant streaming">{displayStreaming}</div>
      {displaySources.length > 0 && (
        <div className="chat-sources">
          <div className="chat-sources-header">
            <span>📎 参考来源</span>
          </div>
          <div className="chat-sources-cards">
            {displaySources.map((s) => (
              <SourceCard key={s.docId} source={s} onClick={() => setSourceDetailDocId(s.docId)} />
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
)}
```

### 2.5 样式微调

新增气泡包装器样式，使来源卡片与气泡左对齐：
```css
.chat-bubble-wrapper {
  max-width: 75%;
  min-width: 0;
}
```

---

## 三、交互流程

```
用户提问 → RAG 检索 → 按 docId 去重 sources
    ↓
SSE 推送：text token + sources 事件
    ↓
前端：text → 流式气泡 | sources → 当前消息.sources
    ↓
流结束 → saveMessage(content, sources) → 持久化
    ↓
切换/刷新 → 加载历史 → 每条 AI 消息气泡下方显示对应来源卡片
    ↓
点击来源卡片 → DocumentDetailDrawer
```

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/modules/rag/nodes/generate.ts` | 修改 | sources 按 docId 去重 |
| `apps/server/src/modules/chat/chat.service.ts` | 修改 | 捕获 sources，持久化到消息 |
| `apps/web/src/pages/chat/ChatPage.tsx` | 修改 | Message 加 sources，来源卡片移到气泡下方，加载历史解析 sources |
| `apps/web/src/styles/global.css` | 修改 | 新增 .chat-bubble-wrapper 样式 |

## 五、不变的部分

- SSE 流式传输逻辑不变（仅增加变量捕获）
- SourceCard 组件不变
- DocumentDetailDrawer 组件不变
- generate.ts ANSWER_PROMPT 不变
