import { Injectable } from '@nestjs/common';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { SocialMediaData } from './interfaces/social-media-data.interface';
import { DynamoDbProvider } from './database/dynamodb.provider';

@Injectable()
export class SocialMediaRepository {
  private readonly tableName = 'YourDynamoDBTableName'; // Replace with your actual table name

  private readonly docClient: DynamoDBDocumentClient;

  constructor(private readonly dynamoDbProvider: DynamoDbProvider) {
    this.docClient = dynamoDbProvider.docClient;
  }

  private generateRequestId(): string {
    return ulid();
  }

  private constructPK(provider: string, requestId: string): string {
    return `${provider}#${requestId}`;
  }

  private constructSK(criteria: string, id: string): string {
    return `${criteria}#${id}`;
  }

  async batchCreate(dataArray: SocialMediaData[]): Promise<void> {
    const requestId = this.generateRequestId();
    const writeRequests = dataArray.map((data) => ({
      PutRequest: {
        Item: {
          PK: this.constructPK(data.provider, requestId),
          SK: this.constructSK('CRITERIA', data.id),
          ...data,
        },
        // Don't insert if the item already exists
        ConditionExpression: 'attribute_not_exists(SK)',
      },
    }));

    const batches = [];
    const batchSize = 25;

    for (let i = 0; i < writeRequests.length; i += batchSize) {
      const batch = writeRequests.slice(i, i + batchSize);
      batches.push(batch);
    }

    for (const batch of batches) {
      const params = {
        RequestItems: {
          [this.tableName]: batch,
        },
      };
      try {
        await this.docClient.send(new BatchWriteCommand(params));
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') {
          throw error;
        }
        // Handle duplicate entries silently
      }
    }
  }

  // Additional CRUD methods (read, update, delete)
}
