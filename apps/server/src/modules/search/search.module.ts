import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { VectorService } from '../../database/postgres/vector.service';

/** 混合检索模块：PGVector + ES + Neo4j + RRF 融合 + Rerank 精排 */
@Module({
  providers: [VectorService, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
