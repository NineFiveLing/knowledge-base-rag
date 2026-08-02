import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule, InjectDataSource } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { Document } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { PdfParser } from './parsers/pdf.parser';
import { WordParser } from './parsers/word.parser';
import { MarkdownParser } from './parsers/markdown.parser';
import { TextParser } from './parsers/text.parser';
import { ExcelParser } from './parsers/excel.parser';
import { PptParser } from './parsers/ppt.parser';
import { ImageParser } from './parsers/image.parser';
import { AudioParser } from './parsers/audio.parser';
import { VideoParser } from './parsers/video.parser';
import { DocumentParser } from './parsers/parser.interface';
import { ChunkerService } from './services/chunker.service';
import { IndexerService } from './services/indexer.service';
import { IndexQueueService } from './services/index-queue.service';
import { IndexWorkerService } from './services/index-worker.service';
import { MongoDBModule } from '../../database/mongodb/mongodb.module';

/** 文档管理模块：上传、解析、分块、索引全流程 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentVersion]),
    MongoDBModule,
    BullModule.registerQueue({
      name: 'document-index',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  controllers: [DocumentController],
  providers: [
    DocumentService, ChunkerService, IndexerService,
    IndexQueueService, IndexWorkerService,
    PdfParser, WordParser, MarkdownParser, TextParser,
    ExcelParser, PptParser,
    ImageParser, AudioParser, VideoParser,
  ],
  exports: [TypeOrmModule, DocumentService, IndexerService],
})
export class DocumentModule implements OnModuleInit {
  constructor(
    private docService: DocumentService,
    @InjectDataSource() private dataSource: DataSource,
    private pdfParser: PdfParser,
    private wordParser: WordParser,
    private mdParser: MarkdownParser,
    private textParser: TextParser,
    private excelParser: ExcelParser,
    private pptParser: PptParser,
    private imageParser: ImageParser,
    private audioParser: AudioParser,
    private videoParser: VideoParser,
  ) {}

  async onModuleInit() {
    const parsers: DocumentParser[] = [
      this.pdfParser, this.wordParser, this.mdParser, this.textParser,
      this.excelParser, this.pptParser,
      this.imageParser, this.audioParser, this.videoParser,
    ];
    for (const p of parsers) {
      this.docService.registerParser(p);
    }

    // 启用 pg_trgm 扩展 + GIN 索引，加速 ILIKE '%keyword%' 文件名搜索
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await this.dataSource.query(
        'CREATE INDEX IF NOT EXISTS idx_documents_name_trgm ON documents USING GIN (name gin_trgm_ops)',
      );
      Logger.log('pg_trgm 扩展和文件名搜索索引已就绪', 'DocumentModule');
    } catch (err) {
      Logger.warn('pg_trgm 索引初始化失败，文件名搜索可能较慢', 'DocumentModule');
    }
  }
}
