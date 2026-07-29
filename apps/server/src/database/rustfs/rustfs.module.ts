import { Module, Global } from '@nestjs/common';
import { RustFSService } from './rustfs.service';

/**
 * RustFS 对象存储模块
 * 全局可用，存储原始文件、提取的图片和附件
 */
@Global()
@Module({
  providers: [RustFSService],
  exports: [RustFSService],
})
export class RustFSModule {}
