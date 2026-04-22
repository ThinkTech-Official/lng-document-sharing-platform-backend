import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  new_password: string;

  @IsString()
  @IsNotEmpty()
  confirm_password: string;
}
