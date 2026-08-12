import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { SearchModule } from '../search/search.module';
import { MemoryModule } from '../memory/memory.module';
import { Document } from '../document/entities/document.entity';

/** RAG 引擎模块：LangGraph Agentic RAG 工作流 */
@Module({
  imports: [SearchModule, MemoryModule, TypeOrmModule.forFeature([Document])],
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}
