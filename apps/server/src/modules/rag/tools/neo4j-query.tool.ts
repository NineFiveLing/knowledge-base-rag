import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** Neo4j 知识图谱查询工具（实体关系多跳推理） */
export function createNeo4jQueryTool(queryFn: (entity: string) => Promise<string>) {
  return tool(
    async ({ entity }) => queryFn(entity),
    {
      name: 'knowledge_graph_query',
      description: '查询知识图谱获取实体关系。"xxx和xxx的关系""xxx属于哪个部门"等',
      schema: z.object({ entity: z.string().describe('要查询的实体名称') }),
    },
  );
}
