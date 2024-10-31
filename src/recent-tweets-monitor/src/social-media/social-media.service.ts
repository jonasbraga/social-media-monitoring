// src/social-media/social-media.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SocialMediaRepository } from './social-media.repository';
import { SocialMediaData } from './interfaces/social-media-data.interface';
import axios from 'axios';
import { TwitterAdapter } from './adapters/twitter.adapter';

@Injectable()
export class SocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private readonly repository: SocialMediaRepository) {}

  async consumeTweets(hashtag: string): Promise<void> {
    await this.connectToStream(hashtag);
  }

  private async connectToStream(hashtag: string): Promise<void> {
    try {
      const response = await axios.get(
        `http://x-api-mock-server:3000/tweets/search/stream/${hashtag}`,
        {
          responseType: 'stream',
          // timeout: 60000, // Timeout to handle idle connections
        },
      );

      const tweetsBuffer: Omit<SocialMediaData, 'provider'>[] = [];
      const batchSize = 25;
      let counter = 0;

      // Event Handlers
      const onData = this.handleDataEvent.bind(
        this,
        tweetsBuffer,
        batchSize,
        counter,
      );
      const onError = this.handleErrorEvent.bind(
        this,
        tweetsBuffer,
        hashtag,
        response,
      );
      const onEnd = this.handleEndEvent.bind(this, tweetsBuffer, hashtag);

      // Assign event handlers
      response.data.on('data', onData);
      response.data.on('error', onError);
      response.data.on('end', onEnd);

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
    } catch (error) {
      this.logger.error('Failed to connect to the tweet stream API:', error);
      await this.reconnectWithBackoff(hashtag);
    }
  }

  private async handleDataEvent(
    tweetsBuffer: Omit<SocialMediaData, 'provider'>[],
    batchSize: number,
    tweets: any,
  ): Promise<void> {
    try {
      const tweetData = tweets.map(TwitterAdapter.toSocialMediaData);

      tweetsBuffer.push(...tweetData);

      if (tweetsBuffer.length >= batchSize) {
        await this.addTweets(tweetsBuffer);
        tweetsBuffer.length = 0;
      }
    } catch (error) {
      this.logger.error('Error parsing tweet data:', error);
    }
  }

  private async handleErrorEvent(
    tweetsBuffer: Omit<SocialMediaData, 'provider'>[],
    hashtag: string,
    response: any,
    error: any,
  ): Promise<void> {
    this.logger.error('Stream error:', error);
    response.data.destroy();
    await this.handleStreamEnd(tweetsBuffer, hashtag);
  }

  private async handleEndEvent(
    tweetsBuffer: Omit<SocialMediaData, 'provider'>[],
    hashtag: string,
  ): Promise<void> {
    this.logger.warn('Stream ended.');
    await this.handleStreamEnd(tweetsBuffer, hashtag);
  }

  private async handleStreamEnd(
    tweetsBuffer: Omit<SocialMediaData, 'provider'>[],
    hashtag: string,
  ): Promise<void> {
    // Save any remaining tweets
    if (tweetsBuffer.length > 0) {
      await this.addTweets(tweetsBuffer);
      tweetsBuffer.length = 0;
    }
    // Attempt to reconnect
    await this.reconnectWithBackoff(hashtag);
  }

  private async reconnectWithBackoff(hashtag: string): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached. Giving up.');
      return;
    }
    const delay = this.calculateBackoffDelay(this.reconnectAttempts);
    this.logger.warn(`Reconnecting in ${delay} ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.reconnectAttempts += 1;
    await this.connectToStream(hashtag);
  }

  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
    return delay;
  }

  async addTweets(
    dataArray: Omit<SocialMediaData, 'provider'>[],
  ): Promise<void> {
    const dataWithProvider = dataArray.map((data) => ({
      ...data,
      provider: 'twitter',
    }));
    await this.repository.batchCreate(dataWithProvider);
  }
}
