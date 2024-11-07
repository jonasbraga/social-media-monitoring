import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Query,
} from '@nestjs/common';
import { SocialMediaService } from './social-media.service';

@Controller()
export class SocialMediaController {
  private readonly logger = new Logger(SocialMediaController.name);

  constructor(private readonly socialMediaService: SocialMediaService) {}

  @Get('/consumer/health')
  @HttpCode(200)
  getHealth() {
    return { status: 'UP Consumer' };
  }

  @Get('/tweets/consume/:hashtag')
  consumeTweets(
    @Param('hashtag') hashtag: string,
    @Query('limit') limit?: number,
    @Query('frequency') frequency?: number,
    @Query('maxTweets') maxTweets?: number,
  ) {
    const requestOptions = {
      limit,
      frequency,
      maxTweets,
    };
    this.logger.debug('Request options:', requestOptions);

    // Start consuming tweets asynchronously
    this.socialMediaService.consumeTweets(hashtag, requestOptions);
    return { message: 'Started consuming tweets.' };
  }

  // Add more endpoints for different social media providers
  // Or refactor the existing one to accept multiple providers
}
