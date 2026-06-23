import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AzureModule } from './azure/azure.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { CategoriesModule } from './categories/categories.module';
import { DocumentsModule } from './documents/documents.module';
import { VideosModule } from './videos/videos.module';
import { LoggingModule } from './logging/logging.module';
import { StatsModule } from './stats/stats.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'short', ttl: 60000, limit: 10 }]),
    PrismaModule,
    AzureModule,
    LoggingModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    CategoriesModule,
    DocumentsModule,
    VideosModule,
    StatsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
