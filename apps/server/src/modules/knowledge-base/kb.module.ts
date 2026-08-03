import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { Folder } from './entities/folder.entity';
import { Document } from '../document/entities/document.entity';
import { KnowledgeBaseService } from './kb.service';
import { KnowledgeBaseController } from './kb.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Folder, Document])],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [TypeOrmModule, KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
