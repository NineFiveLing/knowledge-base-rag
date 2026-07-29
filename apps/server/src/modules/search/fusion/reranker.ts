/**
 * Cross-Encoder Reranker
 * 对 RRF 融合结果进行精排，输出 top-K
 *
 * MVP 实现：简化版基于文本长度的 relevance score
 * 生产环境应替换为 bge-reranker-v2-m3 等 Cross-Encoder 模型
 */
export async function rerank(
  query: string,
  candidates: Array<{
    chunk_id: string;
    postgres_doc_id: string;
    chunk_text: string;
    score: number;
  }>,
  topK: number = 5,
) {
  // MVP：基于 query 关键词命中次数的简化精排
  const queryTokens = query.toLowerCase().split(/\s+/);

  const scored = candidates.map((c) => {
    const text = c.chunk_text.toLowerCase();
    let hitCount = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) hitCount++;
    }
    const rerankScore = c.score * 0.4 + (hitCount / Math.max(queryTokens.length, 1)) * 0.6;
    return { ...c, rerankScore };
  });

  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);
}
