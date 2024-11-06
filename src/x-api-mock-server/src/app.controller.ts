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
    @Res() res: Response,
    @Query('limit') limit?: number,
    @Query('frequency') frequency?: number,
    @Query('maxTweets') maxTweets?: number,
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'keep-alive');

    const finalFrequency = frequency ?? 1000;
    const finalMaxTweets = maxTweets ?? 10; // Default to 50 if maxTweets is undefined

    let count = 0;
    const maxCount = limit ?? 10; // Default to 10 if limit is undefined

    const tweetsInterval = setInterval(() => {
      if (maxCount && count >= maxCount) {
        clearInterval(tweetsInterval);
        res.end();
        return;
      }

      const tweets = this.appService.getTweets(finalMaxTweets);
      console.log('Sending tweets:', tweets);
      res.write(JSON.stringify(tweets) + '\n');
      count++;
    }, finalFrequency);

    res.on('close', () => {
      console.log(
        '======================== Closing connection ========================',
      );
      clearInterval(tweetsInterval);
      res.end();
    });
  }
}
