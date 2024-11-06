import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDbProvider {
  public readonly docClient: DynamoDBDocument;

  constructor() {
    const client = new DynamoDBClient({ region: process.env.REGION });
    const marshallOptions = { removeUndefinedValues: true };
    const unmarshallOptions = { wrapNumbers: false };
    const translateConfig = { marshallOptions, unmarshallOptions };
    this.docClient = DynamoDBDocument.from(client, translateConfig);
  }
}
