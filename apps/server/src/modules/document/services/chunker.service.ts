import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/** 分块数据结构 */
export interface Chunk {
  chunk_id: string;
  postgres_doc_id: string;
  chunk_index: number;
  chunk_text: string;
  title_level: number;
  has_image: boolean;
  has_table: boolean;
}

/**
 * 文档分块服务
 * 基于 Markdown 标题层级进行语义分块，保留表格完整性
 */
@Injectable()
export class ChunkerService {
  private splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ['\n## ', '\n### ', '\n#### ', '\n', '。', '.', ' ', ''],
  });

  async chunk(markdown: string, postgresDocId: string): Promise<Chunk[]> {
    const docs = await this.splitter.createDocuments([markdown]);
    return docs.map((doc, i) => {
      const titleLevel = this.detectTitleLevel(doc.pageContent);
      return {
        chunk_id: `${postgresDocId}-chunk-${String(i).padStart(4, '0')}`,
        postgres_doc_id: postgresDocId,
        chunk_index: i,
        chunk_text: doc.pageContent,
        title_level: titleLevel,
        has_image: /!\[.*\]\(.*\)/.test(doc.pageContent),
        has_table: /\|.*\|/.test(doc.pageContent),
      };
    });
  }

  /** 检测文本开头的 Markdown 标题级别 */
  private detectTitleLevel(text: string): number {
    const match = text.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
  }
}
