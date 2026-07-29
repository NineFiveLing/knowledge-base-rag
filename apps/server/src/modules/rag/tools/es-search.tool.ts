import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** Elasticsearch 全文检索工具（BM25 关键字搜索） */
export function createESSearchTool(searchFn: (query: string) => Promise<string>) {
  return tool(
    async ({ query }) => searchFn(query),
    {
      name: 'keyword_search',
      description: '按关键字全文搜索文档，适合查找特定名词、编号、流程名',
      schema: z.object({ query: z.string().describe('关键字搜索查询') }),
    },
  );
}
