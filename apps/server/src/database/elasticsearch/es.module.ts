import { Module, Global } from '@nestjs/common';
import { ElasticsearchService } from './es.service';

/**
 * Elasticsearch 全文检索模块
 * 全局可用，存储文档分块的倒排索引（IK 中文分词 + 拼音）
 */
@Global()
@Module({
  providers: [ElasticsearchService],
  exports: [ElasticsearchService],
})
export class ElasticsearchModule {}
