import { Module } from '@nestjs/common';
import { RAGService } from './rag.service';

/** RAG 引擎模块：LangGraph Agentic RAG 工作流 */
@Module({
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}
