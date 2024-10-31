export interface SocialMediaData {
  provider: string;
  id: string; // ID from the social media platform
  text: string;
  author_id: string;
  created_at: string;
  extraData?: Record<string, any>; // For additional data
}
