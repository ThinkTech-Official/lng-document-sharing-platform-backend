import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ListVideosDto {
  // Admin-only filter; ignored for contractors (always forced to true)
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_live?: boolean;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
