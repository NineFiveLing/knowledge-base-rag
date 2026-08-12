import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EvalScorerService } from './eval-scorer.service';

describe('EvalScorerService', () => {
  let service: EvalScorerService;
  let mockInvoke: jest.Mock;

  const mockConfig = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'ALIYUN_API_KEY': return 'test-api-key';
        case 'ALIYUN_BASE_URL': return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        case 'MODEL_NAME': return 'deepseek-v4-flash-0731';
        default: return undefined;
      }
    }),
  } as any;

  const validInput = {
    question: '年假怎么申请？',
    context: ['员工可通过OA系统提交年假申请'],
    groundTruth: '年假通过OA系统申请，提前3个工作日提交。',
    answer: '通过OA系统申请年假，提前3个工作日提交。',
  };

  beforeEach(async () => {
    mockInvoke = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EvalScorerService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<EvalScorerService>(EvalScorerService);
    (service as any).llm = { invoke: mockInvoke };
  });

  it('应解析 LLM 返回的三维度结构化输出', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        relevancy: { value: 0.9, reason: '回答切题', missingPoints: [] },
        faithfulness: { value: 1, reason: '论断有据', missingPoints: [] },
        credibility: { value: 0.8, reason: '覆盖关键点', missingPoints: ['报销比例未提及'] },
      }),
    });

    const result = await service.score(validInput);

    expect(result.relevancy).toEqual({ name: 'relevancy', value: 0.9, reason: '回答切题', missingPoints: [] });
    expect(result.faithfulness.value).toBe(1);
    expect(result.credibility.missingPoints).toContain('报销比例未提及');
  });

  it('LLM 输出非 JSON 时抛错', async () => {
    mockInvoke.mockResolvedValue({ content: '抱歉，我无法评分' });
    await expect(service.score(validInput)).rejects.toThrow();
  });

  it('LLM 输出缺少字段时抛错（zod 校验失败）', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({ relevancy: { value: 0.5, reason: 'x' } }),
    });
    await expect(service.score(validInput)).rejects.toThrow();
  });

  it('LLM 调用抛错时向上传播', async () => {
    mockInvoke.mockRejectedValue(new Error('API 超时'));
    await expect(service.score(validInput)).rejects.toThrow('API 超时');
  });

  it('检索上下文为空时仍能评分', async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        relevancy: { value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { value: 0.5, reason: '上下文为空，无法核验依据', missingPoints: [] },
        credibility: { value: 0.8, reason: '事实吻合', missingPoints: [] },
      }),
    });

    const result = await service.score({ ...validInput, context: [] });
    expect(result.faithfulness.value).toBe(0.5);
  });

  it('支持 ```json 代码围栏包裹的输出', async () => {
    mockInvoke.mockResolvedValue({
      content: '```json\n' + JSON.stringify({
        relevancy: { value: 0.9, reason: '切题', missingPoints: [] },
        faithfulness: { value: 0.9, reason: '有据', missingPoints: [] },
        credibility: { value: 0.9, reason: '吻合', missingPoints: [] },
      }) + '\n```',
    });

    const result = await service.score(validInput);
    expect(result.credibility.value).toBe(0.9);
  });
});
