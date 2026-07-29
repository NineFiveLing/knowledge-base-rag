/**
 * 精排器相关类型定义
 * ChunkResult 为 Cross-Encoder Reranker 的输入/输出类型
 */
export interface ChunkResult {
  chunk_id: string;
  postgres_doc_id: string;
  /** 片段文本（Cross-Encoder 使用此字段） */
  text: string;
  /** 多路检索融合后的原始分数（RRF score） */
  score: number;
  /** 精排后的分数（Cross-Encoder 生成，0-1） */
  rerankScore?: number;
  /** 向后兼容：旧代码使用 chunk_text 字段名 */
  chunk_text?: string;
  /** 附加元信息，如文档名称、关键词等 */
  metadata?: Record<string, any>;
}
