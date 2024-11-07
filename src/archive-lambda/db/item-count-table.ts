import { ScanCommandInput, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { Database } from "./index";

class itemCountTable extends Database {
  async searchExceedHashtags(threshold: number) {
    const scanParams: ScanCommandInput = {
      TableName: this.table,
      FilterExpression: "#itemCount > :threshold",
      ExpressionAttributeNames: {
        "#itemCount": "itemCount",
      },
      ExpressionAttributeValues: {
        ":threshold": threshold,
      },
    };

    return this.dynamoDocClient.scan(scanParams);
  }

  async subtractDeletedItems(pk: string, itemsAmount: number) {
    // Step 5: Update itemCountTable with the new item count
    const updateParams: UpdateCommandInput = {
      TableName: this.table,
      Key: {
        "PROVIDER#CRITERIA": pk,
      },
      UpdateExpression: "SET #itemCount = #itemCount - :decrement",
      ExpressionAttributeNames: {
        "#itemCount": "itemCount",
      },
      ExpressionAttributeValues: {
        ":decrement": itemsAmount,
      },
    };

    await this.dynamoDocClient.update(updateParams);
  }
}

export default new itemCountTable(process.env.ITEMS_COUNT_TABLE_NAME!);
