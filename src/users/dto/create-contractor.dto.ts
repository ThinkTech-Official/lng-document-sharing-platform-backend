import { IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateContractorDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  department_ids?: string[];
}
