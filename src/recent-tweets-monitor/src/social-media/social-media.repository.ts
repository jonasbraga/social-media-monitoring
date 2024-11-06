import { Injectable, Logger } from '@nestjs/common';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { monotonicFactory } from 'ulid';
import { SocialMediaData } from './interfaces/social-media-data.interface';
import { DynamoDbProvider } from './database/dynamodb.provider';

@Injectable()
export class SocialMediaRepository {
  private readonly logger = new Logger(SocialMediaRepository.name);
  private readonly tableName = process.env.TABLE_NAME!;
  private BATCH_SIZE = 25;

  private readonly docClient: DynamoDBDocumentClient;
  private counter = 0;

  constructor(private readonly dynamoDbProvider: DynamoDbProvider) {
    this.docClient = dynamoDbProvider.docClient;
  }

  ulid = monotonicFactory();

  private generateSortedId(): string {
    return this.ulid(new Date().getTime());
  }

  private constructPK(provider: string, criteria: string): string {
    return `${provider}#${criteria}`;
  }

  async batchInsertion(
    dataArray: SocialMediaData[],
    criteria: string,
  ): Promise<void> {
    const requestId = this.generateRequestId();
    this.counter += dataArray.length;
    const writeRequests = dataArray.map((data) => ({
      PutRequest: {
        Item: {
          'PROVIDER#CRITERIA': this.constructPK(data.provider, criteria),
          ID: this.generateSortedId(),
          ...data,
          timestamp: new Date().getTime(),
        },
        ConditionExpression: 'attribute_not_exists(SK)', // Don't insert if the item already exists
      },
    }));

    const batches = [];
    const maxConcurrentBatchesExecution = 10;

    this.logger.log(`Creating batches of ${this.BATCH_SIZE} items`);
    for (let i = 0; i < writeRequests.length; i += this.BATCH_SIZE) {
      const batch = writeRequests.slice(i, i + this.BATCH_SIZE);
      batches.push(batch);
    }

    this.logger.log(
      `Creating batches of ${maxConcurrentBatchesExecution} insertion promises`,
    );
    for (let i = 0; i < batches.length; i += maxConcurrentBatchesExecution) {
      const concurrentBatches = batches.slice(
        i,
        i + maxConcurrentBatchesExecution,
      );
      const concurrentPromises = concurrentBatches.map((batch) => {
        const params = {
          RequestItems: {
            [this.tableName]: batch,
          },
        };

        // const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // return sleep(Math.floor(Math.random() * 400) + 100);

        return this.docClient
          .send(new BatchWriteCommand(params))
          .catch((error) => {
            // Handle duplicate entries silently
            if (error.name !== 'ConditionalCheckFailedException') {
              this.logger.error('Error inserting items:', error);
              // Ideally retry this specific batch (DLQ)
              throw error;
            }
          });
      });
      // Wait for this set of concurrent batches to complete before starting the next set
      await Promise.all(concurrentPromises);
    }
    this.logger.log(`Inserted ${writeRequests.length} items`);
    this.logger.log(`Total of ${this.counter} items inserted so far`);
  }
}
