import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  parent_category_id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}
