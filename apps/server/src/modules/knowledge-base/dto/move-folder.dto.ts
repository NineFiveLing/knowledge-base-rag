import { IsUUID, IsOptional } from 'class-validator';

export class MoveFolderDto {
  @IsOptional()
  @IsUUID()
  new_parent_id?: string | null;  // null 表示移到根目录
}
