import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IndexerService } from './indexer.service';

/**
 * 文档索引队列消费者
 * 自动消费 'document-index' 队列中的任务，调用 IndexerService 执行实际索引。
 * IndexerService.indexDocument() 内部已管理全部状态转换（INDEXING→INDEXED/FAILED），
 * 最后一轮重试失败时内部会将状态设为 FAILED 并 rethrow。
 */
@Processor('document-index')
@Injectable()
export class IndexWorkerService extends WorkerHost {
  private readonly logger = new Logger(IndexWorkerService.name);

  constructor(
    private readonly indexer: IndexerService,
  ) {
    super();
  }

  async process(job: Job<{ docId: string }>): Promise<void> {
    const { docId } = job.data;
    this.logger.log(`开始索引文档: ${docId}（尝试 ${job.attemptsMade + 1}/3）`);

    try {
      await this.indexer.indexDocument(docId);
      this.logger.log(`索引完成: ${docId}`);
    } catch (err) {
      this.logger.error(`索引失败: ${docId}`, (err as Error).message);
      throw err; // BullMQ 根据 attempts 配置自动重试
    }
  }
}
