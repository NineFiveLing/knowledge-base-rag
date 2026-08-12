import { Module } from '@nestjs/common';
import { RAGModule } from '../rag/rag.module';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { ExcelParserService } from './excel-parser.service';
import { EvalScorerService } from './eval-scorer.service';
import { LangfuseEvalService } from '../rag/langfuse-eval.service';
import { EvalUploadCommand } from './eval.command';
import { EvalRunCommand } from './eval.command';

/**
 * 评测模块：提供 Excel 评测集解析和 LangFuse 评测能力
 */
@Module({
  imports: [RAGModule, ObservabilityModule],
  providers: [ExcelParserService, EvalScorerService, LangfuseEvalService, EvalUploadCommand, EvalRunCommand],
  exports: [LangfuseEvalService],
})
export class EvalModule {}
