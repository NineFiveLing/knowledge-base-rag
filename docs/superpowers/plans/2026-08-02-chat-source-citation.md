# AI 聊天参考来源展示 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 回答文本纯净无 `[citation:N]` 标记，底部来源展示为类型图标卡片（名称+大小），点击卡片打开文档详情抽屉

**Architecture:** 后端 prompt 层禁止 LLM 输出引用标记，sources JSON 增加 `docType` + `docSize` 字段；前端新建 `SourceCard` 组件替换旧 Popover+Tag 方案，复用已有 `DocumentDetailDrawer` 展示文档详情

**Tech Stack:** NestJS + LangGraph (backend), React + TypeScript + Ant Design (frontend)

## Global Constraints

- 现有 SSE 流式传输逻辑不变
- 不新增后端 API 端点
- `DocumentDetailDrawer` 组件不修改，直接复用
- 类型图标使用内联 SVG（不引入新图标库）

---

## File Structure

| 文件 | 职责 |
|------|------|
| `apps/server/src/modules/rag/state.ts` | Agent state 类型定义 — sources 增加 `docType` |
| `apps/server/src/modules/rag/nodes/generate.ts` | RAG 答案生成节点 — prompt 优化 + 数据补全 |
| `apps/web/src/hooks/useSSE.ts` | SSE 流解析 — sources 类型增加 `docType` |
| `apps/web/src/components/chat/SourceCard.tsx` | **新建** — 来源卡片组件（图标 + 名称 + 大小） |
| `apps/web/src/pages/chat/ChatPage.tsx` | 聊天页面 — 替换来源渲染 + 集成 DocumentDetailDrawer |
| `apps/web/src/styles/global.css` | 全局样式 — 来源卡片样式 |

---

### Task 1: Backend — sources 增加 docType + docSize + prompt 禁止引用标记

**Files:**
- Modify: `apps/server/src/modules/rag/state.ts:45-53`
- Modify: `apps/server/src/modules/rag/nodes/generate.ts:9-12, 69-71, 91-108`

**Interfaces:**
- Consumes: `Repository<Document>`（已注入）, `AgentStateType`（已有）
- Produces: `sources` 类型变更为 `{ index, docId, chunkId, docName, docType, docSize }[]`

- [ ] **Step 1: state.ts — sources 类型增加 docType**

```typescript
// apps/server/src/modules/rag/state.ts:45-51
sources: Annotation<Array<{
  index: number;
  docId: string;
  chunkId: string;
  docName: string;
  docType: string;
  docSize: number;
}>>({
  reducer: (_, next) => next,
  default: () => [],
}),
```

- [ ] **Step 2: generate.ts — 修改 ANSWER_PROMPT 禁止引用标记**

```typescript
// apps/server/src/modules/rag/nodes/generate.ts:9-12
const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
- 准确、简洁，涉及流程的用步骤式说明
- 如果知识库内容不足，诚实说明
- 用户明确记忆的信息优先使用
- 不要在回答中使用引用编号、来源标记或 [citation:N] 格式，直接输出答案内容`;
```

- [ ] **Step 3: generate.ts — chunk 格式化去掉序号前缀**

```typescript
// Line 70-71: 将
contextParts.push(`## 检索结果\n${deduped.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')}`);
// 改为
contextParts.push(`## 检索结果\n${deduped.map((c) => `---\n${c.chunk_text}`).join('\n\n')}`);
```

- [ ] **Step 4: generate.ts — sources 构建增加 docType + docSize**

```typescript
// Lines 91-108: 将
const docNameMap = new Map<string, string>();
if (docRepo && uniqueDocIds.length > 0) {
  try {
    const docs = await docRepo.find({ where: { id: In(uniqueDocIds) } });
    for (const d of docs) {
      docNameMap.set(d.id, d.name);
    }
  } catch {
    // 查询文档名失败不影响主流程
  }
}
const sources = deduped.map((c, i) => ({
  index: i + 1,
  docId: c.postgres_doc_id || '',
  chunkId: c.chunk_id || '',
  docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
}));
// 改为
const docNameMap = new Map<string, string>();
const docTypeMap = new Map<string, string>();
const docSizeMap = new Map<string, number>();
if (docRepo && uniqueDocIds.length > 0) {
  try {
    const docs = await docRepo.find({ where: { id: In(uniqueDocIds) } });
    for (const d of docs) {
      docNameMap.set(d.id, d.name);
      docTypeMap.set(d.id, d.type);
      docSizeMap.set(d.id, Number(d.size) || 0);
    }
  } catch {
    // 查询文档名失败不影响主流程
  }
}
const sources = deduped.map((c, i) => ({
  index: i + 1,
  docId: c.postgres_doc_id || '',
  chunkId: c.chunk_id || '',
  docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
  docType: docTypeMap.get(c.postgres_doc_id || '') || 'text',
  docSize: docSizeMap.get(c.postgres_doc_id || '') || 0,
}));
```

- [ ] **Step 5: 编译验证后端**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: exit code 0, no errors.

---

### Task 2: Frontend — 更新 sources 类型增加 docType

**Files:**
- Modify: `apps/web/src/hooks/useSSE.ts:6, 31`
- Modify: `apps/web/src/pages/chat/ChatPage.tsx:10-13`

**Interfaces:**
- Consumes: Task 1 的 `docType` 字段
- Produces: SSE 类型和前端 state 类型支持 `docType`

- [ ] **Step 1: useSSE.ts — SSEEvent.sources 类型增加 docType**

```typescript
// apps/web/src/hooks/useSSE.ts:6
sources?: Array<{ index: number; docId: string; chunkId: string; docName: string; docType: string; docSize: number }>;

// Line 31 回调参数类型同步更新
onSources?: (sources: Array<{ index: number; docId: string; chunkId: string; docName: string; docType: string; docSize: number }>) => void,
```

- [ ] **Step 2: ChatPage.tsx — SourceRef 接口增加 docType**

```typescript
// apps/web/src/pages/chat/ChatPage.tsx:10-15
interface SourceRef {
  index: number;
  docId: string;
  chunkId: string;
  docName: string;
  docType: string;
  docSize: number;
}
```

- [ ] **Step 3: 编译验证前端**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: TypeScript 编译通过（SourceCard 组件尚未创建时可能报 `SourceCard` 未定义，属正常，Task 3 创建后解决）。

---

### Task 3: Frontend — 创建 SourceCard 组件

**Files:**
- Create: `apps/web/src/components/chat/SourceCard.tsx`

**Interfaces:**
- Consumes: `SourceRef`（Task 2 定义于 ChatPage.tsx，组件内部定义相同接口）
- Produces: `SourceCard` React 组件，props: `{ source: SourceRef; onClick: () => void }`

- [ ] **Step 1: 创建 SourceCard.tsx — 类型→图标+颜色映射**

```typescript
import { memo } from 'react';

interface SourceRef {
  index: number;
  docId: string;
  chunkId: string;
  docName: string;
  docType: string;
  docSize: number;
}

interface SourceCardProps {
  source: SourceRef;
  onClick: () => void;
}

/** 文件类型 → { 缩写, 颜色, 中文名 } 映射 */
const TYPE_CONFIG: Record<string, { abbr: string; color: string; label: string }> = {
  pdf:       { abbr: 'PDF', color: '#ff4d4f', label: 'PDF' },
  word:      { abbr: 'DOC', color: '#2f54eb', label: 'Word' },
  excel:     { abbr: 'XLS', color: '#52c41a', label: 'Excel' },
  ppt:       { abbr: 'PPT', color: '#fa8c16', label: 'PPT' },
  markdown:  { abbr: 'MD',  color: '#1677ff', label: 'Markdown' },
  text:      { abbr: 'TXT', color: '#666666', label: 'Text' },
  image:     { abbr: 'IMG', color: '#eb2f96', label: 'Image' },
  audio:     { abbr: 'AUD', color: '#722ed1', label: 'Audio' },
  video:     { abbr: 'VID', color: '#722ed1', label: 'Video' },
};

const DEFAULT_CONFIG = { abbr: 'FILE', color: '#999999', label: 'File' };
```

- [ ] **Step 2: 创建 SourceCard.tsx — 图标 SVG 组件**

```typescript
/** 22×22 文件类型图标 */
function FileTypeIcon({ docType }: { docType: string }) {
  const cfg = TYPE_CONFIG[docType] || DEFAULT_CONFIG;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="4" y="2" width="16" height="20" rx="2" fill={cfg.color} />
      <text
        x="12" y="16"
        textAnchor="middle"
        fontSize={cfg.abbr.length > 3 ? '6' : '7'}
        fill="#fff"
        fontWeight="bold"
      >
        {cfg.abbr}
      </text>
    </svg>
  );
}
```

- [ ] **Step 3: 创建 SourceCard.tsx — 卡片组件主体**

```typescript
function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SourceCard = memo(function SourceCard({ source, onClick }: SourceCardProps) {
  return (
    <div className="source-card" onClick={onClick}>
      <FileTypeIcon docType={source.docType} />
      <div className="source-card-body">
        <div className="source-card-name">{source.docName}</div>
        <div className="source-card-size">{formatSize(source.docSize)}</div>
      </div>
      <span className="source-card-arrow">→</span>
    </div>
  );
});

export type { SourceRef };
```

- [ ] **Step 4: 编译验证前端**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: exit code 0。SourceCard 可独立编译通过。

---

### Task 4: Frontend — 更新 ChatPage 来源渲染 + 集成 DocumentDetailDrawer

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`

**Interfaces:**
- Consumes: `SourceCard` (Task 3), `DocumentDetailDrawer` (已有), `SourceRef` (Task 2)
- Produces: 来源区域以卡片形式展示，点击打开文档详情抽屉

**注意：** 以下改动是整体替换，先删除旧的 popover 方案再添加新方案。

- [ ] **Step 1: 清理旧实现 — 删除 Popover 相关 import**

```typescript
// apps/web/src/pages/chat/ChatPage.tsx:1
// 删除 Popover, Descriptions, Spin 中不再需要的 import
// 将
import { Input, Button, Tag, Popover, Descriptions, Spin, message as antMsg } from 'antd';
// 改为
import { Input, Button, message as antMsg } from 'antd';
```

- [ ] **Step 2: 添加新 import**

```typescript
// 新增 SourceCard 和 DocumentDetailDrawer 的 import
import { SourceCard } from '../../components/chat/SourceCard';
import type { SourceRef } from '../../components/chat/SourceCard';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';
```

- [ ] **Step 3: 删除旧的 sourceDocCache/sourceLoadingSet/fetchSourceDoc/formatSize**

删除以下代码块（从 ChatPage.tsx 中移除）：
- `const [sourceDocCache, setSourceDocCache] = useState<Map<string, any>>(new Map());`
- `const [sourceLoadingSet, setSourceLoadingSet] = useState<Set<string>>(new Set());`
- `const fetchSourceDoc = async (docId: string) => { ... };`
- `function formatSize(bytes: number): string { ... }`（已移至 SourceCard.tsx）

- [ ] **Step 4: 新增 sourceDetailDocId state**

```typescript
// 在 sources state 声明附近（原 line 24 附近）新增：
const [sourceDetailDocId, setSourceDetailDocId] = useState<string | null>(null);
```

- [ ] **Step 5: 替换 sources state 类型为 SourceRef[]**

```typescript
// 将
const [sources, setSources] = useState<SourceRef[]>([]);
// SourceRef 现在从 SourceCard 模块 import（Step 2），删除 ChatPage 本地的 SourceRef 定义
```

- [ ] **Step 6: 删除本地 SourceRef 接口定义**

删除 ChatPage.tsx 中的本地 `SourceRef` 接口定义和 `formatSize` 辅助函数（两者均已在 SourceCard.tsx 中定义和 export）。

- [ ] **Step 7: 替换来源渲染区域**

将旧的 Popover+Tag 方案替换为 SourceCard + DocumentDetailDrawer：

```tsx
{/* 替换旧的 displaySources 区块 */}
{displaySources.length > 0 && (
  <div className="chat-sources">
    <div className="chat-sources-header">
      <span>📎 参考来源</span>
      <span className="chat-sources-hint">· 以下文档为该回答提供了参考依据</span>
    </div>
    <div className="chat-sources-cards">
      {displaySources.map((s) => (
        <SourceCard
          key={`${s.docId}-${s.index}`}
          source={s}
          onClick={() => setSourceDetailDocId(s.docId)}
        />
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 8: 页面底部添加 DocumentDetailDrawer**

在 ChatPage 的 return 语句最后（`</main>` 后、外层 `</div>` 前）添加：

```tsx
<DocumentDetailDrawer
  open={!!sourceDetailDocId}
  docId={sourceDetailDocId}
  onClose={() => setSourceDetailDocId(null)}
/>
```

- [ ] **Step 9: 编译验证**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: exit code 0，无类型错误。

---

### Task 5: Frontend — 添加来源卡片样式

**Files:**
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `.source-card`, `.source-card-body`, `.source-card-name`, `.source-card-type`, `.source-card-arrow` 等 CSS class
- Produces: 来源卡片视觉样式

- [ ] **Step 1: 添加来源卡片样式到 global.css**

```css
/* 来源卡片区域 */
.chat-sources {
  margin-top: 12px;
}
.chat-sources-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #8b8b8b;
}
.chat-sources-hint {
  font-size: 11px;
  color: #bbb;
}
.chat-sources-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 来源卡片 */
.source-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 0.2s;
  max-width: 260px;
}
.source-card:hover {
  border-color: #1677ff;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08);
}
.source-card-body {
  min-width: 0;
  flex: 1;
}
.source-card-name {
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #262626;
}
.source-card-size {
  color: #999;
  font-size: 11px;
  margin-top: 1px;
}
.source-card-arrow {
  color: #bbb;
  font-size: 12px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: 确认无样式冲突**

检查 `.chat-sources` 是否已在 `global.css` 中存在（可能之前有旧的定义），确保无冲突。

---

### Task 6: 全量编译验证 + 清理

**Files:**
- 验证所有改动的文件

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

- [ ] **Step 3: 确认 import 清理**

确认 ChatPage.tsx 中没有未使用的 import（`Popover`, `Descriptions`, `Spin`, `Tag` 如不再使用需清理）。

- [ ] **Step 4: 确认 ChatPage.tsx 中无重复定义**

确认 `formatSize` 函数和 `SourceRef` 接口在 ChatPage.tsx 中已正确删除或从 SourceCard 导入，无重复定义。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/rag/state.ts \
        apps/server/src/modules/rag/nodes/generate.ts \
        apps/web/src/hooks/useSSE.ts \
        apps/web/src/components/chat/SourceCard.tsx \
        apps/web/src/pages/chat/ChatPage.tsx \
        apps/web/src/styles/global.css
git commit -m "feat(chat): AI 回答来源展示 — 纯净回答 + 类型图标卡片 + 文档详情抽屉"
```
