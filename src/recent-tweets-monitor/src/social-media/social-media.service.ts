// src/social-media/social-media.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SocialMediaRepository } from './social-media.repository';
import { TweetSocialMediaData } from './interfaces/social-media-data.interface';
import axios, { AxiosResponse } from 'axios';
import { TwitterAdapter } from './adapters/twitter.adapter';

@Injectable()
export class SocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private options: { limit: number; frequency: number; maxTweets: number };
  private dataBuffer = '';
  private BATCH_SIZE = 25;

  constructor(private readonly repository: SocialMediaRepository) {}

  async consumeTweets(
    hashtag: string,
    options: { limit: number; frequency: number; maxTweets: number },
  ): Promise<void> {
    this.options = options;
    await this.connectToStream(hashtag);
  }

  private async connectToStream(hashtag: string): Promise<void> {
    try {
      const response = await axios.get(
        `${process.env.PUBLISHER_ENDPOINT!}/tweets/search/stream/${hashtag}`,
        {
          params: this.options,
          responseType: 'stream',
          // timeout: 60000, // Timeout to handle idle connections
        },
      );

      const tweetsBuffer: Omit<TweetSocialMediaData, 'provider'>[] = [];

      // Event Handlers
      const onData = this.handleDataEvent.bind(this, tweetsBuffer, hashtag);
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
    tweetsBuffer: Omit<TweetSocialMediaData, 'provider'>[],
    hashtag: string,
    tweetsChunk: Buffer,
  ): Promise<void> {
    try {
      this.logger.log(`Stream data received: ${tweetsChunk.length} bytes`);
      // Accumulate incoming chunks
      this.dataBuffer += tweetsChunk.toString();

      // Extract complete JSON arrays from the dataBuffer, this is usually needed because sometimes the data is not received in full JSON arrays, but cut off in the middle
      const tweets = this.extractCompleteArraysFromBuffer();
      this.logger.log(`Extracted ${tweets.length} tweets from last chunk`);

      // Process each tweet received from the stream data in batches
      if (tweets.length > 0) {
        const tweetData = tweets.map(TwitterAdapter.toSocialMediaData);
        tweetsBuffer.push(...tweetData);

        if (tweetsBuffer.length >= this.BATCH_SIZE) {
          await this.addTweets(tweetsBuffer, hashtag);
          tweetsBuffer.length = 0;
          this.logger.log('Buffer cleared');
        }
      }
    } catch (error) {
      this.logger.error('Error processing tweet data:', error);
    }
  }

  private async handleErrorEvent(
    tweetsBuffer: Omit<TweetSocialMediaData, 'provider'>[],
    hashtag: string,
    response: AxiosResponse,
    error: any,
  ): Promise<void> {
    this.logger.error('Stream error:', error);
    response.data.destroy();
    await this.handleStreamEnd(tweetsBuffer, hashtag, true);
  }

  private async handleEndEvent(
    tweetsBuffer: Omit<TweetSocialMediaData, 'provider'>[],
    hashtag: string,
  ): Promise<void> {
    this.logger.warn('Stream ended.');
    await this.handleStreamEnd(tweetsBuffer, hashtag);
  }

  private async handleStreamEnd(
    tweetsBuffer: Omit<TweetSocialMediaData, 'provider'>[],
    hashtag: string,
    reconnect: boolean = false,
  ): Promise<void> {
    // Save any remaining tweets
    if (tweetsBuffer.length > 0) {
      this.logger.log(`Saving ${tweetsBuffer.length} remaining tweets...`);
      await this.addTweets(tweetsBuffer, hashtag);
      tweetsBuffer.length = 0;
    }
    // Attempt to reconnect
    reconnect && (await this.reconnectWithBackoff(hashtag));
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
    const baseDelay = 1000;
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
    return delay;
  }

  async addTweets(
    dataArray: Omit<TweetSocialMediaData, 'provider'>[],
    hashtag: string,
  ): Promise<void> {
    const dataWithProvider = dataArray.map((data) => ({
      ...data,
      provider: 'twitter',
    }));
    this.logger.log(`Saving ${dataWithProvider.length} tweets...`);
    await this.repository.batchInsertion(dataWithProvider, hashtag);
  }

  private extractCompleteArraysFromBuffer(): any[] {
    const tweetsList = [];
    const arrayRegex = /\[.*?\]/gs;
    let match;

    // Extract all complete JSON arrays (everything inside brackets []) from the buffer
    while ((match = arrayRegex.exec(this.dataBuffer)) !== null) {
      const jsonString = match[0];

      try {
        const parsedArray = JSON.parse(jsonString);
        tweetsList.push(...parsedArray);

        // Remove the processed part from the buffer
        this.dataBuffer = this.dataBuffer.slice(
          match.index + jsonString.length,
        );

        // Reset regex lastIndex since dataBuffer has changed
        arrayRegex.lastIndex = 0;
      } catch (e) {
        // Parsing failed; likely incomplete JSON
        break; // Wait for more data in the next chunk
      }
    }

    return tweetsList;
  }
}
