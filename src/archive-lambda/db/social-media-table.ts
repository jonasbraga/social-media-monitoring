import {
  BatchWriteCommandInput,
  QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { Database } from "./index";

export type TweetItem = {
  "PROVIDER#CRITERIA": string; // partition key
  ID: string; // ULID sort key
  tweetId: string;
  text: string;
  authorId: string;
  createdAt: string;
  extraData: Record<string, any>;
  timestamp: number;
};

class SocialMediaTable extends Database {
  async queryExeceededItems(pk: string, numToArchive: number) {
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;
    let items: TweetItem[] = [];

    do {
      const queryParams: QueryCommandInput = {
        TableName: this.table,
        KeyConditionExpression: "#PK = :pk",
        ExpressionAttributeNames: {
          "#PK": "PROVIDER#CRITERIA",
        },
        ExpressionAttributeValues: {
          ":pk": pk,
        },
        Limit: numToArchive,
        ScanIndexForward: true, // Ascending order by ULID
        ExclusiveStartKey: lastEvaluatedKey,
      };

      const queryResult = await this.dynamoDocClient.query(queryParams);
      items = items.concat((queryResult.Items as unknown as TweetItem) || []);
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // removing the last item if it exceeds the limit
    if (items.length > numToArchive) {
      items = items.slice(0, numToArchive);
    }

    return items;
  }

  async deleteArchivedItems(items: TweetItem[]) {
    const batchSize = 25;

    for (let i = 0; i < items.length; i += batchSize) {
      const batchItems = items.slice(i, i + batchSize);

      const deleteRequests = batchItems.map((archivedItem) => ({
        DeleteRequest: {
          Key: {
            "PROVIDER#CRITERIA": archivedItem["PROVIDER#CRITERIA"],
            ID: archivedItem.ID,
          },
        },
      }));

      const batchParams: BatchWriteCommandInput = {
        RequestItems: {
          [this.table]: deleteRequests,
        },
      };

      await this.dynamoDocClient.batchWrite(batchParams);
    }
  }
}

export default new SocialMediaTable(process.env.SOCIAL_MEDIA_TABLE_NAME!);
