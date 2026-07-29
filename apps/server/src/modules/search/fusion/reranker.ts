/**
 * Cross-Encoder Reranker
 * 对 RRF 融合结果进行精排
 *
 * 主路径：使用 @xenova/transformers 的 bge-reranker-v2-m3 (ONNX 本地推理)
 * 降级路径：模型加载失败时 fallback 到原始分数排序
 */
import type { ChunkResult } from './reranker.interface';

/**
 * 兼容旧字段名的输入类型（旧代码用 chunk_text，新接口用 text）
 * chunk_text 为必填字段——多路检索结果中始终存在（Neo4j 路径为空字符串）
 */
type ChunkInput = {
  chunk_id: string;
  postgres_doc_id: string;
  chunk_text: string;
  text?: string;
  score: number;
  [key: string]: any;
};

/** 从输入 chunk 中提取文本内容 */
function getText(c: ChunkInput): string {
  return c.chunk_text || c.text || '';
}

/** 将 ChunkInput 映射为 ChunkResult（补充 text 字段） */
function toChunkResult(c: ChunkInput): ChunkResult {
  return {
    chunk_id: c.chunk_id,
    postgres_doc_id: c.postgres_doc_id,
    text: c.text || c.chunk_text,
    score: c.score,
    metadata: c.metadata as Record<string, any> | undefined,
  };
}

// ─── Cross-Encoder 精排器 ─────────────────────────────────────

/** Cross-Encoder 精排器：使用 bge-reranker-v2-m3 (ONNX 本地推理) */
export class Reranker {
  private model: any = null;
  private loading: Promise<any> | null = null;

  /**
   * 对候选 chunks 进行精排
   * @param query 用户查询
   * @param chunks 候选片段列表
   * @returns 按 rerankScore 降序排列的全部 chunks
   */
  async rerank(query: string, chunks: ChunkResult[]): Promise<ChunkResult[]> {
    // 单结果无需精排
    if (chunks.length <= 1) {
      return chunks.map((c) => ({ ...c, rerankScore: c.score }));
    }

    try {
      const crossEncoder = await this.getModel();
      // 构造 query-document pairs，截断过长文本
      const pairs = chunks.map(
        (c) => `${query} [SEP] ${c.text.slice(0, 512)}`,
      );
      const scores = await crossEncoder(pairs, {
        pooling: 'mean',
        normalize: true,
      });

      return chunks
        .map((c, i) => ({
          ...c,
          rerankScore: Number(scores[i]?.score ?? 0),
        }))
        .sort((a, b) => b.rerankScore - a.rerankScore);
    } catch (err) {
      // 降级：使用原始分数排序
      console.warn(
        '[Reranker] Cross-Encoder 失败，降级使用原始分数排序:',
        (err as Error).message,
      );
      return chunks
        .map((c) => ({ ...c, rerankScore: c.score }))
        .sort((a, b) => b.rerankScore - a.rerankScore);
    }
  }

  /** 获取或加载 Cross-Encoder 模型（懒加载 + 单例） */
  private async getModel(): Promise<any> {
    if (this.model) return this.model;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      // 动态导入，避免模块在未安装时直接报错
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline(
        'text-classification',
        'Xenova/bge-reranker-v2-m3',
      );
      // 包装为接受批量输入的形式（pipeline 原生只支持单条）
      this.model = async (texts: string[], options?: any) => {
        const results: { score: number }[] = [];
        for (const text of texts) {
          const result = await pipe(text, options);
          results.push(result[0] as { score: number });
        }
        return results;
      };
      return this.model;
    })();

    try {
      return await this.loading;
    } catch (err) {
      // 加载失败：清除 loading 状态，下次调用时重试
      this.loading = null;
      throw err;
    }
  }
}

// ─── 默认实例 + 函数导出（向后兼容旧代码） ─────────────────────

const defaultReranker = new Reranker();

/**
 * 精排函数（向后兼容旧 API）
 * 对 RRF 融合后的候选片段进行精排，返回 top-K 结果
 *
 * @param query 用户查询文本
 * @param candidates RRF 融合后的候选片段列表（使用 chunk_text 字段）
 * @param topK 返回数量，默认 5
 */
export async function rerank(
  query: string,
  candidates: ChunkInput[],
  topK: number = 5,
): Promise<ChunkInput[]> {
  // 映射 ChunkInput → ChunkResult（补充 text 字段）
  const mapped = candidates.map(toChunkResult);
  const results = await defaultReranker.rerank(query, mapped);
  // 在兼容层做 topK 切片，返回原始字段 + rerankScore
  return results.slice(0, topK) as ChunkInput[];
}
