import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class UpdateDocumentDto {
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

  @IsOptional()
  @IsUrl({}, { message: 'external_url must be a valid URL' })
  external_url?: string;
}
