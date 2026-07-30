import { Module } from '@nestjs/common';
import { RAGService } from './rag.service';
import { SearchModule } from '../search/search.module';
import { MemoryModule } from '../memory/memory.module';

/** RAG 引擎模块：LangGraph Agentic RAG 工作流 */
@Module({
  imports: [SearchModule, MemoryModule],
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}
