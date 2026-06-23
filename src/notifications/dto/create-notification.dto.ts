import { IsString, IsNotEmpty, IsIn, MaxLength } from 'class-validator';

const VALID_CATEGORIES = [
  'red', 'orange', 'yellow', 'green', 'blue', 'black',
] as const;

export type NotificationCategory = typeof VALID_CATEGORIES[number];

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsIn(VALID_CATEGORIES, {
    message: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
  })
  category: string;
}
