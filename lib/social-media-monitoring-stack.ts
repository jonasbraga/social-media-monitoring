import { Construct } from "constructs";
import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  SecurityGroup,
  UserData,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ListenerCondition,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Alarm,
  CfnAlarm,
  CfnAnomalyDetector,
  ComparisonOperator,
  Metric,
  Stats,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { join } from "node:path";
import { InstanceIdTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";

type SocialMediaMonitoringStackProps = StackProps & {
  stage: string;
};
export class SocialMediaMonitoringStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: SocialMediaMonitoringStackProps
  ) {
    super(scope, id, props);

    const stage = props?.stage || "dev";
    // Use default account VPC
    const vpc = Vpc.fromLookup(this, `${id}-DefaultVpc`, { isDefault: true });

    // Application Load Balancer
    const alb = new ApplicationLoadBalancer(this, `${id}-alb`, {
      vpc,
      internetFacing: true,
    });

    // Security Group for EC2 instance
    const ec2SecurityGroup = new SecurityGroup(
      this,
      `${id}-ec2-security-group`,
      {
        vpc,
      }
    );

    // EC2 Instance for consuming tweets
    const consumerEc2 = new Instance(this, `${id}-ec2-consumer-instance`, {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      securityGroup: ec2SecurityGroup,
    });

    // EC2 Instance for publishing tweets
    const publisherEc2 = new Instance(this, `${id}-ec2-publisher-instance`, {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      securityGroup: ec2SecurityGroup,
    });

    // Target Group for ALB and EC2 Instance
    const tweetConsumerTargetGroup = new ApplicationTargetGroup(
      this,
      `${id}-tweet-consumer-tg`,
      {
        port: 80,
        vpc,
        targetGroupName: `tweet-consumer-tg-${stage}`,
        targets: [new InstanceIdTarget(consumerEc2.instanceId)],
      }
    );
    // Target Group for ALB and EC2 Instance
    const tweetPublisherTargetGroup = new ApplicationTargetGroup(
      this,
      `${id}-tweet-publisher-tg`,
      {
        port: 80,
        vpc,
        targetGroupName: `tweet-publisher-tg-${stage}`,
        targets: [new InstanceIdTarget(publisherEc2.instanceId)],
      }
    );

    // Attach ALB to TG
    const albListener = alb.addListener(`${id}-listener`, {
      port: 80,
      defaultTargetGroups: [tweetConsumerTargetGroup],
    });

    albListener.addTargetGroups(`${id}-rule-tweets-publish`, {
      priority: 1,
      conditions: [
        // ListenerCondition.hostHeaders([host]),
        ListenerCondition.httpRequestMethods(["GET"]),
        ListenerCondition.pathPatterns(["/tweets/search/stream/*"]),
      ],
      targetGroups: [tweetPublisherTargetGroup],
    });

    albListener.addTargetGroups(`${id}-rule-tweets-consume`, {
      priority: 1,
      conditions: [
        // ListenerCondition.hostHeaders([host]),
        ListenerCondition.httpRequestMethods(["GET"]),
        ListenerCondition.pathPatterns(["/tweets/consume/*"]),
      ],
      targetGroups: [tweetConsumerTargetGroup],
    });

    // DynamoDB Table
    const socialMediaDataTable = new Table(
      this,
      `${id}-social-media-data-table`,
      {
        tableName: `social-media-data-table-${stage}`,
        partitionKey: {
          name: "PROVIDER#REQUEST_ID",
          type: AttributeType.STRING,
        },
        sortKey: { name: "CRITERIA#ID", type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
      }
    );

    // S3 Bucket
    const archiveBucket = new Bucket(this, `${id}-archive-bucket`, {
      bucketName: `social-media-archive-bucket-${stage}`,
      removalPolicy:
        stage === "live" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Lambda Function for Archiving
    const archiveLambda = new NodejsFunction(this, `${id}-archive-lambda`, {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      logRetention:
        stage === "live" ? RetentionDays.FIVE_DAYS : RetentionDays.THREE_DAYS,
      bundling: {
        minify: true,
        externalModules: [
          "@aws-sdk/*", // Exclude AWS SDK from the bundle, it's already available in the Lambda runtime
        ],
      },
      functionName: `archive-tweets-lambda-${stage}`,
      environment: {
        STAGE: stage,
        REGION: this.region,
        BUCKET_NAME: archiveBucket.bucketName,
        TABLE_NAME: socialMediaDataTable.tableName,
      },
      handler: "handler",
      entry: join(__dirname, "../src/archive-lambda/index.ts"),
    });

    // Permissions for Lambda
    archiveBucket.grantWrite(archiveLambda);
    socialMediaDataTable.grantReadWriteData(archiveLambda);

    // Schedule Lambda to trigger every 30 minutes
    const archiveLambdaSchedule = new Rule(
      this,
      `${id}-archive-lambda-schedule`,
      {
        schedule: Schedule.rate(Duration.minutes(30)),
      }
    );
    archiveLambdaSchedule.addTarget(new LambdaFunction(archiveLambda));

    // SNS Topic for Alarm Notifications
    const snsAlarmTopic = new Topic(this, `${id}-alarm-topic`);

    // Custom Metric for Tweet Count
    const tweetCountMetric = new Metric({
      namespace: "social-media-app",
      metricName: `tweet-count-${stage}`,
      period: Duration.minutes(5),
      statistic: Stats.SAMPLE_COUNT,
    });

    const anomalyDetector = new CfnAnomalyDetector(
      this,
      `${id}-anomaly-detector`,
      {
        metricName: tweetCountMetric.metricName,
        namespace: tweetCountMetric.namespace,
        stat: Stats.SUM,
      }
    );

    console.log("DIMENSIONS:", tweetCountMetric.dimensions);
    const deviation = stage === "live" ? 2 : 3;

    const anomalyAlarm = new CfnAlarm(this, `${id}-anomaly-alarm`, {
      alarmDescription: `Anomaly detection alarm for metric ${tweetCountMetric.namespace} - ${tweetCountMetric.metricName} on ${stage}`,
      evaluationPeriods: 1,
      datapointsToAlarm: 1, // alarms is triggered when we detect 1 anomalies in the last period of 5 mins
      comparisonOperator:
        ComparisonOperator.LESS_THAN_LOWER_OR_GREATER_THAN_UPPER_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
      actionsEnabled: true,
      alarmActions: [snsAlarmTopic.topicArn],
      thresholdMetricId: "ad1",
      metrics: [
        {
          id: "ad1",
          expression: `ANOMALY_DETECTION_BAND(m1, ${deviation})`, // params are id of metric below and standard deviation (Higher number means thicker band, lower number means thinner band)
        },
        {
          id: "m1",
          metricStat: {
            metric: {
              metricName: anomalyDetector.metricName,
              namespace: anomalyDetector.namespace,
              dimensions: anomalyDetector.dimensions,
            },
            period: tweetCountMetric.period.toSeconds(),
            stat: anomalyDetector.stat!,
          },
        },
      ],
    });

    // SES Notification Subscription
    const emails = ["jonasbraga2001+aws_alarms@gmail.com"];
    emails.forEach((email) => {
      snsAlarmTopic.addSubscription(new EmailSubscription(email));
    });
  }
}
