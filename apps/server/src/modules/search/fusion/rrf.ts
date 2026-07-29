/** 单路检索结果 */
export interface ScoredResult {
  chunk_id: string;
  postgres_doc_id: string;
  chunk_text: string;
  score: number;
  source: 'pgvector' | 'es' | 'neo4j';
}

/**
 * Reciprocal Rank Fusion (RRF) 多路融合算法
 * 公式：RRF_score(d) = Σ 1/(k + rank_i(d))
 * 对多路检索结果按倒序排名融合，不依赖各路的原始分数
 */
export function reciprocalRankFusion(
  resultSets: ScoredResult[][],
  k: number = 60,
): ScoredResult[] {
  const scoreMap = new Map<string, ScoredResult & { rrfScore: number }>();

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const existing = scoreMap.get(r.chunk_id);
      const rrfScore = 1 / (k + rank + 1);
      if (existing) {
        existing.rrfScore += rrfScore;
        if (r.score > existing.score) existing.score = r.score;
      } else {
        scoreMap.set(r.chunk_id, { ...r, rrfScore });
      }
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ rrfScore: _, ...rest }) => ({ ...rest, score: _ }));
}
