import { faker } from '@faker-js/faker';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getTweets(maxTweets: number = 10) {
    function generateTweets() {
      return {
        id: faker.string.uuid(),
        author_id: faker.string.uuid(),
        text: faker.lorem.lines(),
        created_at: faker.date.past(),
      };
    }
    const tweets = faker.helpers.multiple(generateTweets, {
      count: faker.number.int({ min: 0, max: maxTweets }),
    });
    return tweets;
  }
}
