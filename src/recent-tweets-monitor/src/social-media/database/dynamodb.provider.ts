import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDbProvider {
  public readonly docClient: DynamoDBDocumentClient;

  constructor() {
    const client = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = { removeUndefinedValues: true };
    const unmarshallOptions = { wrapNumbers: false };
    const translateConfig = { marshallOptions, unmarshallOptions };
    this.docClient = DynamoDBDocumentClient.from(client, translateConfig);
  }
}
