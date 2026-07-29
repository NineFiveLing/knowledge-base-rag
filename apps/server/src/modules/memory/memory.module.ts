import { Module } from '@nestjs/common';
import { RedisMemoryAdapter } from './adapters/redis.adapter';
import { Mem0Adapter } from './adapters/mem0.adapter';
import { MemoryService } from './memory.service';

/** 分层记忆模块：Redis 短期记忆 + Mem0 长期记忆 */
@Module({
  providers: [RedisMemoryAdapter, Mem0Adapter, MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
