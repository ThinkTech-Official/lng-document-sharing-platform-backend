import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateContractorDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
