import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** PGVector 向量检索工具（语义相似度搜索） */
export function createVectorSearchTool(searchFn: (query: string) => Promise<string>) {
  return tool(
    async ({ query }) => searchFn(query),
    {
      name: 'vector_search',
      description: '语义搜索文档库内容，适合概念性、描述性问题',
      schema: z.object({ query: z.string().describe('搜索查询文本') }),
    },
  );
}
