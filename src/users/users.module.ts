import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ContractorController } from './contractor.controller';
import { ContractorService } from './contractor.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, ContractorController],
  providers: [AdminService, ContractorService],
})
export class UsersModule {}
