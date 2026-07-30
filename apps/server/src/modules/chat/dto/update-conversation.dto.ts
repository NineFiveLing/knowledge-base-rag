import { IsString, MaxLength } from 'class-validator';

export class UpdateConversationDto {
  @IsString()
  @MaxLength(255)
  title!: string;
}
