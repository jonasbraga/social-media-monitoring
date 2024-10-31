import {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";

const dynamoDBClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamoDBClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const PK = process.env.PK!;
const SK = process.env.SK!;
const PARTITION_KEY_VALUE = process.env.PARTITION_KEY_VALUE!;
const S3_BUCKET = process.env.S3_BUCKET!;

export const handler: Handler = async (event) => {
  try {
    // Step 1: Get the count of items for the specified PK
    const countParams = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": PK,
      },
      ExpressionAttributeValues: {
        ":pk": PARTITION_KEY_VALUE,
      },
      Select: "COUNT",
    };

    const countResult = await ddbDocClient.send(new QueryCommand(countParams));
    const itemCount = countResult.Count || 0;

    console.log(`Total items for PK=${PARTITION_KEY_VALUE}: ${itemCount}`);

    // Step 2: Check if itemCount > 100,000
    if (itemCount > 100000) {
      const numberToArchive = itemCount - 100000;
      console.log(`Number of items to archive: ${numberToArchive}`);

      // Step 3: Query and process items to archive and delete
      let lastEvaluatedKey: any = undefined;
      let totalItemsRetrieved = 0;
      const MAX_BATCH_SIZE = 25; // For BatchWriteItem
      const MAX_ITEMS_PER_BATCH = 1000; // Adjust as needed
      const itemsToArchive: any[] = [];

      do {
        const limit = Math.min(1000, numberToArchive - totalItemsRetrieved);
        const queryParams = {
          TableName: TABLE_NAME,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: {
            "#pk": PK,
          },
          ExpressionAttributeValues: {
            ":pk": PARTITION_KEY_VALUE,
          },
          ScanIndexForward: true, // Get oldest items first
          Limit: limit,
          ExclusiveStartKey: lastEvaluatedKey,
        };

        const queryResult = await ddbDocClient.send(
          new QueryCommand(queryParams)
        );
        const items = queryResult.Items || [];
        totalItemsRetrieved += items.length;

        console.log(
          `Retrieved ${items.length} items, total retrieved: ${totalItemsRetrieved}`
        );

        // Add items to the list for archiving and deleting
        itemsToArchive.push(...items);

        lastEvaluatedKey = queryResult.LastEvaluatedKey;

        // Process items if batch size reached or all items retrieved
        if (
          itemsToArchive.length >= MAX_ITEMS_PER_BATCH ||
          totalItemsRetrieved >= numberToArchive
        ) {
          console.log(`Processing batch of ${itemsToArchive.length} items`);

          // Archive items to S3
          await archiveItemsToS3(itemsToArchive);

          // Delete items from DynamoDB
          await deleteItemsFromDynamoDB(itemsToArchive);

          // Clear the items array
          itemsToArchive.length = 0;
        }
      } while (lastEvaluatedKey && totalItemsRetrieved < numberToArchive);

      // Process any remaining items
      if (itemsToArchive.length > 0) {
        console.log(`Processing final batch of ${itemsToArchive.length} items`);

        await archiveItemsToS3(itemsToArchive);
        await deleteItemsFromDynamoDB(itemsToArchive);
      }

      console.log(`Archiving and deletion completed`);
    } else {
      console.log(
        `Item count (${itemCount}) is less than or equal to 100,000. No action needed.`
      );
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

async function archiveItemsToS3(items: any[]) {
  // Convert items to JSON string
  const data = JSON.stringify(items);

  // Generate a unique S3 object key
  const timestamp = new Date().toISOString();
  const s3Key = `archive/${PARTITION_KEY_VALUE}/${timestamp}.json`;

  const putParams = {
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: data,
    ContentType: "application/json",
  };

  try {
    await s3Client.send(new PutObjectCommand(putParams));
    console.log(`Archived ${items.length} items to S3: ${s3Key}`);
  } catch (error) {
    console.error(`Failed to archive items to S3: ${error}`);
    throw error;
  }
}

async function deleteItemsFromDynamoDB(items: any[]) {
  const MAX_BATCH_SIZE = 25;
  let batches: any[] = [];
  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    batches.push(items.slice(i, i + MAX_BATCH_SIZE));
  }

  for (const batch of batches) {
    const deleteRequests = batch.map((item) => ({
      DeleteRequest: {
        Key: {
          [PK]: item[PK],
          [SK]: item[SK],
        },
      },
    }));

    const params = {
      RequestItems: {
        [TABLE_NAME]: deleteRequests,
      },
    };

    try {
      await ddbDocClient.send(new BatchWriteItemCommand(params));
      console.log(`Deleted ${deleteRequests.length} items from DynamoDB`);
    } catch (error) {
      console.error(`Failed to delete items from DynamoDB: ${error}`);
      throw error;
    }
  }
}
