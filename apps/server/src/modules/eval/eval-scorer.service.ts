import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

export interface EvalScoreInput {
  question: string;
  context: string[];
  groundTruth: string;
  answer: string;
}

export interface DimensionScore {
  name: 'relevancy' | 'faithfulness' | 'credibility';
  value: number;
  reason: string;
  missingPoints: string[];
}

export interface EvalScoreResult {
  relevancy: DimensionScore;
  faithfulness: DimensionScore;
  credibility: DimensionScore;
}

const dimensionSchema = z.object({
  value: z.number().min(0).max(1),
  reason: z.string(),
  missingPoints: z.array(z.string()),
});

const evalOutputSchema = z.object({
  relevancy: dimensionSchema,
  faithfulness: dimensionSchema,
  credibility: dimensionSchema,
});

/** LLM 三维度评测器：对一条 RAG 回答，从相关性/忠实度/可信性三维度打分并说明差距 */
@Injectable()
export class EvalScorerService {
  private readonly logger = new Logger(EvalScorerService.name);
  protected llm: ChatOpenAI;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get('ALIYUN_API_KEY');
    const baseURL = this.config.get('ALIYUN_BASE_URL');
    this.llm = new ChatOpenAI({
      model: this.config.get('MODEL_NAME'),
      apiKey,
      configuration: { baseURL },
    });
  }

  /** 对一条回答进行三维度评分 */
  async score(input: EvalScoreInput): Promise<EvalScoreResult> {
    const { system, user } = this.buildPrompt(input);
    const res = await this.llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const parsed = evalOutputSchema.safeParse(this.extractJson(content));
    if (!parsed.success) {
      throw new Error(`评测输出非法（zod 校验失败）: ${parsed.error.message}`);
    }
    return {
      relevancy: { name: 'relevancy', ...parsed.data.relevancy },
      faithfulness: { name: 'faithfulness', ...parsed.data.faithfulness },
      credibility: { name: 'credibility', ...parsed.data.credibility },
    };
  }

  /** 从 LLM 输出中提取 JSON 对象（兼容 ```json 代码围栏） */
  private extractJson(content: string): unknown {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('评测输出中未找到 JSON');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }

  /** 构建评分提示词 */
  private buildPrompt(input: EvalScoreInput): { system: string; user: string } {
    const contextText = input.context.length > 0
      ? input.context.map((c, i) => `[${i + 1}] ${c}`).join('\n')
      : '（检索上下文为空）';

    const system = `你是一个严谨的 RAG 回答质量评估员。对给定的模型回答，从以下三个维度各评一个 0~1 分（保留两位小数），并给出理由与遗漏的关键点。

评分标准：
- relevancy（相关性）：回答是否切题、直接覆盖问题要点。高分=直接回应问题核心；低分=偏题或覆盖不足。
- faithfulness（忠实度）：回答的论断是否都能在检索上下文中找到依据、无编造。高分=每个论断有出处；低分=存在编造或无依据。若检索上下文为空，则按回答是否无中生有判断。
- credibility（可信性）：回答与标准答案的关键事实点是否吻合、是否可验证。高分=关键事实一致且可查；低分=遗漏关键点或与标准答案矛盾。

只输出 JSON，不要输出其他任何内容：
{
  "relevancy": {"value": 0.00, "reason": "评分理由", "missingPoints": ["遗漏或偏题的关键点"]},
  "faithfulness": {"value": 0.00, "reason": "评分理由", "missingPoints": ["编造或无依据的论断"]},
  "credibility": {"value": 0.00, "reason": "评分理由", "missingPoints": ["与标准答案对比遗漏或错误的事实点"]}
}`;

    const user = `【问题】
${input.question}

【检索上下文】
${contextText}

【标准答案】
${input.groundTruth}

【模型回答】
${input.answer}`;

    return { system, user };
  }
}
