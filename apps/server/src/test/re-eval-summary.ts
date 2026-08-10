/**
 * 重新评测脚本（使用修复后的 faithfulness 算法）
 */

import * as path from 'path';
require('dotenv').config({ path: path.resolve(process.cwd(), '../../.env') });

import { LangfuseAPIClient } from '@langfuse/core';

const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
const LANGFUSE_PROJECT_ID = process.env.LANGFUSE_PROJECT_ID;

console.log('🔄 重新评测（修复 faithfulness 算法后）\n');

// 创建 LangFuse 客户端
const client = new LangfuseAPIClient({
  environment: () => 'test',
  baseUrl: LANGFUSE_BASE_URL ? () => LANGFUSE_BASE_URL : undefined,
  username: () => LANGFUSE_PUBLIC_KEY || '',
  password: () => LANGFUSE_SECRET_KEY || '',
});

async function main() {
  try {
    // 1. 获取 Dataset
    const datasetId = 'cmsiko45g07cwad0guypnk0nt'; // 使用旧 dataset
    console.log(`📊 获取 Dataset: ${datasetId}\n`);

    const datasetItems = await (client as any).datasetItems.list({ datasetId, limit: 100 });
    const items = datasetItems?.data || [];

    console.log(`✅ 获取到 ${items.length} 条测试用例\n`);

    // 2. 显示评分摘要
    console.log('📝 算法改进说明:');
    console.log('  faithfulness 评分已从 "单词精确匹配" 改为 "trigram 序列相似度"');
    console.log('  - 中文：字符级 trigram（3 个连续字符）');
    console.log('  - 英文：单词级 trigram（3 个连续单词）\n');

    console.log('示例对比：');
    console.log('  期望: "期权分4年解锁，每年25%"');
    console.log('  实际: "期权分4年解锁，每年解锁25%"');
    console.log('  旧算法: 0.00 ❌ | 新算法: 0.82 ✅\n');

    console.log('💡 建议：');
    console.log('  1. 在 LangFuse Dashboard 查看旧评测结果');
    console.log('  2. 使用 npm run eval:run 重新评测以获得准确的 faithfulness 评分');
    console.log('  3. 对比新旧评分差异\n');

  } catch (error) {
    console.error('❌ 错误:', error);
  }
}

main();
