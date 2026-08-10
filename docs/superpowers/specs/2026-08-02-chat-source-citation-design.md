# AI 聊天参考来源展示 — 设计文档

> **目标：** AI 回答文本纯净无引用标记 + 底部来源卡片（图标+文档名+大小）+ 点击查看详情

## 架构概述

**方案：** 纯净回答 + 底部来源卡片（Option B 变体）

**核心思路：**
1. 后端 prompt 优化：阻止 LLM 在回答中输出 `[citation:N]` 引用标记
2. 后端来源数据：sources 包含 `docName`（已有），无需新增字段
3. 前端来源渲染：紧凑型卡片（文件类型图标 + 文档名 + 大小），点击弹出详情

## 一、后端改动

### 1.1 Sources 数据补全 — 加 docType

**文件：** `apps/server/src/modules/rag/state.ts`

sources 类型新增 `docType` 字段：
```typescript
sources: Annotation<Array<{
  index: number;
  docId: string;
  chunkId: string;
  docName: string;
  docType: string;    // 新增
}>>
```

**文件：** `apps/server/src/modules/rag/nodes/generate.ts`

在 `docRepo.find()` 查询文档名时，同时获取 `type` 字段填充到 `docType`：
```typescript
const docNameMap = new Map<string, string>();
const docTypeMap = new Map<string, string>();  // 新增
// ...
for (const d of docs) {
  docNameMap.set(d.id, d.name);
  docTypeMap.set(d.id, d.type);   // 新增
}

const sources = deduped.map((c, i) => ({
  index: i + 1,
  docId: c.postgres_doc_id || '',
  chunkId: c.chunk_id || '',
  docName: docNameMap.get(c.postgres_doc_id || '') || '未知文档',
  docType: docTypeMap.get(c.postgres_doc_id || '') || 'text',  // 新增
}));
```

### 1.2 Prompt 优化 — 禁止行内引用

**问题：** 当前检索结果以 `[1] chunk内容` `[2] chunk内容` 格式喂给 LLM，LLM 自行模仿输出 `[citation:1]` 等引用标记。

**修复：** 移除 chunk 前的序号前缀，在 prompt 中明确禁止输出引用标记。

**文件：** `apps/server/src/modules/rag/nodes/generate.ts`

**改动点：**

```diff
- const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
- - 准确、简洁，涉及流程的用步骤式说明
- - 如果知识库内容不足，诚实说明
- - 用户明确记忆的信息优先使用`;

+ const ANSWER_PROMPT = `基于检索到的企业知识库内容回答用户问题。要求：
+ - 准确、简洁，涉及流程的用步骤式说明
+ - 如果知识库内容不足，诚实说明
+ - 用户明确记忆的信息优先使用
+ - 不要在回答中使用引用编号、来源标记或 [citation:N] 格式，直接输出答案内容`;

   // chunk 格式化：去掉序号前缀
-  contextParts.push(`## 检索结果\n${deduped.map((c, i) => `[${i + 1}] ${c.chunk_text}`).join('\n\n')}`);
+  contextParts.push(`## 检索结果\n${deduped.map((c) => `---\n${c.chunk_text}`).join('\n\n')}`);
```

### 1.2 Sources 数据（已完成）

当前 `generate.ts` 已返回带 `docName` 的 sources：
```typescript
{ index: number; docId: string; chunkId: string; docName: string }
```

无需额外改动。

### 1.3 SSE 流中 sources 的 yield

`chat.service.ts` 中 sources 通过 `<!-- SOURCES:...-->` 解析后 yield，逻辑不变。后端 `docName` 随 sources SSE 事件发送到前端。

## 二、前端改动

### 2.1 文件类型图标映射

创建 `apps/web/src/components/chat/SourceCard.tsx`

**类型 → 图标颜色映射：**

| 文件类型 | 缩写 | 颜色 | 包含扩展名 |
|----------|------|------|-----------|
| PDF | PDF | `#ff4d4f` 红 | pdf |
| Word | DOC | `#2f54eb` 蓝 | doc, docx |
| Excel | XLS | `#52c41a` 绿 | xls, xlsx, csv |
| PPT | PPT | `#fa8c16` 橙 | ppt, pptx |
| Markdown | MD | `#1677ff` 蓝 | md |
| Text | TXT | `#666` 灰 | txt |
| Image | IMG | `#eb2f96` 粉 | png, jpg, jpeg, gif |
| Audio | AUD | `#722ed1` 紫 | mp3, wav, ogg, m4a, flac, aac |
| Video | VID | `#722ed1` 紫 | mp4, avi, mov, mkv, webm, flv |
| 其他 | FILE | `#999` 灰 | 默认 |

**SourceCard 组件结构：**
```tsx
interface SourceCardProps {
  source: SourceRef;   // { index, docId, chunkId, docName, docType }
  onClick: () => void; // 查看详情回调
}
```

**卡片布局（横向紧凑型）：**
```
┌─────────────────────────────────┐
│ [SVG Icon]  文档名称.pdf    →  │
│             856 KB              │
└─────────────────────────────────┘
```
- 图标：22×22 SVG 方形 icon，颜色按类型
- 文件名：`font-weight:500`，单行截断 `text-overflow:ellipsis`
- 大小：灰色 11px 副文字
- 右侧 `→` 箭头暗示可点击
- Hover：`border-color` 变为蓝色 + `box-shadow` 微阴影
- 最大宽度 260px，卡片可换行

### 2.2 ChatPage 改动

**文件：** `apps/web/src/pages/chat/ChatPage.tsx`

**改动点：**

1. 移除 `Popover`/`Descriptions` 来源卡片实现（当前的复杂 Popover 方案）
2. 替换来源渲染区域为 `<SourceCard>` 组件列表
3. 新增 `sourceDetailDocId` state，点击来源卡片时设置
4. 页面内嵌 `DocumentDetailDrawer`（复用已有组件），点击来源卡片时打开

**来源区域渲染：**
```tsx
{displaySources.length > 0 && (
  <div className="chat-sources">
    <div className="chat-sources-header">
      <span>📎 参考来源</span>
      <span className="chat-sources-hint">· 以下文档为该回答提供了参考依据</span>
    </div>
    <div className="chat-sources-cards">
      {displaySources.map((s) => (
        <SourceCard
          key={s.index}
          source={s}
          onClick={() => setSourceDetailDocId(s.docId)}
        />
      ))}
    </div>
  </div>
)}
```

4. 页面底部添加 `DocumentDetailDrawer`：
```tsx
<DocumentDetailDrawer
  open={!!sourceDetailDocId}
  docId={sourceDetailDocId}
  onClose={() => setSourceDetailDocId(null)}
/>
```

### 2.3 样式

在 `apps/web/src/styles/global.css` 中添加来源卡片相关样式：

```css
.chat-sources { margin-top: 12px; }
.chat-sources-header { display:flex; align-items:center; gap:6px; margin-bottom:8px; font-size:12px; color:#8b8b8b; }
.chat-sources-hint { font-size:11px; color:#bbb; }
.chat-sources-cards { display:flex; flex-wrap:wrap; gap:8px; }

.source-card {
  display:flex; align-items:center; gap:10px;
  background:#fafafa; border:1px solid #f0f0f0; border-radius:8px;
  padding:8px 14px; cursor:pointer; transition:all .2s;
  max-width:260px;
}
.source-card:hover { border-color:#1677ff; box-shadow:0 2px 8px rgba(22,119,255,.08); }
.source-card-icon { font-size:22px; flex-shrink:0; }
.source-card-body { min-width:0; flex:1; }
.source-card-name { font-weight:500; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#262626; }
.source-card-size { color:#999; font-size:11px; margin-top:1px; }
.source-card-arrow { color:#bbb; font-size:12px; flex-shrink:0; }
```

## 三、交互流程

```
用户提问
    ↓
后端 RAG 检索 → LLM 生成回答（无引用标记）
    ↓
SSE 推送：text token（纯净文本）+ sources 事件
    ↓
前端渲染：纯净回答气泡 + 底部来源卡片列表
    ↓
用户点击来源卡片
    ↓
打开 DocumentDetailDrawer（复用已有组件）
展示文档详情 + 原文件预览
```

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/modules/rag/nodes/generate.ts` | 修改 | Prompt 禁止引用标记 + chunk 格式去除序号 |
| `apps/web/src/components/chat/SourceCard.tsx` | 新建 | 来源卡片组件（文件类型图标 + 文件名 + 大小） |
| `apps/web/src/pages/chat/ChatPage.tsx` | 修改 | 替换来源渲染 + 集成 DocumentDetailDrawer |
| `apps/web/src/styles/global.css` | 修改 | 来源卡片样式 |

## 五、不变的部分

- SSE 流式传输逻辑不变
- sources 数据结构变为（`{index, docId, chunkId, docName, docType}`）
- `DocumentDetailDrawer` 组件复用，不改动
- `useSSE` hook 不变
- 后端 RAG graph 路由逻辑不变
