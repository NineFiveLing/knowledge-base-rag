import { IsString, IsEmail, MinLength, MaxLength, ValidationOptions, IsOptional } from 'class-validator';

/** 注册请求 DTO */
export class RegisterDto {
  @IsString({ message: '用户名需为字符串' })
  @MinLength(3, { message: '用户名至少3个字符' })
  @MaxLength(30, { message: '用户名最多30个字符' })
  username!: string;

  @IsString({ message: '密码需为字符串' })
  @MinLength(6, { message: '密码至少6个字符' })
  password!: string;

  @IsString({ message: '真实姓名需为字符串' })
  @MinLength(1, { message: '请输入真实姓名' })
  real_name!: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string;

  @IsString({ message: '手机号需为字符串' })
  @IsOptional()
  phone?: string;

  @IsString({ message: '部门ID需为字符串' })
  @MinLength(1, { message: '请选择所属部门' })
  dept_id!: string;
}
