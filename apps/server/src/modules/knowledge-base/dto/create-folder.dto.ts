import { IsUUID, IsString, IsOptional, Length } from 'class-validator';

export class CreateFolderDto {
  @IsUUID()
  kb_id!: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsString()
  @Length(1, 200)
  name!: string;
}
