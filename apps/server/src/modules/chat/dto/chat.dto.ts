import { IsString, IsOptional } from 'class-validator';

/** 聊天请求 DTO */
export class ChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  streamMessageId?: string;
}
