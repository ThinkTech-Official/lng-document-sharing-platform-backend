import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingArchiveService } from './logging.archive.service';
import { LoggingController } from './logging.controller';
import { LoggingService } from './logging.service';
import { RequestMetaInterceptor } from './interceptors/request-meta.interceptor';

@Global()
@Module({
  controllers: [LoggingController],
  providers: [
    LoggingService,
    LoggingArchiveService,
    // Register as a global interceptor so every request gets ip + user_agent attached
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestMetaInterceptor,
    },
  ],
  exports: [LoggingService],
})
export class LoggingModule {}
