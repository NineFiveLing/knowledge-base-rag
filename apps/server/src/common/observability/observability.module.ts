import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';

/** 可观测性模块：LangFuse 追踪服务 */
@Module({
  imports: [ConfigModule],
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class ObservabilityModule {}
