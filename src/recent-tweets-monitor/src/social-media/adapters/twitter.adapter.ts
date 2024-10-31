import { SocialMediaData } from '../interfaces/social-media-data.interface';

export class TwitterAdapter {
  static toSocialMediaData(tweet: any): Omit<SocialMediaData, 'provider'> {
    return {
      id: tweet.id,
      text: tweet.text,
      author_id: tweet.author_id,
      created_at: tweet.created_at,
      extraData: {
        // e.g.
        // retweet_count: tweet.retweet_count,
        // like_count: tweet.like_count,
      },
    };
  }
}
