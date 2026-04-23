import { Global, Module } from '@nestjs/common';
import { AzureStorageService } from './azure-storage.service';

@Global()
@Module({
  providers: [AzureStorageService],
  exports: [AzureStorageService],
})
export class AzureModule {}
