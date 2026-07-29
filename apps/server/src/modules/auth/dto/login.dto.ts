import { IsString } from 'class-validator';

/** 登录请求 DTO */
export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
