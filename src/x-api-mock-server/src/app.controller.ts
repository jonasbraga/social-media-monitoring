import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/tweets/search/stream/:hashtag')
  streamTweets(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Connection', 'keep-alive');

    let counter = 1;
    const tweetsInterval = setInterval(() => {
      const tweets = this.appService.getTweets();
      console.log('Sending tweets:', tweets);
      res.write(JSON.stringify(tweets) + '\n');
      if (counter++ === 10) {
        res.end();
      }
    }, 1000);

    res.on('close', () => {
      console.log(
        '======================== Closing connection ========================',
      );
      clearInterval(tweetsInterval);
      res.end();
    });
  }
}
