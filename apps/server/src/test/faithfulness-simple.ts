/**
 * 简化的 faithfulness 评分算法测试
 */

// 提取文本的 n-gram（支持中英文）
function getNgrams(text: string, n: number): Set<string> {
  const ngrams = new Set<string>();
  const isChinese = /[一-鿿]/.test(text);

  if (isChinese) {
    // 中文：按字符生成 n-gram
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.add(text.slice(i, i + n).toLowerCase());
    }
  } else {
    // 英文：按单词生成 n-gram
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      ngrams.add(ngram.toLowerCase());
    }
  }

  return ngrams;
}

// 计算 faithfulness
function calculateFaithfulness(expected: string, generated: string): number {
  const expectedNgrams = getNgrams(expected, 3);
  const generatedNgrams = getNgrams(generated.toLowerCase(), 3);

  if (expectedNgrams.size === 0) return 0;

  const intersection = new Set([...expectedNgrams].filter((x) => generatedNgrams.has(x)));
  return intersection.size / expectedNgrams.size;
}

// 计算相关性
function calculateRelevancy(question: string, answer: string): number {
  const qBigrams = getNgrams(question, 2);
  const aBigrams = getNgrams(answer, 2);
  if (qBigrams.size === 0) return 0;
  const intersection = new Set([...qBigrams].filter((x) => aBigrams.has(x)));
  return intersection.size / qBigrams.size;
}

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

console.log('🧪 测试 faithfulness 评分算法（trigram 版本）\n');

for (const tc of testCases) {
  const faithfulness = calculateFaithfulness(tc.expected, tc.generated);
  const relevancy = calculateRelevancy(tc.question, tc.generated);

  console.log(`问题: ${tc.question}`);
  console.log(`期望: ${tc.expected.substring(0, 60)}...`);
  console.log(`实际: ${tc.generated.substring(0, 60)}...`);
  console.log(`faithfulness=${faithfulness.toFixed(2)}, relevancy=${relevancy.toFixed(2)}`);
  console.log('');
}
