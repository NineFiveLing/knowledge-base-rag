import { IsString, IsArray, IsOptional, MinLength, MaxLength } from 'class-validator';

/** 创建角色 DTO */
export class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(50)
  name!: string;

  @IsString() @IsOptional()
  code?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsArray() @IsString({ each: true })
  permissionCodes!: string[];
}

/** 更新角色 DTO */
export class UpdateRoleDto {
  @IsString() @IsOptional() @MinLength(2) @MaxLength(50)
  name?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsArray() @IsOptional() @IsString({ each: true })
  permissionCodes?: string[];
}

/** 分配角色 DTO */
export class AssignRoleDto {
  @IsArray() @IsString({ each: true })
  roleIds!: string[];
}
