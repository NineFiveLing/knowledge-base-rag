import { IsOptional, IsString, IsInt, Min, Max, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentStatus } from '../entities/document.entity';

/** 文档列表查询参数 DTO：支持分页、状态、类型和关键词过滤 */
export class ListDocumentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsUUID()
  kb_id?: string;

  @IsOptional()
  @IsUUID()
  folder_id?: string;
}
