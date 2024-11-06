export interface TweetSocialMediaData {
  provider: string;
  tweetId: string; // ID from the social media platform
  text: string;
  authorId: string;
  createdAt: string;
  extraData?: Record<string, any>; // For additional data
}
