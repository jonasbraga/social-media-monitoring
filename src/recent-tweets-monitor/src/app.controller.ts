import axios from 'axios';
import { Controller, Get, Param, Res } from '@nestjs/common';

@Controller()
export class AppController {
  constructor() {}

  @Get('/tweets/consume/:hashtag')
  async consumeTweets(@Param('hashtag') hashtag, @Res() res: Response) {
    try {
      const response = await axios.get(
        `http://x-api-mock-server:3000/tweets/search/stream/${hashtag}`,
        {
          responseType: 'stream',
        },
      );
      let counter = 0;
      response.data.on('data', (chunk) => {
        try {
          const tweet = JSON.parse(chunk.toString());
          console.log(`${++counter}º tweet: `, tweet);
        } catch (error) {
          console.error('Error parsing tweet data:', error);
        }
      });

      response.data.on('error', (error) => {
        console.error('Stream error:', error);
        response.data.destroy(); // Properly close the current stream
        //setTimeout(connectToStream, 1000); // Retry after 1 second
      });

      response.data.on('end', () => {
        console.log('Stream ended unexpectedly. Reconnecting...');
        response.data.destroy(); // Ensure the current stream is closed
        // setTimeout(consumeTweets, 1000); // Retry after 1 second
      });
    } catch (error) {
      console.error('Failed to connect to the Twitter API:', error);
      //   setTimeout(consumeTweets, 1000); // Retry after 1 second if initial connection fails
    }

    //consumeTweets();
  }
}
