import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Handler } from "aws-lambda";
import { stringify } from "csv-stringify/sync";
import itemCountTable from "./db/item-count-table";
import socialMediaTable from "./db/social-media-table";

const s3Client = new S3Client({ region: process.env.REGION });

const THRESHOLD = 100; // Predefined threshold

export const handler: Handler = async (event, context) => {
  try {
    console.log("Lambda invoked with event:", JSON.stringify(event));

    // Query ItemCountTable for items that exceed the threshold
    const scanResult = await itemCountTable.searchExceedHashtags(THRESHOLD);

    const itemsToProcess = scanResult.Items || [];
    console.log(`Scanned ${itemsToProcess.length} items`);

    for (const item of itemsToProcess) {
      const pk = item["PROVIDER#CRITERIA"]!;
      const itemCount = item.itemCount!;
      console.log(`Processing PK: ${pk}, ItemCount: ${itemCount}`);

      const numToArchive = itemCount - THRESHOLD;

      if (numToArchive <= 0) {
        console.log(`No items to archive for PK: ${pk}`);
        continue;
      }

      // For each item that exceeds the threshold, query the SocialMediaTable for the items to archive
      const items = await socialMediaTable.queryExeceededItems(
        pk,
        numToArchive
      );
      console.log(`Queried ${items.length} items to archive for PK: ${pk}`);

      // Archive items to S3 in CSV format
      // TODO: use streams, querying items and writting to S3 on demand
      const csvData = stringify(items, { header: true });
      const timestamp = new Date().getTime();
      const fileName = `archive/${pk}/${timestamp}.csv`;

      const putObjectCommand = new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: fileName,
        Body: csvData,
        ContentType: "text/csv",
      });

      await s3Client.send(putObjectCommand);
      console.log(`Archived data to S3 at ${fileName}`);

      // Delete archived items from SocialMediaTable
      socialMediaTable.deleteArchivedItems(items);
      console.log(
        `Deleted ${items.length} items from SocialMediaTable for PK: ${pk}`
      );
      // Update ItemCountTable with the new item count
      itemCountTable.subtractDeletedItems(pk, numToArchive);
      console.log(`Updated ItemCount for PK: ${pk} to ${THRESHOLD}`);
    }

    console.log("Lambda execution completed");
    return { statusCode: 200, body: JSON.stringify({ message: "Success" }) };
  } catch (error) {
    console.error("Lambda execution failed:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Failed" }) };
  }
};
