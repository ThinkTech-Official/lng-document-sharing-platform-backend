import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';

const VALID_CATEGORIES = [
  'red', 'orange', 'yellow', 'green', 'blue', 'black',
] as const;

export class UpdateNotificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_CATEGORIES, {
    message: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
  })
  category?: string;
}
