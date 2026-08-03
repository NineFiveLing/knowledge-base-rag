import { IsString, MaxLength } from 'class-validator';

/** TTS 合成请求 DTO */
export class TtsDto {
  @IsString()
  @MaxLength(5000)
  text!: string;

  @IsString()
  messageId!: string;

  @IsString()
  sessionId!: string;
}
