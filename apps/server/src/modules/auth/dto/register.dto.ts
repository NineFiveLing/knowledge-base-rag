import { IsString, MinLength, MaxLength } from 'class-validator';

/** 注册请求 DTO */
export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  real_name!: string;

  @IsString()
  dept_id!: string;
}
