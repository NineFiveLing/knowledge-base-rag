import { IsOptional, IsString, IsEnum } from 'class-validator';
import { DocumentVisibility } from '../entities/document.entity';

/** 编辑文档元信息请求体，全部字段可选 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;

  @IsOptional()
  @IsString()
  dept_id?: string;
}
