import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category_id?: string;
}
