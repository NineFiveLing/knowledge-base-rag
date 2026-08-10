# AI 聊天参考来源 — 去重 + 消息级关联 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 来源按 docId 去重 + 每条 AI 消息独立保存和展示其来源卡片

**Architecture:** 后端 generate.ts 来源构建时按 docId 去重；chat.service.ts 捕获 sources 数组传入 saveMessage 持久化；前端 Message 接口增加 sources 字段，来源卡片从全局区域移到每条 AI 消息气泡下方

**Tech Stack:** NestJS + TypeORM (backend), React + TypeScript + Ant Design (frontend)

## Global Constraints

- 现有 SSE 流式传输逻辑不变
- 不新增后端 API 端点
- SourceCard 组件不修改
- DocumentDetailDrawer 组件不修改
- 前端 ConvLive 跨对话 sources 状态保留

---

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/server/src/modules/rag/nodes/generate.ts` | 来源构建 — 按 docId 去重 |
| `apps/server/src/modules/chat/chat.service.ts` | SSE 流 — 捕获 sources + saveMessage 传入 |
| `apps/web/src/pages/chat/ChatPage.tsx` | 消息级 sources + 渲染位置调整 + 历史加载 |
| `apps/web/src/styles/global.css` | 新增 .chat-bubble-wrapper 样式 |

---

### Task 1: Backend — sources 按 docId 去重 + 捕获并持久化

**Files:**
- Modify: `apps/server/src/modules/rag/nodes/generate.ts:108-115`
- Modify: `apps/server/src/modules/chat/chat.service.ts:60, 93-94, 152-154, 202`

**Interfaces:**
- Consumes: `deduped` chunks array, `docNameMap`/`docTypeMap`/`docSizeMap`
- Produces: sources 去重（按 docId），sourcesData 变量供 saveMessage

- [ ] **Step 1: generate.ts — sources 按 docId 去重**

```typescript
// apps/server/src/modules/rag/nodes/generate.ts:108-115
// 将
const sources = deduped.map((c, i) => ({
  index: i + 1,
  docId: c.postgres_doc_id || '',
  chunkId: c.chunk_id || '',
  docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
  docType: docTypeMap.get(c.postgres_doc_id || '') || 'text',
  docSize: docSizeMap.get(c.postgres_doc_id || '') || 0,
}));

// 改为
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

- [ ] **Step 2: chat.service.ts — sourcesSent boolean 改为 sourcesData 数组**

```typescript
// apps/server/src/modules/chat/chat.service.ts:60
// 将
let sourcesSent = false;
// 改为
let sourcesData: any[] | null = null;
```

- [ ] **Step 3: chat.service.ts — 更新 sourcesSent 引用**

在 `streamAnswer` 方法中，将所有 `sourcesSent` 引用替换为 `sourcesData`：

```typescript
// 原 line 80：flushBuffer 中的判断
// 将 if (!pendingBuffer || sourcesSent)
// 改为 if (!pendingBuffer || sourcesData)

// 原 line 94：yield sources 后
// 将 sourcesSent = true;
// 改为 sourcesData = sources;

// 原 line 132：token 流式判断
// 将 if (sourcesSent)
// 改为 if (sourcesData)

// 原 line 151-153：节点输出兜底
// 将 if (!sourcesSent && answer.includes(SOURCES_PREFIX))
// 改为 if (!sourcesData && answer.includes(SOURCES_PREFIX))
```

- [ ] **Step 4: chat.service.ts — saveMessage 传入 sources**

```typescript
// apps/server/src/modules/chat/chat.service.ts:202
// 将
await this.saveMessage(resolvedConvId, 'assistant', fullAnswer).catch((err) => {
// 改为
await this.saveMessage(resolvedConvId, 'assistant', fullAnswer, sourcesData || undefined).catch((err) => {
```

- [ ] **Step 5: 编译验证后端**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: exit code 0。

---

### Task 2: Frontend — Message + sources，来源卡片移到气泡下方，历史加载 sources

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `SourceRef` (from SourceCard.tsx), `SourceCard` component, `DocumentDetailDrawer`
- Produces: `Message` 接口含 sources，来源卡片渲染在气泡下方

- [ ] **Step 1: Message 接口增加 sources 字段**

```typescript
// apps/web/src/pages/chat/ChatPage.tsx:12
// 将
interface Message { role: 'user' | 'assistant'; content: string; }
// 改为
interface Message { role: 'user' | 'assistant'; content: string; sources?: SourceRef[]; }
```

- [ ] **Step 2: 移除全局 sources state**

```typescript
// 删除这一行：
const [sources, setSources] = useState<SourceRef[]>([]);
```

- [ ] **Step 3: 更新 onSources 回调 — 写入消息而非全局 state**

```typescript
// 当前 onSources 回调（line 200-211）：
(srcs) => {
  if (activeConvRef.current !== currentSSEConvRef.current) {
    const key = currentSSEConvRef.current || '__orphan__';
    const live = convLiveRef.current.get(key);
    if (live) {
      live.sources = srcs;
      convLiveRef.current.set(key, live);
    }
    return;
  }
  setSources(srcs);
},

// 改为：
(srcs) => {
  if (activeConvRef.current !== currentSSEConvRef.current) {
    const key = currentSSEConvRef.current || '__orphan__';
    const live = convLiveRef.current.get(key);
    if (live) {
      live.sources = srcs;
      convLiveRef.current.set(key, live);
    }
    return;
  }
  // 写入当前 AI 消息的 sources
  setMessages((prev) => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last && last.role === 'assistant') {
      last.sources = srcs;
    }
    return next;
  });
},
```

- [ ] **Step 4: 更新 sourcesRef 和 ConvLive 相关逻辑**

```typescript
// sourcesRef 改为跟踪当前消息的 sources
// 删除 sourcesRef 的声明
const sourcesRef = useRef<SourceRef[]>([]);

// sync ref 行删除 sourcesRef.current = sources;
```

- [ ] **Step 5: displaySources 改为从消息中读取**

```typescript
// 删除：
const displaySources = sources;
// 改为：从最后一条 assistant 消息中取 sources
const displaySources = (() => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].sources) {
      return messages[i].sources;
    }
  }
  return [];
})();
```

- [ ] **Step 6: 历史消息渲染 — 来源卡片移到气泡下方**

将 messages.map 中的气泡包装，在 AI 消息下方添加来源卡片：

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

- [ ] **Step 7: 流式输出区域 — 也显示来源卡片**

```tsx
{/* 流式输出 */}
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

- [ ] **Step 8: 删除输入框上方的旧来源区域**

删除原有的 `{displaySources.length > 0 && (...)}`  块（之前位于输入框上方）。该区域现在移到消息气泡下方。

- [ ] **Step 9: handleSelectConv — 加载历史时解析 sources**

```typescript
// apps/web/src/pages/chat/ChatPage.tsx — handleSelectConv 中
// 将
const msgs: Message[] = data.messages.map((m: any) => ({ role: m.role, content: m.content }));

// 改为
const msgs: Message[] = data.messages.map((m: any) => ({
  role: m.role,
  content: m.content,
  sources: m.sources || undefined,
}));
```

- [ ] **Step 10: applyConvState — 同步时保留 sources**

`applyConvState` 中恢复 live state 时，sources 来自 ConvLive（正在流式中的消息）。不需要额外改动，ConvLive 已有 sources 字段。

- [ ] **Step 11: 新增 .chat-bubble-wrapper 样式**

```css
/* apps/web/src/styles/global.css — 在 .chat-bubble 样式附近添加 */
.chat-bubble-wrapper {
  max-width: 75%;
  min-width: 0;
}
```

- [ ] **Step 12: 编译验证前端**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: exit code 0，无类型错误。

---

### Task 3: 全量编译验证 + Commit

**Files:**
- 验证所有改动

- [ ] **Step 1: 编译后端**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: exit code 0。

- [ ] **Step 2: 编译前端**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: exit code 0。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/rag/nodes/generate.ts \
        apps/server/src/modules/chat/chat.service.ts \
        apps/web/src/pages/chat/ChatPage.tsx \
        apps/web/src/styles/global.css
git commit -m "feat(chat): 来源按文档去重，每条 AI 消息独立保存和展示来源卡片"
```
