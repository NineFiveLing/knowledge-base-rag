import { Global, Module } from '@nestjs/common';
import { LangfuseService } from './langfuse.service';

/** 可观测性模块：全局模块，提供 LangfuseService */
@Global()
@Module({
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class ObservabilityModule {}
