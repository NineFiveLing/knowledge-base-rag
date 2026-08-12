# Langfuse 监控简化（OTel 自动插桩 + LangfuseSpanProcessor）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Langfuse 追踪从 OTLP 导出 + 手动 CallbackHandler 封装，简化为单个 `@opentelemetry/sdk-node` + `LangfuseSpanProcessor` 自动插桩，密钥配置在处理器上，一次 RAG 查询在指定 Langfuse 项目呈现完整 trace。

**Architecture:** 全局 OTel provider 上注册 `LangfuseSpanProcessor`（密钥归属指定项目）。`CallbackHandler`（`@langfuse/langchain`）生成的 `langfuse-sdk` 作用域 span 与 `getNodeAutoInstrumentations()` 采集的基础设施 span 都走该 provider；SpanProcessor 默认过滤只导出 RAG/LLM span。`LangfuseService` 精简为仅评测 REST client，`rag.service.ts` 内联创建 handler。

**Tech Stack:** NestJS 11、@opentelemetry/sdk-node@0.221、@opentelemetry/auto-instrumentations-node@0.79、@langfuse/otel@5.10.0、@langfuse/langchain@5.10.0、Jest。

## Global Constraints

- OTel v2 版本线（与 `@langfuse/otel@5.10.0` peer 匹配）：`@opentelemetry/sdk-node@^0.221.0`、`@opentelemetry/auto-instrumentations-node@^0.79.0`、`@opentelemetry/core@2.10.0`（peer 自动解析）。
- `@langfuse/otel@^5.10.0` 为直接依赖。
- 追踪门控环境变量为 `LANGFUSE_PUBLIC_KEY`；不再使用 `OTEL_EXPORTER_OTLP_ENDPOINT`。
- 所有注释、提交信息使用简体中文。
- 每个任务完成后运行测试并提交，提交需用户审查确认。

---

### Task 1: 依赖升级 + instrumentation.ts 重写 + env 清理

**Files:**
- Modify: `apps/server/package.json`（dependencies 区块）
- Modify: `apps/server/src/instrumentation.ts`（整文件重写，副作用导入风格）
- Modify: `apps/server/src/instrumentation.spec.ts`（整文件重写）
- Modify: `apps/server/src/main.ts`（改为顶部 `import './instrumentation'`）
- Modify: `apps/server/src/cli.ts`（改为顶部 `import './instrumentation'`）
- Modify: `.env.example`（移除 OTEL 变量区块）

**Interfaces:**
- Consumes: 无（独立任务）。
- Produces: `getOTelSdk(): NodeSDK | null`、`shutdownOTel(): Promise<void>`（副作用导入：模块加载即 self-start；后续任务与入口依赖）。

- [ ] **Step 1: 更新 `apps/server/package.json` 依赖（先新增，暂不删除旧包）**

在 `dependencies` 中执行以下变更：
- **新增**：`"@langfuse/otel": "^5.10.0"`（放在 `@langfuse/langchain` 之后）、`"@opentelemetry/auto-instrumentations-node": "^0.79.0"`（放在 `@langfuse/otel` 之后）
- **升级**：`"@opentelemetry/sdk-node": "^0.54.0"` → `"^0.221.0"`
- **旧包暂留**：`@opentelemetry/exporter-trace-otlp-http` 等 7 个旧包暂不删除（Step 6 再移除），保证重写前的 `instrumentation.ts` 可编译，TDD 红灯是真实断言失败而非编译错误

- [ ] **Step 2: 安装依赖**

Run: `pnpm install`（在仓库根目录）
Expected: 安装成功，无 peer 冲突。`@opentelemetry/core@2.10.0`、`@opentelemetry/exporter-trace-otlp-http@0.221.0` 被自动解析。

- [ ] **Step 3: 重写 `apps/server/src/instrumentation.spec.ts`（test first）**

用以下内容整体替换（`jest.resetModules()` 保证每个用例拿到全新的模块级 `sdk` 状态；副作用导入下通过 `getOTelSdk()` 断言 SDK 是否启动）：

```ts
describe('OTel Instrumentation Registration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not start SDK when LANGFUSE_PUBLIC_KEY is not set', async () => {
    const { getOTelSdk } = await import('./instrumentation');
    expect(getOTelSdk()).toBeNull();
  });

  it('should not start SDK when LANGFUSE_PUBLIC_KEY is empty string', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = '';
    const { getOTelSdk } = await import('./instrumentation');
    expect(getOTelSdk()).toBeNull();
  });

  it('should start SDK when LANGFUSE_PUBLIC_KEY is set', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = 'http://localhost:19999';

    const { getOTelSdk, shutdownOTel } = await import('./instrumentation');
    expect(getOTelSdk()).not.toBeNull();
    await shutdownOTel();
  });
});
```

- [ ] **Step 4: 运行 instrumentation spec 确认失败（红）**

Run: `cd apps/server && npx jest src/instrumentation.spec.ts --verbose`
Expected: FAIL。注：jest 29 不识别 `-v`，用 `--verbose`。

**重要——红灯形态（已实测）**：若 sdk-node 已升级到 v2 而旧 `instrumentation.ts`（引 v1 `@opentelemetry/resources`/`exporter-trace-otlp-http`）仍在，ts-jest 全量类型检查下 3 个用例会以**编译/转译失败**报错（错误体为空），而非干净的断言失败。这是 v1/v2 撕裂的直接后果，Step 5 重写后即消除。此时用 `ts-node --transpile-only` 验证运行时行为符合预测（无 OTEL 端点时旧实现返回 `null` → 前两用例过、第三用例 `expect(sdk).not.toBeNull()` 断言失败），即红灯逻辑成立。若先跑红灯再升级依赖，则可得干净断言失败。

- [ ] **Step 5: 重写 `apps/server/src/instrumentation.ts`（副作用导入风格）**

用以下内容整体替换（模块加载即 self-start，无 `registerOTel` 导出）：

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

/**
 * OpenTelemetry 自动插桩（LangfuseSpanProcessor 导出）
 * 模块加载即执行（副作用导入）：main.ts / cli.ts 顶部 `import './instrumentation'` 即可
 * 未配置 LANGFUSE_PUBLIC_KEY 时优雅降级（不启动 SDK，不抛异常）
 */
const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
let sdk: NodeSDK | null =
  publicKey && publicKey.trim() !== ''
    ? new NodeSDK({
        spanProcessors: [
          new LangfuseSpanProcessor({
            publicKey,
            secretKey: process.env.LANGFUSE_SECRET_KEY,
            baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
            environment: process.env.NODE_ENV || 'development',
          }),
        ],
        instrumentations: [getNodeAutoInstrumentations()],
      })
    : null;

sdk?.start();

/**
 * 获取当前 OTel SDK 实例（测试钩子；未初始化时为 null）
 */
export function getOTelSdk(): NodeSDK | null {
  return sdk;
}

/**
 * 关闭 OTel SDK
 */
export async function shutdownOTel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
```

**同步更新入口（同属 Step 5）**：

`apps/server/src/main.ts` —— 删除 `import { registerOTel } from './instrumentation';`（原第 5 行），删除 bootstrap 内 `registerOTel();`（原第 13 行），并在文件**最顶部**（第 1 行，早于 `@nestjs/core` 等所有 import）添加副作用导入：

```ts
import './instrumentation';
```

`apps/server/src/cli.ts` —— 同样删除 `registerOTel` import 与调用（原第 3、11 行），最顶部添加 `import './instrumentation';`。

（OTel 要求 instrumentation 作为第一个 import，确保自动插桩在业务库加载前生效。）

- [ ] **Step 6: 从 `apps/server/package.json` 移除 7 个旧包**

删除：`@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-ioredis`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-pg`、`@opentelemetry/resources`、`@opentelemetry/semantic-conventions`

- [ ] **Step 7: 安装依赖（移除旧包后）**

Run: `pnpm install`（仓库根）
Expected: 安装成功。`@opentelemetry/auto-instrumentations-node@0.79` 内置 express/pg/mongodb/ioredis/nestjs-core/http 插桩，满足 `@langfuse/otel` 的 OTel v2 peer 要求。

- [ ] **Step 8: 运行 instrumentation spec 确认通过（绿）**

Run: `cd apps/server && npx jest src/instrumentation.spec.ts -v`
Expected: PASS（3 个用例全过）。

- [ ] **Step 9: 清理 `.env.example`**

删除以下三行：
```
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAME=knowledge-base-rag-server
OTEL_ENVIRONMENT=development
```
在 LangFuse 区块末尾追加一行说明：
```
# 监控通过 @opentelemetry/sdk-node + LangfuseSpanProcessor 自动插桩，
# 密钥配置见上（LANGFUSE_*），无需设置 OTEL_EXPORTER_OTLP_ENDPOINT
```

- [ ] **Step 10: 整体编译验证**

Run: `cd apps/server && pnpm build`（根目录无 build 脚本；server 的 build 为 `nest build`）
Expected: 本次变更文件（`instrumentation.ts`、`instrumentation.spec.ts`）无类型错误。注意：`nest build` 在 HEAD 上即因既有 spec/test 辅助文件类型错误失败（`langfuse-eval.service.spec.ts`、`src/test/faithfulness-*.ts` 等，已用 git stash 验证为 HEAD 基线问题、与本次变更无关）；Build 输出中确认这些基线错误以外的 error 均不含本次变更文件即可。另确认无残留 `@opentelemetry/exporter-trace-otlp-http` / `@opentelemetry/resources` / `semantic-conventions` / 旧 `instrumentation-*` 的 import。

- [ ] **Step 11: 提交**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/instrumentation.ts apps/server/src/instrumentation.spec.ts apps/server/src/main.ts apps/server/src/cli.ts .env.example
git commit -m "refactor: 切换 OTel 导出到 LangfuseSpanProcessor（自动插桩 + 依赖升级 v2）"
```

---

### Task 2: 精简 LangfuseService 为仅评测 REST client

**Files:**
- Modify: `apps/server/src/common/observability/langfuse.service.ts`
- Modify: `apps/server/src/common/observability/langfuse.service.spec.ts`
- Modify: `apps/server/src/common/observability/observability.module.spec.ts`

**Interfaces:**
- Consumes: Task 1 的依赖就绪（本任务不直接依赖，但需在同一环境下编译）。
- Produces: `LangfuseService.getClient(): LangfuseAPIClient | null`（签名不变，`LangfuseEvalService` 继续依赖）；`getCallbackHandler()` **被删除**。

- [ ] **Step 1: 更新 `apps/server/src/common/observability/langfuse.service.ts`**

整体替换为：

```ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangfuseAPIClient } from '@langfuse/core';

/** LangFuse 评测 REST 客户端服务（追踪改由 OTel + CallbackHandler 内联处理） */
@Injectable()
export class LangfuseService implements OnModuleInit {
  private readonly logger = new Logger(LangfuseService.name);
  private langfuseClient: LangfuseAPIClient | null = null;

  constructor(private config: ConfigService) {
    this.initClient();
  }

  onModuleInit() {
    // 双重保障：生产环境生命周期钩子
    this.initClient();
  }

  private initClient() {
    const publicKey = this.config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.config.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl = this.config.get<string>('LANGFUSE_BASE_URL');

    if (!publicKey || publicKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_PUBLIC_KEY is empty. Eval disabled.');
      return;
    }

    if (!secretKey || secretKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_SECRET_KEY is empty. Eval disabled.');
      return;
    }

    try {
      this.langfuseClient = new LangfuseAPIClient({
        environment: () => process.env.NODE_ENV || 'development',
        baseUrl: baseUrl ? () => baseUrl : undefined,
        username: () => publicKey,
        password: () => secretKey,
      });
      this.logger.log(`LangFuse initialized: baseUrl=${baseUrl || 'https://cloud.langfuse.com'}`);
    } catch (error) {
      this.logger.error(`LangFuse initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * 获取 LangFuse REST Client 实例（用于评测 Dataset/Score API）
   * @returns LangfuseAPIClient 实例，未初始化时返回 null
   */
  getClient(): LangfuseAPIClient | null {
    return this.langfuseClient;
  }

  /**
   * 优雅关闭（v5 SDK 自行管理连接，此处为生命周期占位）
   */
  async shutdown() {
    this.logger.log('LangFuse shutdown requested (v5 SDK manages connections lazily)');
  }
}
```

- [ ] **Step 2: 更新 `apps/server/src/common/observability/langfuse.service.spec.ts`**

删除以下两个用例块（`getCallbackHandler` 已不存在）：
- 第 63–81 行的 `describe('getCallbackHandler', ...)` 整块
- 第 132–153 行的 `describe('onModuleInit', ...)` 块中调用 `getCallbackHandler` 的用例（该 describe 若只剩此用例则整块删除）

保留 `getClient` 相关用例（第 83–130 行）不变。更新后的文件仍应 mock `@langfuse/core` 的 `LangfuseAPIClient`（文件头部 `jest.mock` 保持不变）。

- [ ] **Step 3: 更新 `apps/server/src/common/observability/observability.module.spec.ts`**

将第 29 行：

```ts
expect(service.getCallbackHandler).toBeDefined();
```

改为：

```ts
expect(service.getClient).toBeDefined();
```

- [ ] **Step 4: 运行相关 spec 确认通过**

Run: `cd apps/server && npx jest src/common/observability -v`
Expected: PASS。`langfuse.service.spec.ts`、`observability.module.spec.ts` 全部通过（本任务为删除式重构，通过即验证新契约成立）。

- [ ] **Step 5: 确认评测服务不回归**

Run: `cd apps/server && npx jest src/modules/rag/langfuse-eval.service.spec.ts -v`
Expected: PASS（`LangfuseEvalService` 仅依赖 `getClient`，不受影响）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/common/observability/
git commit -m "refactor: 精简 LangfuseService 为仅评测 REST client"
```

---

### Task 3: rag.service 内联创建 CallbackHandler，移除 LangfuseService 依赖

**Files:**
- Modify: `apps/server/src/modules/rag/rag.service.ts`
- Modify: `apps/server/src/modules/rag/rag.module.ts`
- Modify: `apps/server/src/modules/rag/rag.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 删除了 `LangfuseService.getCallbackHandler()`（本任务随之不再调用它）。
- Produces: `RAGService` 新增私有方法 `createLangfuseHandler(opts: { userId: string; sessionId: string; conversationId?: string }): CallbackHandler | null`；`RAGService` 不再注入 `LangfuseService`。

- [ ] **Step 1: 重写 `apps/server/src/modules/rag/rag.service.spec.ts`**

整体替换为：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from './rag.service';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';
import { ConfigService } from '@nestjs/config';
import { Document } from '../document/entities/document.entity';

describe('RAGService - CallbackHandler Integration', () => {
  let service: RAGService;
  let mockSearch: jest.Mocked<SearchService>;
  let mockMemory: jest.Mocked<MemoryService>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key';
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key';
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';

    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'ALIYUN_API_KEY': return 'test-api-key';
          case 'ALIYUN_BASE_URL': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
          case 'MODEL_NAME': return 'deepseek-v4-flash-0731';
          case 'EMBEDDING_MODEL': return 'text-embedding-v2';
          default: return undefined;
        }
      }),
    } as any;

    mockSearch = {
      hybridSearch: jest.fn(),
      searchWithThreshold: jest.fn(),
    } as any;

    mockMemory = {
      buildPromptContext: jest.fn().mockResolvedValue({
        summary: '',
        history: '',
        systemContext: '',
      }),
      onMessage: jest.fn(),
    } as any;

    const mockDocRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: SearchService, useValue: mockSearch },
        { provide: MemoryService, useValue: mockMemory },
        { provide: 'DocumentRepository', useValue: mockDocRepo },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    await service.onModuleInit?.();
  });

  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  describe('createLangfuseHandler', () => {
    it('should create handler with tags when keys are set', () => {
      const handler = (service as any).createLangfuseHandler({
        userId: 'user-1',
        sessionId: 'session-1',
        conversationId: 'conv-1',
      });

      expect(handler).not.toBeNull();
      expect((handler as any).tags).toContain('userId:user-1');
      expect((handler as any).tags).toContain('sessionId:session-1');
      expect((handler as any).tags).toContain('conversationId:conv-1');
    });

    it('should return null when keys are not set', () => {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;

      const handler = (service as any).createLangfuseHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      expect(handler).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 运行 spec 确认失败（红）**

Run: `cd apps/server && npx jest src/modules/rag/rag.service.spec.ts -v`
Expected: FAIL —— `createLangfuseHandler` 尚不存在；且 `RAGService` 仍在构造函数注入 `LangfuseService` 而测试已移除该 provider，导致依赖解析失败。

- [ ] **Step 3: 修改 `apps/server/src/modules/rag/rag.service.ts`**

3.1 移除 import 与注入：

```ts
// 删除这行 import
import { LangfuseService } from "../../common/observability/langfuse.service";
```

```ts
// 构造函数中删除参数与字段
constructor(
  private config: ConfigService,
  private search: SearchService,
  private memory: MemoryService,
  @InjectRepository(Document) private docRepo: Repository<Document>,  // 原 langfuseService 参数删除
) {
```

3.2 新增私有辅助方法（放在 `embed()` 方法之前）：

```ts
/** 根据用户/会话上下文创建带标签的 Langfuse CallbackHandler；未配置密钥时静默降级 */
private createLangfuseHandler(opts: {
  userId: string;
  sessionId: string;
  conversationId?: string;
}): CallbackHandler | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    return null;
  }

  const tags = [`userId:${opts.userId}`, `sessionId:${opts.sessionId}`];
  const metadata: Record<string, unknown> = {
    userId: opts.userId,
    sessionId: opts.sessionId,
  };
  if (opts.conversationId) {
    tags.push(`conversationId:${opts.conversationId}`);
    metadata.conversationId = opts.conversationId;
  }

  return new CallbackHandler({
    userId: opts.userId,
    sessionId: opts.sessionId,
    tags,
    traceMetadata: metadata,
  });
}
```

3.3 修改 `query()`（原第 179–182 行）：

```ts
const langfuseHandler = this.createLangfuseHandler({ userId, sessionId });
```

3.4 修改 `streamQuery()`（原第 207–211 行）：

```ts
const langfuseHandler = this.createLangfuseHandler({ userId, sessionId, conversationId });
```

（`CallbackHandler` 的 import 已在文件头部保留。）

- [ ] **Step 4: 修改 `apps/server/src/modules/rag/rag.module.ts`**

```ts
imports: [SearchModule, MemoryModule, TypeOrmModule.forFeature([Document])],
```

删除 `ObservabilityModule` import 及其在 `imports` 数组中的条目。

- [ ] **Step 5: 运行 spec 确认通过（绿）**

Run: `cd apps/server && npx jest src/modules/rag/rag.service.spec.ts -v`
Expected: PASS（2 个用例全过）。

- [ ] **Step 6: 整体编译 + 相关测试**

Run: `pnpm build`（仓库根） → Expected: BUILD SUCCESS。
Run: `cd apps/server && npx jest src/modules/rag src/common/observability -v` → Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/modules/rag/
git commit -m "refactor: rag.service 内联创建 CallbackHandler，移除 LangfuseService 依赖"
```

---

### Task 4: 全量验证

**Files:** 无新增；仅在发现问题时修复对应文件。

- [ ] **Step 1: 运行 apps/server 全量测试**

Run: `cd apps/server && npx jest -v`
Expected: 全部 PASS（含 Task 1–3 更新的用例，以及 `langfuse-eval`、`rag`、`observability` 等既有用例）。

- [ ] **Step 2: 校验 openspec 变更**

Run: `openspec validate langfuse-monitoring-simplify`
Expected: `Change 'langfuse-monitoring-simplify' is valid`。

- [ ] **Step 3: 启动服务手动验证**

Run: `pnpm dev`（仓库根，或 `cd apps/server && pnpm start`），在 `apps/server/.env` 中配置真实 `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`。
Expected: 启动日志无 Langfuse/OTel 报错。

- [ ] **Step 4: 发起 RAG 查询并确认完整 trace**

向 `POST /api/rag/query`（或既有聊天接口）发起一次查询。
Expected: Langfuse 指定项目出现一条完整 trace，包含节点链（intent_classifier / retrieval / agent / generate_answer 等）、全部大模型调用、工具调用；HTTP/PG/Redis 基础设施 span 不出现。

- [ ] **Step 5: 验证优雅降级**

临时清空 `LANGFUSE_PUBLIC_KEY` 后重启服务并发起查询。
Expected: 服务正常运行、查询正常返回、无 Langfuse 相关报错、无追踪数据产生。

- [ ] **Step 6: 提交验证期修复（若有）并交付审查**

如有测试或编译修复，合并提交并说明。最终将本 change 的 openspec artifacts（`openspec/changes/langfuse-monitoring-simplify/`）一并提交，供用户审查。

```bash
git add openspec/changes/langfuse-monitoring-simplify/
git commit -m "docs: langfuse-monitoring-simplify change（proposal/design/spec/tasks）"
```
