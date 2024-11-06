import { TweetSocialMediaData } from '../interfaces/social-media-data.interface';

export class TwitterAdapter {
  static toSocialMediaData(tweet: any): TweetSocialMediaData {
    return {
      tweetId: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      createdAt: tweet.created_at,
      // extraData: {
      // e.g.
      // retweet_count: tweet.retweet_count,
      // like_count: tweet.like_count,
      // },
    };
  }
}
