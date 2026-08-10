/**
 * 测试 faithfulness 评分算法
 */
import { LangfuseEvalService } from './langfuse-eval.service';

// 创建测试实例（跳过 NestJS 依赖注入）
class TestEvalService extends LangfuseEvalService {
  // 仅用于测试评分方法
}

const service = new TestEvalService(null as any, null as any, null as any);

// 测试用例
const testCases = [
  {
    question: '公司股票期权行权规则是什么？',
    expected: '期权分4年解锁，每年解锁25%，行权价为授予日前30个交易日股票均价的85%',
    generated: '公司股票期权分4年解锁，每年解锁25%，行权价格为授予日前30个交易日股票均价的85%',
  },
  {
    question: '项目立项需要哪些材料？',
    expected: '立项申请表、可行性分析报告、项目排期计划',
    generated: '项目立项需要提交立项申请表、可行性分析报告、项目排期计划等核心材料',
  },
  {
    question: '打印机如何连接？',
    expected: '请先确认打印机已开机并连接到同一WiFi网络，然后打开系统设置添加打印机',
    generated: '连接打印机前，请确保打印机已开机并与电脑在同一网络中。打开设置，进入设备-打印机，点击添加打印机即可',
  },
  {
    question: '公司出差住宿标准是什么？',
    expected: '一线城市每天住宿补贴500元，二线城市400元，三线城市300元',
    generated: '一线城市住宿标准为每天500元，二线城市400元，其他城市300元',
  },
];

console.log('🧪 测试 faithfulness 评分算法\n');

for (const tc of testCases) {
  const faithfulness = (service as any).calculateFaithfulness(tc.expected, tc.generated);
  const relevancy = (service as any).calculateRelevancy(tc.question, tc.generated);

  console.log(`问题: ${tc.question}`);
  console.log(`期望: ${tc.expected.substring(0, 50)}...`);
  console.log(`实际: ${tc.generated.substring(0, 50)}...`);
  console.log(`faithfulness=${faithfulness.toFixed(2)}, relevancy=${relevancy.toFixed(2)}`);
  console.log('');
}
