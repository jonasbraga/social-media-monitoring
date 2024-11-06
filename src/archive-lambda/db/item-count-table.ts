import { ScanCommandInput, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { Database } from "./index";

class ItemCountTable extends Database {
  async searchExceedHashtags(threshold: number) {
    const scanParams: ScanCommandInput = {
      TableName: this.table,
      FilterExpression: "#ItemCount > :threshold",
      ExpressionAttributeNames: {
        "#ItemCount": "ItemCount",
      },
      ExpressionAttributeValues: {
        ":threshold": threshold,
      },
    };

    return this.dynamoDocClient.scan(scanParams);
  }

  async subtractDeletedItems(pk: string, itemsAmount: number) {
    // Step 5: Update ItemCountTable with the new item count
    const updateParams: UpdateCommandInput = {
      TableName: this.table,
      Key: {
        "PROVIDER#CRITERIA": pk,
      },
      UpdateExpression: "SET #ItemCount = #ItemCount - :decrement",
      ExpressionAttributeNames: {
        "#ItemCount": "ItemCount",
      },
      ExpressionAttributeValues: {
        ":decrement": itemsAmount,
      },
    };

    await this.dynamoDocClient.update(updateParams);
  }
}

export default new ItemCountTable(process.env.ITEMS_COUNT_TABLE_NAME!);
