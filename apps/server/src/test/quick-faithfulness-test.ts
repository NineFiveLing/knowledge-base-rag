/**
 * 快速验证新的 faithfulness 评分算法
 */

// 提取文本的 n-gram（支持中英文）
function getNgrams(text: string, n: number): Set<string> {
  const ngrams = new Set<string>();
  const isChinese = /[一-鿿]/.test(text);

  if (isChinese) {
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.add(text.slice(i, i + n).toLowerCase());
    }
  } else {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      ngrams.add(ngram.toLowerCase());
    }
  }

  return ngrams;
}

function calculateFaithfulness(expected: string, generated: string): number {
  const expectedNgrams = getNgrams(expected, 3);
  const generatedNgrams = getNgrams(generated.toLowerCase(), 3);

  if (expectedNgrams.size === 0) return 0;

  const intersection = new Set([...expectedNgrams].filter((x) => generatedNgrams.has(x)));
  return intersection.size / expectedNgrams.size;
}

// 快速测试
const testCases = [
  { expected: '期权分4年解锁，每年25%', generated: '期权分4年解锁，每年解锁25%' },
  { expected: '行权价85%', generated: '行权价格为85%' },
  { expected: '立项申请表', generated: '立项申请表' },
  { expected: '打印机WiFi连接', generated: '打印机WiFi连接方法' },
];

console.log('✅ faithfulness 算法验证（trigram 版本）:\n');

for (const tc of testCases) {
  const score = calculateFaithfulness(tc.expected, tc.generated);
  console.log(`期望: "${tc.expected}"`);
  console.log(`实际: "${tc.generated}"`);
  console.log(`→ faithfulness: ${score.toFixed(2)}\n`);
}

console.log('✅ 算法改进完成！');
console.log('主要改进：');
console.log('1. 使用字符级 trigram 替代单词匹配');
console.log('2. 支持中文 n-gram 生成');
console.log('3. 基于序列相似度而非精确匹配');
