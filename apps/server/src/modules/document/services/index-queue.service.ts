import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/** 文档索引队列生产者 */
@Injectable()
export class IndexQueueService {
  constructor(
    @InjectQueue('document-index') private readonly indexQueue: Queue,
  ) {}

  /** 将文档索引入队 */
  async addJob(docId: string): Promise<void> {
    await this.indexQueue.add('index-document', { docId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
