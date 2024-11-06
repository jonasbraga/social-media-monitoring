import { Controller, Get, HttpCode, Param, Query, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/health')
  @HttpCode(200)
  getHealth() {
    return { status: 'UP Publisher' };
  }

  @Get('/tweets/search/stream/:hashtag')
  streamTweets(
    @Param('hashtag') hashtag: string,
    @Query('limit', ParseIntPipe) limit: number,
    @Query('frequency', ParseIntPipe) frequency: number,
    @Query('maxTweets', ParseIntPipe) maxTweets: number,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'keep-alive');

    let count = 0;
    const maxCount = limit;

    const tweetsInterval = setInterval(() => {
      if (maxCount && count >= maxCount) {
        clearInterval(tweetsInterval);
        res.end();
        return;
      }

      const tweets = this.appService.getTweets(maxTweets);
      console.log('Sending tweets:', tweets);
      res.write(JSON.stringify(tweets) + '\n');
      count++;
    }, frequency || 1000);

    res.on('close', () => {
      console.log(
        '======================== Closing connection ========================',
      );
      clearInterval(tweetsInterval);
      res.end();
    });
  }
}
