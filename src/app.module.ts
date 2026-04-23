import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AzureModule, LoggingModule, AuthModule, UsersModule, DepartmentsModule, CategoriesModule, DocumentsModule, VideosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
