import { Controller, Get, Param } from '@nestjs/common';
import { SocialMediaService } from './social-media.service';

@Controller()
export class SocialMediaController {
  constructor(private readonly socialMediaService: SocialMediaService) {}

  @Get('/health')
  @HttpCode(200)
  getHealth() {
    return { status: 'UP Consumer' };
  }

  @Get('/tweets/consume/:hashtag')
  async consumeTweets(@Param('hashtag') hashtag: string) {
    // Start consuming tweets asynchronously
    this.socialMediaService.consumeTweets(hashtag);
    return { message: 'Started consuming tweets.' };
  }
}
