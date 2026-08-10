# 合并测试文档 + 后续优化计划 — 设计方案

> 日期：2026-07-30
> 状态：已确认
> 前置：4 层 17 任务 SDD 执行完成

---

## 一、合并测试文档

### 目标

将原有 15 模块手动测试 + 新增 17 任务功能合并为一份完整测试文档，每条用例包含 curl/操作步骤 + 预期结果 + 验证点，覆盖正常路径 + 关键边界/错误场景。

### 结构（6 部分、25 子模块）

```
第一部分：环境与基础设施
  1.1 Docker 10 服务启动验证
  1.2 环境变量检查
  1.3 后端/前端启动验证

第二部分：认证与权限（Task 4.1 RBAC）
  2.1 用户注册 + 类校验
  2.2 用户登录 + JWT 结构（含 roles/permissions）
  2.3 Token 刷新 / 过期处理
  2.4 GET /auth/me 当前用户
  2.5 RBAC 角色管理 CRUD（8 端点）
  2.6 权限守卫 @RequirePermission
  2.7 数据级权限隔离（dept_id + visibility）
  2.8 未认证/越权访问拒绝

第三部分：文档生命周期（Task 1.1/1.2/1.3/3.2/4.3/4.5）
  3.1 上传 9 种格式（pdf/docx/md/txt/xlsx/pptx/img/audio/video）
  3.2 上传校验（类型/大小/未登录）
  3.3 文档列表（分页/状态筛选/类型筛选/关键词搜索/部门权限）
  3.4 文档详情查询
  3.5 Markdown 预览（GET /:id/preview）
  3.6 级联删除（6 存储后端清理验证）
  3.7 重新索引（clearIndexes → triggerIndex → 状态变更）
  3.8 索引触发（手动 API + BullMQ 异步队列）
  3.9 多模态图文处理（图片描述注入 chunk_text）
  3.10 上传后处理状态流转（PARSED→INDEXING→INDEXED/FAILED）

第四部分：检索与索引（Task 1.1/1.4/2.1/2.3）
  4.1 PGVector 向量写入验证（chunks 表 embedding 字段）
  4.2 Elasticsearch 索引验证（全文检索 + IK 分词）
  4.3 Neo4j 图索引验证（实体/关系/Chunk 节点）
  4.4 混合检索 RRF 融合（PGVector + ES + Neo4j）
  4.5 Cross-Encoder Reranker 精排（原始分数 vs 精排分数）
  4.6 阈值降级（低相似度 → 空结果提示）
  4.7 检索缓存（Redis 缓存命中/过期/TTL）
  4.8 检索降级容错（PGVector 不可用时 ES-only）

第五部分：RAG 对话引擎（Task 2.2/2.4/3.1/3.3）
  5.1 意图分类验证（chat/simple/complex/followup 四类路由）
  5.2 闲聊/记住直接回答（directAnswer 路径）
  5.3 简单检索问答（simple_retrieval → generate）
  5.4 Agent ReAct 复杂问答（多工具调用 + 多轮推理）
  5.5 追问降级检测（指代消解 → 直接回答）
  5.6 检索来源标注（SSE 事件含 sources）
  5.7 SSE 流式输出（Token 级 + [DONE] 结束）
  5.8 多模态图文检索（含图片的文档 → 图片描述参与检索）
  5.9 分层记忆（Redis 短期 16 条 + Mem0 长期）+ 记住功能
  5.10 LLM 重试机制（429/5xx/网络错误 → 指数退避 3 次）
  5.11 全局异常过滤器（统一 {code, message, traceId, timestamp}）

第六部分：可观测与运维（Task 2.5/3.1/4.2/4.4）
  6.1 LangFuse 追踪链路（trace→span→generation 层级）
  6.2 LangFuse Trace ID 桥接（state.langfuseTraceId）
  6.3 统计仪表盘（概览/文档/用户 端点）
  6.4 语音 WebSocket（连接/断开/audio 事件/ASR/TTS 占位）
  6.5 评测脚本（30 条用例执行/关键词召回率/首 Token 延迟）
  6.6 前端页面交互（角色管理/仪表盘/文档管理/语音按钮/权限组件）
```

### 用例格式

```
### N.M 用例名称
**请求**：curl 命令 或 浏览器操作步骤
**预期结果**：HTTP 状态码 + 响应 JSON 或 UI 变化
**验证点**：数据库查询 / 日志检查 / 副作用验证
**错误场景**（如有）：异常输入 → 预期错误响应
```

---

## 二、后续优化计划

### 范围：高价值低风险（12 项）

### 🔴 缺陷修复（5 项）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| B-1 | eval.ts [DONE] break 仅跳出内层 for 循环，外层 while(true) 永不终止 | scripts/eval/eval.ts:66 | 评测脚本可能挂死 |
| B-2 | clearIndexes 与 reindex 之间无状态锁，并发调用可能重复索引 | document.service.ts | 数据冗余 |
| B-3 | 首次 Token 延迟未计入 LangFuse span metrics | chat.service.ts | 观测数据不完整 |
| B-4 | 意图分类 prompt 缺少 few-shot 示例，分类准确率未评估 | nodes/intent.ts | 分类质量未知 |
| B-5 | 检索缓存 key 未包含 searchOptions（ES/Neo4j 开关），不同配置可能命中同一缓存 | search.service.ts | 缓存错误 |

### 🟡 技术债务清理（4 项）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| T-1 | any 类型泛滥（graph.ts 参数列表、rag.service.ts state、retrieval.ts JSON.parse） | 多文件 | 类型安全缺失 |
| T-2 | 模型名称 'deepseek-chat' 硬编码在 rag.service.ts 中 | rag.service.ts:34 | 模型切换需改代码 |
| T-3 | retry.util.ts 使用 console.warn 而非 NestJS Logger | retry.util.ts | 日志格式不统一 |
| T-4 | SSE 事件负载类型（sources/text/done）未在前后端共享 | useSSE.ts + chat.service.ts | 类型不一致风险 |

### 🟢 关键缺失补强（3 项）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| M-1 | directAnswer 路径未记录 LangFuse generation | rag.service.ts:76-79 | 闲聊/记住类对话无追踪 |
| M-2 | 零自动化测试基础设施（无 jest/vitest 配置、无测试依赖、无 CI） | 全局 | 回归风险高 |
| M-3 | 评测脚本需手动执行，未集成 CI/前置 hook | scripts/eval/ | 每次发版需手动跑 |

### 预估工时

| 类别 | 项数 | 预估 |
|------|------|------|
| 🔴 缺陷修复 | 5 | 3h |
| 🟡 技术债务 | 4 | 4h |
| 🟢 关键缺失 | 3 | 6h |
| **合计** | **12** | **13h** |

---

## 三、执行方式

- 测试文档：直接编写一份合并的 `docs/完整测试指南.md`
- 优化计划：使用 writing-plans → subagent-driven-development 执行
