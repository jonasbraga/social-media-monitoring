import { Module } from '@nestjs/common';
import { SocialMediaController } from './social-media.controller';
import { SocialMediaService } from './social-media.service';
import { DynamoDbProvider } from './database/dynamodb.provider';
import { SocialMediaRepository } from './social-media.repository';

@Module({
  imports: [],
  controllers: [SocialMediaController],
  providers: [SocialMediaService, DynamoDbProvider, SocialMediaRepository],
})
export class SocialMediaModule {}
