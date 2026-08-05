import { IsString, IsOptional, IsArray, IsUUID, MinLength, MaxLength, IsEmail } from 'class-validator';

/** 创建用户 DTO */
export class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(50)
  username!: string;

  @IsString() @MinLength(6) @MaxLength(100)
  password!: string;

  @IsString() @MinLength(1) @MaxLength(50)
  real_name!: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsString() @IsOptional()
  phone?: string;

  @IsUUID() @IsOptional()
  dept_id?: string;

  @IsArray() @IsUUID('4', { each: true }) @IsOptional()
  roleIds?: string[];
}

/** 更新用户信息 DTO */
export class UpdateUserDto {
  @IsString() @IsOptional() @MinLength(2) @MaxLength(50)
  username?: string;

  @IsString() @IsOptional() @MinLength(1) @MaxLength(50)
  real_name?: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsString() @IsOptional()
  phone?: string;

  @IsUUID() @IsOptional()
  dept_id?: string;
}

/** 管理员重置用户密码 DTO */
export class ResetPasswordDto {
  @IsString() @MinLength(6) @MaxLength(100)
  newPassword!: string;
}

/** 用户自行修改密码 DTO */
export class ChangePasswordDto {
  @IsString() @MinLength(6) @MaxLength(100)
  oldPassword!: string;

  @IsString() @MinLength(6) @MaxLength(100)
  newPassword!: string;
}

/** 为用户分配角色 DTO */
export class UpdateUserRolesDto {
  @IsArray() @IsUUID('4', { each: true })
  roleIds!: string[];
}
