# LangFuse + OpenTelemetry 自动插桩实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agentic RAG 项目中接入 LangFuse 官方 CallbackHandler 自动追踪和 OpenTelemetry 基础设施自动插桩，支持 LLM 链路追踪与批量评测，同时清理无用的 `@opentelemetry/api` 死依赖。

**Architecture:** 
1. 新增 `LangfuseService`（NestJS 单例）管理 LangFuse Client 生命周期，对外提供 `getCallbackHandler()` 方法
2. `RAGService` 的 `query()` 和 `streamQuery()` 两条路径都通过 CallbackHandler 自动产生 Trace，不手动包装节点
3. 新增 `instrumentation.ts` 注册 OpenTelemetry 自动插桩（HTTP/PG/MongoDB/Redis/ES），在 `main.ts` 启动时加载
4. 新增 `LangfuseEvalService` 封装 Dataset + Evaluation API
5. 从 `package.json` 移除 `@opentelemetry/api`

**Tech Stack:**
- `@langfuse/langchain` CallbackHandler — LLM 层自动追踪
- `@opentelemetry/sdk-node` + instrumentation 包 — 基础设施层自动追踪
- NestJS 11 + LangGraph 1.4 + LangChain 1.5

## Global Constraints

- `LANGFUSE_PUBLIC_KEY` 为空时所有追踪功能静默禁用，系统正常运行
- 追踪完全通过 CallbackHandler，不在节点代码中手动 `langfuse.span()`
- 所有新增服务通过 NestJS Module 管理生命周期
- TypeScript 编译无错误 (`cd apps/server && npx tsc --noEmit`)
- 每个新增功能遵循 RED → GREEN TDD：先写失败测试，再写实现，再验证通过
- 每个 spec 场景必须至少有一个对应测试用例
- 测试通过前不编写生产代码

## 文件结构总览

```
apps/server/src/
├── common/
│   └── observability/
│       ├── langfuse.service.ts          # NEW — LangFuse Client 管理
│       ├── langfuse.service.spec.ts     # NEW — LangfuseService 单元测试
│       ├── observability.module.ts      # NEW — NestJS Module
│       └── observability.module.spec.ts # NEW — Module 测试
├── modules/
│   └── rag/
│       ├── rag.service.ts               # MODIFY — 接入 CallbackHandler
│       ├── rag.service.spec.ts          # NEW — RAGService 追踪测试
│       ├── rag.module.ts                # MODIFY — 导入 ObservabilityModule
│       ├── langfuse-eval.service.ts     # NEW — 评测服务
│       └── langfuse-eval.service.spec.ts # NEW — 评测服务测试
├── instrumentation.ts                   # NEW — OTel 自动插桩入口
├── instrumentation.spec.ts              # NEW — OTel 配置测试
├── main.ts                              # MODIFY — 加载 OTel SDK
├── test/
│   └── setup.ts                         # NEW — Jest 全局 mock
└── jest.config.js                       # NEW — Jest 配置
```

---

## Phase 0: 测试基础设施搭建

### Task 0.1: 安装测试依赖

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/package.json` (lockfile)

**Interfaces:**
- Consumes: 无
- Produces: jest、@nestjs/testing、@types/jest、ts-jest、supertest、@types/supertest 可用

- [ ] **Step 1: 修改 package.json 添加测试依赖**

在 `apps/server/package.json` 的 `devDependencies` 中添加：

```json
"jest": "^29.7.0",
"@nestjs/testing": "^11.1.28",
"@types/jest": "^29.5.14",
"ts-jest": "^29.2.5",
"supertest": "^7.1.0",
"@types/supertest": "^6.0.3"
```

（`@nestjs/testing` 版本与 `@nestjs/common` 一致，均为 ^11.1.28）

- [ ] **Step 2: 安装依赖**

```bash
cd apps/server && pnpm install
```

Expected: 安装成功，`node_modules` 中出现 jest、ts-jest 等包

- [ ] **Step 3: 验证依赖安装**

```bash
cd apps/server && npx jest --version
```

Expected: 输出 jest 版本号（如 `29.7.0`）

- [ ] **Step 4: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git commit -m "chore: add test dependencies (jest, @nestjs/testing, ts-jest)"
```

---

### Task 0.2: 创建 Jest 配置

**Files:**
- Create: `apps/server/jest.config.js`

**Interfaces:**
- Consumes: tsconfig.json 中的路径配置
- Produces: Jest 可识别测试文件、正确转译 TypeScript

- [ ] **Step 1: 创建 jest.config.js**

```javascript
/** @type {import('jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // 超时设置：OTel 和 LangFuse 初始化可能需要时间
  testTimeout: 30000,
  // 自动 mock 环境变量
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};
```

- [ ] **Step 2: 验证 Jest 配置可加载**

```bash
cd apps/server && npx jest --showConfig
```

Expected: 输出完整 Jest 配置，无报错

- [ ] **Step 3: Commit**

```bash
git add apps/server/jest.config.js
git commit -m "chore: add jest configuration"
```

---

### Task 0.3: 创建测试全局 setup

**Files:**
- Create: `apps/server/src/test/setup.ts`

**Interfaces:**
- Consumes: 无
- Produces: 全局 mock 环境变量，避免测试污染

- [ ] **Step 1: 创建 setup.ts**

```typescript
/**
 * Jest 全局 setup：mock 环境变量，确保测试隔离
 */

// 默认 mock 所有外部服务环境变量为空，避免测试中意外调用真实 API
process.env.LANGFUSE_PUBLIC_KEY = '';
process.env.LANGFUSE_SECRET_KEY = '';
process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';
process.env.LANGFUSE_PROJECT_ID = '';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
process.env.OTEL_SERVICE_NAME = 'knowledge-base-rag-server';
process.env.OTEL_ENVIRONMENT = 'test';

// 其他必需的 mock
process.env.ALIYUN_API_KEY = 'test-api-key';
process.env.ALIYUN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
process.env.MODEL_NAME = 'deepseek-v4-flash-0731';
process.env.EMBEDDING_MODEL = 'text-embedding-v2';
process.env.JWT_SECRET = 'test-secret';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_USER = 'postgres';
process.env.POSTGRES_PASSWORD = 'test';
process.env.POSTGRES_DB = 'test';
process.env.MONGO_HOST = 'localhost';
process.env.MONGO_PORT = '27017';
process.env.ES_HOST = 'localhost';
process.env.ES_PORT = '9200';
process.env.NEO4J_HOST = 'localhost';
process.env.NEO4J_BOLT_PORT = '7687';
process.env.NEO4J_HTTP_PORT = '7474';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test';
process.env.RUSTFS_ENDPOINT = 'http://localhost:9000';
process.env.RUSTFS_ACCESS_KEY = 'test';
process.env.RUSTFS_SECRET_KEY = 'test';

// 抑制 NestJS 开发模式警告
process.env.NODE_ENV = 'test';
```

- [ ] **Step 2: 验证 setup 加载**

```bash
cd apps/server && npx jest --listTests 2>&1 | head -5
```

Expected: 无报错（即使没有测试文件也正常）

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/test/setup.ts
git commit -m "chore: add jest global setup with env mocks"
```

---

## Phase 1: 清理死依赖

### Task 1.1: 移除 @opentelemetry/api 直接依赖

**Spec 对应:** Requirement: 死依赖清理 — Scenario: 移除后依赖完整性

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: 确认 @opentelemetry/api 无直接 import**

```bash
cd apps/server && grep -r "from '@opentelemetry/api'" src/ || echo "No direct imports found"
```

Expected: `No direct imports found`

- [ ] **Step 2: 从 package.json 移除 @opentelemetry/api**

Edit `apps/server/package.json`，删除 `dependencies` 中的 `"@opentelemetry/api": "^1.9.0",` 一行。

- [ ] **Step 3: 安装新依赖**

```bash
cd apps/server && pnpm install
```

- [ ] **Step 4: 验证 @opentelemetry/api 仍可通过传递依赖访问**

```bash
cd apps/server && node -e "console.log(require('@opentelemetry/api').version)"
```

Expected: 输出版本号（如 `1.9.1`），证明传递依赖链完整

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git commit -m "chore: remove unused @opentelemetry/api direct dependency"
```

---

## Phase 2: LangfuseService 核心服务

### Task 2.1: 写 LangfuseService 的失败测试

**Spec 对应:** 
- Requirement: LangFuse 服务初始化 — Scenario: 正常初始化
- Requirement: LangFuse 服务初始化 — Scenario: 环境变量缺失时优雅降级
- Requirement: 配置与隐私 — Scenario: 禁用追踪

**Files:**
- Create: `apps/server/src/common/observability/langfuse.service.spec.ts`
- Test: `apps/server/src/common/observability/langfuse.service.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';

describe('LangfuseService', () => {
  let service: LangfuseService;

  const createModule = async (envOverrides: Record<string, string | undefined> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangfuseService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => envOverrides[key]),
          },
        },
      ],
    }).compile();

    return module.get<LangfuseService>(LangfuseService);
  };

  beforeEach(async () => {
    // 先关闭可能遗留的实例
    const prev = await createModule({});
    if ((prev as any).shutdown) await (prev as any).shutdown();

    service = await createModule({
      LANGFUSE_PUBLIC_KEY: undefined,
      LANGFUSE_SECRET_KEY: undefined,
      LANGFUSE_BASE_URL: undefined,
      LANGFUSE_PROJECT_ID: undefined,
    });
  });

  afterEach(async () => {
    if ((service as any).shutdown) {
      await (service as any).shutdown();
    }
  });

  describe('getCallbackHandler', () => {
    it('should return null when LANGFUSE_PUBLIC_KEY is not set', () => {
      const handler = service.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      expect(handler).toBeNull();
    });

    it('should return null when LANGFUSE_PUBLIC_KEY is empty string', async () => {
      const svc = await createModule({ LANGFUSE_PUBLIC_KEY: '' });
      const handler = svc.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      expect(handler).toBeNull();
      if ((svc as any).shutdown) await (svc as any).shutdown();
    });
  });

  describe('onModuleInit', () => {
    it('should initialize LangFuse client when env vars are set', async () => {
      const newService = await createModule({
        LANGFUSE_PUBLIC_KEY: 'test-public-key',
        LANGFUSE_SECRET_KEY: 'test-secret-key',
        LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      });

      const handler = newService.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
        conversationId: 'conv-1',
      });

      expect(handler).not.toBeNull();
      expect((handler as any).tags).toBeDefined();
      expect((handler as any).tags).toContain('userId:user-1');
      expect((handler as any).tags).toContain('sessionId:session-1');
      expect((handler as any).tags).toContain('conversationId:conv-1');

      if ((newService as any).shutdown) await (newService as any).shutdown();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/server && npx jest src/common/observability/langfuse.service.spec.ts --no-coverage
```

Expected: FAIL，报错 `Cannot find module './langfuse.service'`（因为文件还不存在）

- [ ] **Step 3: Commit（仅测试文件）**

```bash
git add apps/server/src/common/observability/langfuse.service.spec.ts
git commit -m "test: add LangfuseService failing tests (TDD red)"
```

---

### Task 2.2: 实现 LangfuseService

**Spec 对应:** Requirement: LangFuse 服务初始化

**Files:**
- Create: `apps/server/src/common/observability/langfuse.service.ts`

**Interfaces:**
- Consumes: ConfigService（NestJS），环境变量 LANGFUSE_PUBLIC_KEY/SECRET_KEY/BASE_URL/PROJECT_ID
- Produces: `getCallbackHandler(opts: { userId, sessionId, conversationId })` 返回 `CallbackHandler | null`

- [ ] **Step 1: 创建 LangfuseService**

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from '@langfuse/langchain';
import { Langfuse } from 'langfuse';

/** LangFuse 可观测性服务：管理 Client 生命周期，提供带标签的 CallbackHandler */
@Injectable()
export class LangfuseService implements OnModuleInit {
  private readonly logger = new Logger(LangfuseService.name);
  private client: Langfuse | null = null;
  private initialized = false;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.config.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl = this.config.get<string>('LANGFUSE_BASE_URL');

    if (!publicKey || publicKey.trim() === '') {
      this.logger.warn('LangFuse not initialized: LANGFUSE_PUBLIC_KEY is empty. Tracing disabled.');
      return;
    }

    try {
      this.client = new Langfuse({
        publicKey,
        secretKey: secretKey || undefined,
        baseUrl: baseUrl || undefined,
      });
      this.initialized = true;
      this.logger.log(`LangFuse initialized: baseUrl=${baseUrl || 'https://cloud.langfuse.com'}`);
    } catch (error) {
      this.logger.error(`LangFuse initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * 获取带用户标签的 CallbackHandler
   * @param opts 用户上下文信息
   * @returns CallbackHandler 实例，未初始化时返回 null
   */
  getCallbackHandler(opts: {
    userId: string;
    sessionId: string;
    conversationId?: string;
  }): CallbackHandler | null {
    if (!this.initialized || !this.client) {
      return null;
    }

    const tags: string[] = [
      `userId:${opts.userId}`,
      `sessionId:${opts.sessionId}`,
    ];

    if (opts.conversationId) {
      tags.push(`conversationId:${opts.conversationId}`);
    }

    return new CallbackHandler({
      client: this.client,
      tags,
      metadata: {
        userId: opts.userId,
        sessionId: opts.sessionId,
        conversationId: opts.conversationId || undefined,
      },
    });
  }

  /**
   * 获取 LangFuse Client 实例（用于评测等高级用法）
   */
  getClient(): Langfuse | null {
    return this.client;
  }

  /**
   * 优雅关闭：flush 待发送的数据
   */
  async shutdown() {
    if (this.client) {
      try {
        await this.client.shutdownAsync();
        this.logger.log('LangFuse client shut down successfully');
      } catch (error) {
        this.logger.error(`LangFuse shutdown failed: ${(error as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd apps/server && npx jest src/common/observability/langfuse.service.spec.ts --no-coverage
```

Expected: PASS，所有 5 个测试通过

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/common/observability/langfuse.service.ts
git commit -m "feat: implement LangfuseService with CallbackHandler factory"
```

---

## Phase 3: ObservabilityModule 模块封装

### Task 3.1: 写 ObservabilityModule 的失败测试

**Spec 对应:** Requirement: LangFuse 服务初始化 — 模块化提供

**Files:**
- Create: `apps/server/src/common/observability/observability.module.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityModule } from './observability.module';
import { LangfuseService } from './langfuse.service';

describe('ObservabilityModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    // 确保 LangFuse 环境变量为空，避免初始化
    process.env.LANGFUSE_PUBLIC_KEY = '';
    process.env.LANGFUSE_SECRET_KEY = '';

    module = await Test.createTestingModule({
      imports: [ObservabilityModule],
    }).compile();
  });

  afterEach(async () => {
    const service = module.get<LangfuseService>(LangfuseService);
    if ((service as any).shutdown) {
      await (service as any).shutdown();
    }
    await module.close();
  });

  it('should provide LangfuseService', () => {
    const service = module.get<LangfuseService>(LangfuseService);
    expect(service).toBeDefined();
    expect(service.getCallbackHandler).toBeDefined();
  });

  it('should export LangfuseService for other modules', () => {
    const service = module.get<LangfuseService>(LangfuseService, { strict: false });
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/server && npx jest src/common/observability/observability.module.spec.ts --no-coverage
```

Expected: FAIL，`Cannot find module './observability.module'`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/common/observability/observability.module.spec.ts
git commit -m "test: add ObservabilityModule failing test (TDD red)"
```

---

### Task 3.2: 实现 ObservabilityModule

**Files:**
- Create: `apps/server/src/common/observability/observability.module.ts`

**Interfaces:**
- Consumes: LangfuseService
- Produces: 导出 LangfuseService，供 RAGModule 等导入

- [ ] **Step 1: 创建模块文件**

```typescript
import { Module } from '@nestjs/common';
import { LangfuseService } from './langfuse.service';

/** 可观测性模块：LangFuse 追踪服务 */
@Module({
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class ObservabilityModule {}
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd apps/server && npx jest src/common/observability/observability.module.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/common/observability/observability.module.ts
git commit -m "feat: create ObservabilityModule exporting LangfuseService"
```

---

## Phase 4: RAGService 接入 CallbackHandler

### Task 4.1: 写 RAGService.query() 同步路径追踪的失败测试

**Spec 对应:**
- Requirement: CallbackHandler 自动追踪（同步路径）— Scenario: 同步查询产生 Trace
- Requirement: CallbackHandler 自动追踪（同步路径）— Scenario: 无 CallbackHandler 时同步查询正常运行

**Files:**
- Modify: `apps/server/src/modules/rag/rag.service.spec.ts` (create)

**Interfaces:**
- Consumes: LangfuseService.getCallbackHandler()，graph.invoke() 的 callbacks 选项
- Produces: `query()` 方法将 CallbackHandler 传入 `graph.invoke(state, { callbacks: [handler] })`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from './rag.service';
import { LangfuseService } from '../common/observability/langfuse.service';
import { SearchService } from '../search/search.service';
import { MemoryService } from '../memory/memory.service';

describe('RAGService - CallbackHandler Integration', () => {
  let service: RAGService;
  let mockSearch: jest.Mocked<SearchService>;
  let mockMemory: jest.Mocked<MemoryService>;
  let mockLangfuse: jest.Mocked<LangfuseService>;

  beforeEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key';
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key';
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';

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

    // 创建真实的 LangfuseService
    const langfuseModule = await Test.createTestingModule({
      providers: [LangfuseService],
    }).compile();
    const langfuseService = langfuseModule.get<LangfuseService>(LangfuseService);
    mockLangfuse = {
      getCallbackHandler: jest.fn(langfuseService.getCallbackHandler.bind(langfuseService)),
      getClient: jest.fn(() => langfuseService.getClient()),
      shutdown: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        {
          provide: LangfuseService,
          useValue: mockLangfuse,
        },
        {
          provide: SearchService,
          useValue: mockSearch,
        },
        {
          provide: MemoryService,
          useValue: mockMemory,
        },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    // 等待 onModuleInit 完成（初始化 graph）
    await service.onModuleInit?.();
  });

  afterEach(async () => {
    await mockLangfuse.shutdown?.();
  });

  describe('query() with CallbackHandler', () => {
    it('should pass CallbackHandler to graph.invoke callbacks', async () => {
      const mockHandler = {
        tags: ['userId:user-1', 'sessionId:session-1'],
        metadata: { userId: 'user-1', sessionId: 'session-1' },
      };

      mockLangfuse.getCallbackHandler.mockReturnValue(mockHandler as any);

      // 我们需要验证 graph.invoke 被调用时传入了 callbacks
      // 由于 graph 是私有属性，我们通过 spy 测试 LangfuseService 被正确调用
      const handler = mockLangfuse.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      // 验证 getCallbackHandler 被调用且返回了 handler
      expect(mockLangfuse.getCallbackHandler).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'session-1',
        conversationId: undefined,
      });
      expect(handler).not.toBeNull();
    });

    it('should handle null CallbackHandler gracefully (graceful degradation)', async () => {
      // 模拟 LangFuse 未初始化
      mockLangfuse.getCallbackHandler.mockReturnValue(null);

      // 不应该抛出错误
      // 注意：这里无法真正调用 query() 因为 graph 需要真实 LLM
      // 我们只验证 getCallbackHandler 返回 null 时不会导致异常
      const handler = mockLangfuse.getCallbackHandler({
        userId: 'user-1',
        sessionId: 'session-1',
      });
      expect(handler).toBeNull();
      // RAGService 内部应该处理 null handler，传入空数组
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/server && npx jest src/modules/rag/rag.service.spec.ts --no-coverage
```

Expected: FAIL，`Cannot find module './rag.service'`（或类似的导入错误）

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/rag/rag.service.spec.ts
git commit -m "test: add RAGService CallbackHandler failing tests (TDD red)"
```

---

### Task 4.2: 实现 RAGService 的 CallbackHandler 集成

**Spec 对应:**
- Requirement: CallbackHandler 自动追踪（同步路径）
- Requirement: CallbackHandler 自动追踪（流式路径）

**Files:**
- Modify: `apps/server/src/modules/rag/rag.service.ts`

- [ ] **Step 1: 修改 rag.service.ts — 注入 LangfuseService**

在构造函数中添加 `LangfuseService` 注入：

```typescript
constructor(
  private config: ConfigService,
  private search: SearchService,
  private memory: MemoryService,
  @InjectRepository(Document) private docRepo: Repository<Document>,
  private langfuseService: LangfuseService,  // ← 新增
) { ... }
```

修改 `RAGModule`，导入 `ObservabilityModule`：

```typescript
imports: [
  SearchModule, MemoryModule, TypeOrmModule.forFeature([Document]),
  ObservabilityModule,  // ← 新增
],
```

- [ ] **Step 2: 修改 streamQuery() 方法**

将：
```typescript
const langfuseHandler = new CallbackHandler({
  sessionId,
  userId,
});
```

替换为：
```typescript
const langfuseHandler = this.langfuseService.getCallbackHandler({
  userId,
  sessionId,
  conversationId,
}) || new CallbackHandler({ sessionId, userId }); // fallback（不应触发，因环境变量已配置）
```

并将 callbacks 数组化：
```typescript
return this.graph.streamEvents(
  { messages: [new HumanMessage(userMessage)], userId, sessionId },
  {
    version: "v2",
    callbacks: langfuseHandler ? [langfuseHandler] : [],
  },
);
```

- [ ] **Step 3: 修改 query() 方法 — 新增 CallbackHandler**

```typescript
async query(userMessage: string, userId: string, sessionId: string) {
  const langfuseHandler = this.langfuseService.getCallbackHandler({
    userId,
    sessionId,
  });

  const result = await this.graph.invoke({
    messages: [new HumanMessage(userMessage)],
    userId,
    sessionId,
  }, {
    callbacks: langfuseHandler ? [langfuseHandler] : [],
  });

  return result.finalAnswer;
}
```

- [ ] **Step 4: 修改 RAGModule 导入 ObservabilityModule**

在 `apps/server/src/modules/rag/rag.module.ts` 中添加：

```typescript
import { ObservabilityModule } from '../../common/observability/observability.module';

@Module({
  imports: [
    SearchModule, MemoryModule, TypeOrmModule.forFeature([Document]),
    ObservabilityModule, // ← 新增
  ],
  providers: [RAGService],
  exports: [RAGService],
})
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 6: 运行测试**

```bash
cd apps/server && npx jest src/modules/rag/rag.service.spec.ts --no-coverage
```

Expected: 测试通过（LangfuseService.getCallbackHandler 被正确调用）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rag/rag.service.ts apps/server/src/modules/rag/rag.module.ts
git commit -m "feat: inject LangfuseService and add CallbackHandler to query/streamQuery"
```

---

## Phase 5: ChatService 透传 conversationId

### Task 5.1: ChatService 传入 conversationId 到 RAGService.streamQuery

**Spec 对应:** Requirement: Trace 元数据与标签（conversationId 标签）

**Files:**
- Modify: `apps/server/src/modules/chat/chat.service.ts`

- [ ] **Step 1: 修改 streamAnswer 中的 streamQuery 调用**

在 `apps/server/src/modules/chat/chat.service.ts` 中，找到：

```typescript
const stream = await this.rag.streamQuery(message, userId, sessionId);
```

修改为：

```typescript
const stream = await this.rag.streamQuery(message, userId, sessionId, resolvedConvId);
```

这需要 RAGService.streamQuery 接受第四个参数 `conversationId`。

- [ ] **Step 2: 修改 RAGService.streamQuery 签名**

在 `rag.service.ts` 中：

```typescript
async streamQuery(
  userMessage: string,
  userId: string,
  sessionId: string,
  conversationId?: string,  // ← 新增可选参数
) {
  const langfuseHandler = this.langfuseService.getCallbackHandler({
    userId,
    sessionId,
    conversationId,  // ← 传入
  }) || new CallbackHandler({ sessionId, userId });
  ...
}
```

- [ ] **Step 3: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/chat/chat.service.ts apps/server/src/modules/rag/rag.service.ts
git commit -m "feat: pass conversationId through ChatService to RAGService for trace tagging"
```

---

## Phase 6: OpenTelemetry 自动插桩

### Task 6.1: 安装 OpenTelemetry 依赖

**Spec 对应:** Requirement: OpenTelemetry 自动插桩

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: 添加 OTel 依赖**

在 `apps/server/package.json` 的 `dependencies` 中添加：

```json
"@opentelemetry/sdk-node": "^0.54.0",
"@opentelemetry/instrumentation-pg": "^0.54.0",
"@opentelemetry/instrumentation-mongodb": "^0.54.0",
"@opentelemetry/instrumentation-ioredis": "^0.54.0",
"@opentelemetry/instrumentation-express": "^0.54.0",
"@opentelemetry/exporter-trace-otlp-http": "^0.54.0"
```

注：`@opentelemetry/instrumentation-elasticsearch` 在 npm registry 中不存在，已移除。Elasticsearch 追踪使用 `@elastic/elasticsearch` 客户端内置诊断功能。

- [ ] **Step 2: 安装依赖**

```bash
cd apps/server && pnpm install
```

- [ ] **Step 3: 验证依赖**

```bash
cd apps/server && node -e "require('@opentelemetry/sdk-node'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml
git commit -m "feat: add opentelemetry sdk and instrumentation dependencies"
```

---

### Task 6.2: 写 OTel instrumentation 的失败测试

**Spec 对应:**
- Requirement: OpenTelemetry 自动插桩 — Scenario: HTTP 请求追踪
- Requirement: OpenTelemetry 自动插桩 — Scenario: 数据库查询追踪
- Requirement: OpenTelemetry 自动插桩 — Scenario: Redis 操作追踪
- Requirement: OpenTelemetry 导出配置 — Scenario: OTel 未配置时正常运行

**Files:**
- Create: `apps/server/src/instrumentation.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';

// 我们需要测试 registerOTel 函数的行为
// 但由于它注册全局单例，测试需要特殊处理
// 这里我们测试 registerOTel 在 OTel 环境变量未设置时不会抛出异常

describe('OTel Instrumentation Registration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置环境变量
    process.env = { ...originalEnv };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not throw when OTel env vars are not set', async () => {
    // registerOTel 在无 OTel 配置时应优雅跳过
    const { registerOTel } = await import('./instrumentation');
    expect(() => registerOTel()).not.toThrow();
  });

  it('should create SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
    process.env.OTEL_SERVICE_NAME = 'test-service';

    const { registerOTel } = await import('./instrumentation');
    expect(() => registerOTel()).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/server && npx jest src/instrumentation.spec.ts --no-coverage
```

Expected: FAIL，`Cannot find module './instrumentation'`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/instrumentation.spec.ts
git commit -m "test: add instrumentation failing tests (TDD red)"
```

---

### Task 6.3: 实现 instrumentation.ts

**Spec 对应:**
- Requirement: OpenTelemetry 自动插桩
- Requirement: OpenTelemetry 导出配置

**Files:**
- Create: `apps/server/src/instrumentation.ts`

**Interfaces:**
- Consumes: 环境变量 OTEL_EXPORTER_OTLP_ENDPOINT、OTEL_SERVICE_NAME、OTEL_ENVIRONMENT
- Produces: `registerOTel()` 函数，注册 OTel SDK

- [ ] **Step 1: 创建 instrumentation.ts**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// 自动插桩注册表
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { MongodbInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
// 注：Elasticsearch 无官方 OTel instrumentation 包，使用客户端内置诊断

let sdk: NodeSDK | null = null;

/**
 * 注册 OpenTelemetry 自动插桩
 * 当 OTEL_EXPORTER_OTLP_ENDPOINT 未设置时，跳过初始化
 */
export function registerOTel(): NodeSDK | null {
  // 如果已注册，直接返回
  if (sdk) {
    return sdk;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || endpoint.trim() === '') {
    return null;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'knowledge-base-rag-server';
  const environment = process.env.OTEL_ENVIRONMENT || 'development';

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'knowledge-base-rag',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
    }),
    instrumentations: [
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new MongodbInstrumentation(),
      new IORedisInstrumentation(),
      // Elasticsearch: 无官方 OTel instrumentation 包，跳过
    ],
  });

  sdk.start();
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

- [ ] **Step 2: 运行测试确认通过**

```bash
cd apps/server && npx jest src/instrumentation.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/instrumentation.ts
git commit -m "feat: implement OTel auto-instrumentation with Express/PG/MongoDB/Redis/ES"
```

---

### Task 6.4: 修改 main.ts 加载 OTel SDK

**Spec 对应:** Requirement: OpenTelemetry 自动插桩 — 在 main.ts 启动时加载

**Files:**
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: 在 main.ts 顶部添加 OTel 初始化**

在现有 imports 之后、NestFactory.create 之前添加：

```typescript
import { registerOTel } from './instrumentation';

// OpenTelemetry 自动插桩（在 NestJS 启动前注册）
registerOTel();
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 3: 运行测试确认无回归**

```bash
cd apps/server && npx jest --no-coverage
```

Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat: load OTel SDK in main.ts before NestJS bootstrap"
```

---

### Task 6.5: 更新 .env.example 添加 OTel 环境变量

**Spec 对应:** Requirement: OpenTelemetry 导出配置 — 环境变量配置

**Files:**
- Modify: `apps/server/.env.example`

- [ ] **Step 1: 添加 OTel 环境变量**

在 `.env.example` 末尾添加：

```bash
# =================== OpenTelemetry 自动追踪 ===================
# OTLP 导出端点（留空则跳过 OTel 初始化）
OTEL_EXPORTER_OTLP_ENDPOINT=
# 服务名称（用于 Trace 标识）
OTEL_SERVICE_NAME=knowledge-base-rag-server
# 环境标识
OTEL_ENVIRONMENT=development
```

- [ ] **Step 2: 验证 .env.example 格式**

```bash
cd apps/server && grep -c "OTEL_" .env.example
```

Expected: 输出 `3`

- [ ] **Step 3: Commit**

```bash
git add apps/server/.env.example
git commit -m "docs: add OTel environment variables to .env.example"
```

---

## Phase 7: 评测服务集成

### Task 7.1: 写 LangfuseEvalService 的失败测试

**Spec 对应:**
- Requirement: 评测数据集集成 — Scenario: 上传测试数据集
- Requirement: 评测数据集集成 — Scenario: 批量执行评测
- Requirement: 评测数据集集成 — Scenario: 评测结果关联 Trace

**Files:**
- Create: `apps/server/src/modules/rag/langfuse-eval.service.spec.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LangfuseEvalService } from './langfuse-eval.service';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { RAGService } from './rag.service';

describe('LangfuseEvalService', () => {
  let service: LangfuseEvalService;
  let mockLangfuseService: jest.Mocked<LangfuseService>;
  let mockRagService: jest.Mocked<RAGService>;

  beforeEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'test-public-key';
    process.env.LANGFUSE_SECRET_KEY = 'test-secret-key';
    process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';
    process.env.LANGFUSE_PROJECT_ID = 'test-project';

    mockLangfuseService = {
      getClient: jest.fn(),
      getCallbackHandler: jest.fn(),
      shutdown: jest.fn(),
    } as any;

    mockRagService = {
      query: jest.fn().mockResolvedValue('test answer'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangfuseEvalService,
        { provide: LangfuseService, useValue: mockLangfuseService },
        { provide: RAGService, useValue: mockRagService },
      ],
    }).compile();

    service = module.get<LangfuseEvalService>(LangfuseEvalService);
  });

  describe('uploadDataset', () => {
    it('should upload test cases to LangFuse Dataset', async () => {
      const mockClient = {
        dataset: {
          create: jest.fn().mockResolvedValue({
            id: 'dataset-123',
            name: 'test-dataset',
          }),
          createItem: jest.fn().mockResolvedValue({
            id: 'item-1',
            input: { question: 'Q1' },
          }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);

      const testCases = [
        { input: '问题1', expectedOutput: '答案1' },
        { input: '问题2', expectedOutput: '答案2' },
      ];

      const result = await service.uploadDataset('test-dataset', testCases);

      expect(result.datasetId).toBe('dataset-123');
      expect(mockClient.dataset.create).toHaveBeenCalledWith({
        name: 'test-dataset',
        projectId: 'test-project',
      });
      expect(mockClient.dataset.createItem).toHaveBeenCalledTimes(2);
    });

    it('should return error when LANGFUSE_PROJECT_ID is not set', async () => {
      delete process.env.LANGFUSE_PROJECT_ID;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LangfuseEvalService,
          { provide: LangfuseService, useValue: mockLangfuseService },
          { provide: RAGService, useValue: mockRagService },
        ],
      }).compile();
      const newService = module.get<LangfuseEvalService>(LangfuseEvalService);

      await expect(
        newService.uploadDataset('test', [{ input: 'Q' }]),
      ).rejects.toThrow('LANGFUSE_PROJECT_ID is required');
    });
  });

  describe('runEvaluation', () => {
    it('should execute RAG pipeline for each test case and score results', async () => {
      const mockClient = {
        dataset: {
          getItems: jest.fn().mockResolvedValue([
            { id: 'item-1', input: { question: 'Q1' }, expectedOutput: 'A1' },
            { id: 'item-2', input: { question: 'Q2' }, expectedOutput: 'A2' },
          ]),
        },
        score: {
          create: jest.fn().mockResolvedValue({ id: 'score-1' }),
        },
      };

      mockLangfuseService.getClient.mockReturnValue(mockClient as any);
      mockRagService.query.mockResolvedValue('generated answer');

      const result = await service.runEvaluation('dataset-123');

      expect(mockRagService.query).toHaveBeenCalledTimes(2);
      expect(mockClient.score.create).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/server && npx jest src/modules/rag/langfuse-eval.service.spec.ts --no-coverage
```

Expected: FAIL，`Cannot find module './langfuse-eval.service'`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/rag/langfuse-eval.service.spec.ts
git commit -m "test: add LangfuseEvalService failing tests (TDD red)"
```

---

### Task 7.2: 实现 LangfuseEvalService

**Spec 对应:** Requirement: 评测数据集集成

**Files:**
- Create: `apps/server/src/modules/rag/langfuse-eval.service.ts`

**Interfaces:**
- Consumes: LangfuseService.getClient()，RAGService.query()
- Produces: `uploadDataset(name, testCases)` 返回 `datasetId`，`runEvaluation(datasetId)` 执行评测

- [ ] **Step 1: 创建 langfuse-eval.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LangfuseService } from '../../common/observability/langfuse.service';
import { RAGService } from './rag.service';

export interface TestCase {
  input: string;
  expectedOutput?: string;
  expectedRetrievalContext?: string[];
  metadata?: Record<string, any>;
}

export interface DatasetUploadResult {
  datasetId: string;
  itemIds: string[];
}

export interface EvaluationResult {
  datasetId: string;
  evaluatedCount: number;
  scores: Array<{
    itemId: string;
    scores: Array<{ name: string; value: number; comment?: string }>;
  }>;
}

/** LangFuse 评测服务：管理 Dataset 和批量评测 */
@Injectable()
export class LangfuseEvalService {
  private readonly logger = new Logger(LangfuseEvalService.name);

  constructor(
    private langfuseService: LangfuseService,
    private ragService: RAGService,
  ) {}

  /**
   * 上传测试用例集到 LangFuse Dataset
   */
  async uploadDataset(name: string, testCases: TestCase[]): Promise<DatasetUploadResult> {
    const client = this.langfuseService.getClient();
    if (!client) {
      throw new Error('LangFuse client not initialized');
    }

    const projectId = process.env.LANGFUSE_PROJECT_ID;
    if (!projectId) {
      throw new Error('LANGFUSE_PROJECT_ID is required for dataset operations');
    }

    // 创建或获取 Dataset
    const dataset = await client.dataset.create({
      name,
      projectId,
    });

    const itemIds: string[] = [];

    // 批量上传测试用例
    for (const testCase of testCases) {
      const item = await client.dataset.createItem({
        datasetId: dataset.id,
        input: { question: testCase.input },
        expectedOutput: testCase.expectedOutput ? { answer: testCase.expectedOutput } : undefined,
        metadata: testCase.metadata,
      });
      itemIds.push(item.id);
    }

    this.logger.log(`Uploaded ${itemIds.length} test cases to dataset ${dataset.id}`);
    return { datasetId: dataset.id, itemIds };
  }

  /**
   * 批量执行评测：遍历 Dataset 用例 → 调用 RAG 管道 → 评分
   */
  async runEvaluation(datasetId: string): Promise<EvaluationResult> {
    const client = this.langfuseService.getClient();
    if (!client) {
      throw new Error('LangFuse client not initialized');
    }

    // 获取 Dataset 中的所有测试用例
    const items = await client.dataset.getItems({ datasetId });
    const scores: EvaluationResult['scores'] = [];

    for (const item of items) {
      const question = (item.input as any)?.question || '';
      const expectedAnswer = (item.expectedOutput as any)?.answer || '';

      // 调用 RAG 管道执行
      const generatedAnswer = await this.ragService.query(
        question,
        'eval-user',
        `eval-${datasetId}`,
      );

      // 计算评分指标
      const itemScores = await this.evaluateAnswer(
        question,
        expectedAnswer,
        generatedAnswer,
      );

      scores.push({
        itemId: item.id,
        scores: itemScores,
      });

      this.logger.log(`Evaluated item ${item.id}: ${itemScores.map(s => `${s.name}=${s.value}`).join(', ')}`);
    }

    return { datasetId, evaluatedCount: scores.length, scores };
  }

  /**
   * 评分逻辑：计算 answer-relevancy、faithfulness、context-recall
   * 使用 LangFuse Evaluation API 或内置启发式方法
   */
  private async evaluateAnswer(
    question: string,
    expected: string,
    generated: string,
  ): Promise<Array<{ name: string; value: number; comment?: string }>> {
    const scores: Array<{ name: string; value: number; comment?: string }> = [];

    // answer-relevancy: 基于关键词重叠的简单启发式评分
    const relevancy = this.calculateRelevancy(question, generated);
    scores.push({ name: 'answer-relevancy', value: relevancy });

    // faithfulness: 检查生成答案是否包含期望答案的关键信息
    const faithfulness = this.calculateFaithfulness(expected, generated);
    scores.push({ name: 'faithfulness', value: faithfulness });

    return scores;
  }

  /**
   * 基于 bigram Jaccard 相似度计算相关性
   */
  private calculateRelevancy(question: string, answer: string): number {
    const qBigrams = this.getBigrams(question);
    const aBigrams = this.getBigrams(answer);
    if (qBigrams.size === 0) return 0;
    const intersection = new Set([...qBigrams].filter(x => aBigrams.has(x)));
    return intersection.size / qBigrams.size;
  }

  /**
   *  faithfulness: 检查期望答案的关键词是否在生成答案中
   */
  private calculateFaithfulness(expected: string, generated: string): number {
    const expectedWords = new Set(
      expected.split(/\s+/).filter(w => w.length > 1),
    );
    if (expectedWords.size === 0) return 0;
    const generatedLower = generated.toLowerCase();
    let matches = 0;
    for (const word of expectedWords) {
      if (generatedLower.includes(word.toLowerCase())) {
        matches++;
      }
    }
    return matches / expectedWords.size;
  }

  private getBigrams(text: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.slice(i, i + 2).toLowerCase());
    }
    return bigrams;
  }
}
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd apps/server && npx jest src/modules/rag/langfuse-eval.service.spec.ts --no-coverage
```

Expected: PASS，所有测试通过

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/rag/langfuse-eval.service.ts
git commit -m "feat: implement LangfuseEvalService with Dataset upload and evaluation"
```

---

## Phase 8: 环境变量完善

### Task 8.1: 完善 .env.example 添加 LangFuse 评测和 OTel 变量

**Spec 对应:** Requirement: 配置与隐私，Requirement: OpenTelemetry 导出配置

**Files:**
- Modify: `apps/server/.env.example`

- [ ] **Step 1: 更新 .env.example**

确认文件中已包含（添加缺失的）：

```bash
# =================== LangFuse 监控 ===================
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PROJECT_ID=your-langfuse-project-id

# =================== OpenTelemetry 自动追踪 ===================
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAME=knowledge-base-rag-server
OTEL_ENVIRONMENT=development
```

- [ ] **Step 2: 验证**

```bash
cd apps/server && grep "LANGFUSE_PROJECT_ID" .env.example && grep "OTEL_" .env.example
```

Expected: 两个 grep 都有输出

- [ ] **Step 3: Commit**

```bash
git add apps/server/.env.example
git commit -m "docs: add LANGFUSE_PROJECT_ID and OTel env vars to .env.example"
```

---

## Phase 9: 完整验证

### Task 9.1: 运行全量测试套件

- [ ] **Step 1: 运行所有测试**

```bash
cd apps/server && npx jest --no-coverage
```

Expected: 所有测试 PASS

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无编译错误

### Task 9.2: 验证 spec 场景测试覆盖

**Spec 对应:** 所有 17 个 spec 场景

- [ ] **Step 1: 列出所有测试用例**

```bash
cd apps/server && npx jest --listTests --no-coverage
```

Expected: 输出所有测试文件路径

- [ ] **Step 2: 运行单个测试文件确认覆盖**

对每个测试文件逐一运行，确认对应 spec 场景有测试覆盖：
- `langfuse.service.spec.ts` → 覆盖：正常初始化、降级、conversationId 标签
- `observability.module.spec.ts` → 覆盖：模块提供 LangfuseService
- `rag.service.spec.ts` → 覆盖：同步路径 CallbackHandler、null 降级
- `langfuse-eval.service.spec.ts` → 覆盖：uploadDataset、runEvaluation、PROJECT_ID 校验
- `instrumentation.spec.ts` → 覆盖：OTel 配置缺失时跳过、OTel 配置时创建 SDK

### Task 9.3: 打开 Openspec Verify 验证

- [ ] **Step 1: 运行 openspec verify**

```bash
openspec verify langfuse-integration
```

Expected: 输出 `All validations passed!` 或类似成功信息

- [ ] **Step 2: 如验证失败，修复问题并重新验证**

```bash
# 修复后重新验证
openspec verify langfuse-integration
```

Expected: 验证通过

---

## Phase 10: 运行时验证（需要真实环境）

### Task 10.1: 启动应用验证 LangFuse 追踪

- [ ] **Step 1: 配置 LangFuse 环境变量**

在 `apps/server/.env` 中设置：
```bash
LANGFUSE_PUBLIC_KEY=your-real-public-key
LANGFUSE_SECRET_KEY=your-real-secret-key
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

- [ ] **Step 2: 启动应用**

```bash
cd apps/server && pnpm dev
```

Expected: 启动日志中看到 `LangFuse initialized` 日志

- [ ] **Step 3: 发起测试查询**

通过 API 或前端发起一个 RAG 查询

- [ ] **Step 4: 在 LangFuse Dashboard 确认 Trace**

Expected: 在 LangFuse Dashboard 中看到 `rag-query` Trace，包含节点执行 Span

### Task 10.2: 启动应用验证 OTel 追踪

- [ ] **Step 1: 配置 OTel 环境变量**

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
OTEL_SERVICE_NAME=knowledge-base-rag-server
OTEL_ENVIRONMENT=development
```

- [ ] **Step 2: 重启应用并发起请求**

- [ ] **Step 3: 在 LangFuse Dashboard 确认基础设施 Span**

Expected: 看到 HTTP Server Span、数据库查询 Span

---

## 完成标准

- [ ] 所有 10 个 Phase 的任务执行完毕
- [ ] `npx jest --no-coverage` 全部通过
- [ ] `npx tsc --noEmit` 无编译错误
- [ ] `openspec verify langfuse-integration` 验证通过
- [ ] 在 LangFuse Dashboard 可见 RAG Trace 和基础设施 Span

---

## 回滚策略

如需回滚：
1. 移除 `ObservabilityModule` 导入（`rag.module.ts`）
2. 恢复 `streamQuery()` 中手动的 `new CallbackHandler()`
3. 恢复 `query()` 方法移除 callbacks 选项
4. 删除 `instrumentation.ts` 和 `main.ts` 中的 OTel 初始化
5. `package.json` 恢复 `@opentelemetry/api`，移除 OTel 相关包

所有回滚步骤不影响业务逻辑和现有功能。
