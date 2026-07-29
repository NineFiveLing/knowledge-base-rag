import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis 缓存模块
 * 全局可用，存储会话滑动窗口和检索结果缓存
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
