import { Module } from '@nestjs/common';
import { SocialMediaController } from './social-media.controller';
import { SocialMediaService } from './social-media.service';
import { DynamoDbProvider } from './database/dynamodb.provider';
import { SocialMediaRepository } from './social-media.repository';
import { MetricsService } from '../metric/metric.service';

@Module({
  imports: [],
  controllers: [SocialMediaController],
  providers: [
    SocialMediaService,
    DynamoDbProvider,
    SocialMediaRepository,
    MetricsService,
  ],
})
export class SocialMediaModule {}
