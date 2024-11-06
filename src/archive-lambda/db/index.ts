import type {
  UpdateCommandInput,
  DeleteCommandOutput,
  GetCommandOutput,
  PutCommandOutput,
  UpdateCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

type databaseItem = Record<string, unknown>;

export interface IDatabase {
  save(item: databaseItem, table?: string): Promise<PutCommandOutput>;
  read(pk: object, sk?: object, table?: string): Promise<GetCommandOutput>;
  update(
    pk: object,
    updateItem: object,
    sk?: object,
    table?: string
  ): Promise<UpdateCommandOutput>;
  delete(pk: object, sk?: object, table?: string): Promise<DeleteCommandOutput>;
}

export class Database implements IDatabase {
  dynamoDocClient: DynamoDBDocument;
  table: string;

  constructor(tableName: string, config: DynamoDBClientConfig = {}) {
    const options = {
      region: process.env.REGION,
      ...config, // this is necessary if we want to pass Credentials to access cross account resources
    };

    this.table = tableName;
    const dynamoClient = new DynamoDBClient(options);
    const marshallOptions = { removeUndefinedValues: true };
    const unmarshallOptions = { wrapNumbers: false };
    const translateConfig = { marshallOptions, unmarshallOptions };

    this.dynamoDocClient = DynamoDBDocument.from(dynamoClient, translateConfig);
  }

  // Usual CRUD operations
  async save(item: databaseItem, table?: string) {
    const TableName = table || this.table;
    if (!TableName) {
      throw new Error(
        `ConfigError | Missing db tablename - can't save item ${JSON.stringify(
          item
        )})`
      );
    }
    const params = {
      TableName,
      Item: {
        ...item,
      },
    };

    try {
      // console.debug('DynamoDB save params', params)
      // always overwrite item so that we keep track only of the latest one
      const response = await this.dynamoDocClient.put(params);
      // console.debug('DynamoDB save response', response)
      return response;
    } catch (error) {
      console.error("Error while saving in dynamo", params, error);
      throw error; // todo custom error - with retry info and metrices
    }
  }

  async read(pk: object, sk = {}, table?: string) {
    const TableName = table || this.table;
    if (!TableName) {
      throw new Error(
        `ConfigError | Missing db tablename - can't read item ${JSON.stringify({
          pk,
          sk,
        })}`
      );
    }
    const params = {
      TableName,
      Key: {
        ...pk,
        ...sk,
      },
    };
    try {
      // console.debug('DynamoDB read params', params)
      const response = await this.dynamoDocClient.get(params);
      // console.debug('DynamoDB read response', response)
      return response;
    } catch (error) {
      console.error("Error while getting in dynamo", params, error);
      throw error; // todo custom error - with retry info and metrices
    }
  }

  async update(pk: object, updateItem: object, sk = {}, table?: string) {
    const TableName = table || this.table;
    if (!TableName) {
      throw new Error(
        `ConfigError | Missing db tablename - can't update item ${JSON.stringify(
          { pk, sk }
        )}`
      );
    }

    const itemKeys = Object.keys(updateItem);

    const params: UpdateCommandInput = {
      Key: {
        ...pk,
        ...sk,
      },
      TableName,
      ReturnValues: "ALL_NEW",
      UpdateExpression: `SET ${itemKeys
        .map((k, index) => `#field${index} = :value${index}`)
        .join(", ")}`,
      ExpressionAttributeNames: Object.fromEntries(
        itemKeys.map((k, index) => [`#field${index}`, k])
      ),
      ExpressionAttributeValues: Object.fromEntries(
        // @ts-ignore
        itemKeys.map((k, index) => [`:value${index}`, updateItem[k]])
      ),
    };

    try {
      // console.debug('DynamoDB update params', params)
      const response = await this.dynamoDocClient.update(params);
      // console.debug('DynamoDB update response', response)
      return response;
    } catch (error) {
      console.error("Error while updating dynamodb data", params, error);
      throw error; // todo custom error - with retry info and metrices
    }
  }

  async delete(pk: object, sk = {}, table?: string) {
    const TableName = table || this.table;
    if (!TableName) {
      throw new Error(
        `ConfigError | Missing db tablename - can't delete item ${JSON.stringify(
          { pk, sk }
        )}`
      );
    }
    const params = {
      TableName,
      Key: {
        ...pk,
        ...sk,
      },
    };
    try {
      // console.debug('DynamoDB delete params', params)
      const response = await this.dynamoDocClient.delete(params);
      // console.debug('DynamoDB delete response', response)
      return response;
    } catch (error) {
      console.error("Error while deleting in dynamo", params, error);
      throw error; // todo custom error - with retry info and metrices
    }
  }
}
