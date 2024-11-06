import { Injectable, Logger } from '@nestjs/common';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';

@Injectable()
export class MetricsService {
  private cloudWatchClient: CloudWatchClient;
  private readonly logger = new Logger(MetricsService.name);
  constructor() {
    this.cloudWatchClient = new CloudWatchClient({});
  }

  async publishTweetReceivedMetric(count: number): Promise<void> {
    const params: PutMetricDataCommandInput = {
      Namespace: process.env.METRIC_NAMESPACE!,
      MetricData: [
        {
          MetricName: 'TweetsReceived',
          Timestamp: new Date(),
          Value: count,
          Unit: 'Count',
          Dimensions: [
            {
              Name: 'ServiceName',
              Value: 'TweetConsumer',
            },
          ],
        },
      ],
    };

    try {
      await this.cloudWatchClient.send(new PutMetricDataCommand(params));
      this.logger.log('pushing metric');
    } catch (error) {
      // Handle error appropriately
      this.logger.error('Error publishing metric:', error);
    }
  }
}
