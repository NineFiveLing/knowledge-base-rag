import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';

/**
 * 文档管理模块
 * 负责文档上传、解析、分块、索引全流程
 * 当前仅注册实体以确保 TypeORM 自动建表
 */
@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  exports: [TypeOrmModule],
})
export class DocumentModule {}
