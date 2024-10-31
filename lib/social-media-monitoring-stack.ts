import { Construct } from "constructs";
import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  Vpc,
  InstanceClass,
  InstanceSize,
  InstanceType,
  SecurityGroup,
  AmazonLinuxGeneration,
  AmazonLinuxImage,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerCondition,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
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
import { join } from "path";
import {
  Cluster,
  Ec2Service,
  Ec2TaskDefinition,
  ContainerImage,
  NetworkMode,
  ListenerConfig,
} from "aws-cdk-lib/aws-ecs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import { AsgCapacityProvider } from "aws-cdk-lib/aws-ecs";

interface SocialMediaMonitoringStackProps extends StackProps {
  stage: string;
}

export class SocialMediaMonitoringStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SocialMediaMonitoringStackProps
  ) {
    super(scope, id, props);

    const stage = props.stage || "dev";
    // Use default account VPC
    const vpc = Vpc.fromLookup(this, `${id}-DefaultVpc`, { isDefault: true });

    // Custom Metric for Tweet Count
    const tweetCountMetric = new Metric({
      namespace: `SocialMediaApp-${stage}`,
      metricName: `TweetsReceived`,
      period: Duration.minutes(5),
      statistic: Stats.SAMPLE_COUNT,
      dimensionsMap: {
        ServiceName: "TweetConsumer",
      },
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

    // Application Load Balancer
    const alb = new ApplicationLoadBalancer(this, `${id}-alb`, {
      vpc,
      internetFacing: true,
    });

    const albListener = alb.addListener(`${id}-listener`, {
      port: 80,
      open: true,
    });

    // ECS Cluster
    const cluster = new Cluster(this, `${id}-cluster`, {
      vpc,
    });

    // Auto Scaling Group for ECS Cluster Capacity
    const asg = new AutoScalingGroup(this, `${id}-asg`, {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      desiredCapacity: 2,
      minCapacity: 2,
      maxCapacity: 4,
    });

    const capacityProvider = new AsgCapacityProvider(
      this,
      `${id}-asg-capacity-provider`,
      {
        autoScalingGroup: asg,
      }
    );

    cluster.addAsgCapacityProvider(capacityProvider);

    // Build Docker images using DockerImageAsset
    const consumerImageAsset = new DockerImageAsset(
      this,
      `${id}-consumer-image`,
      {
        directory: join(__dirname, "../src/recent-tweets-monitor"),
        target: stage === "live" ? "production" : "development",
      }
    );

    const publisherImageAsset = new DockerImageAsset(
      this,
      `${id}-publisher-image`,
      {
        directory: join(__dirname, "../src/x-api-mock-server"),
        target: stage === "live" ? "production" : "development",
      }
    );

    // ECS Task Definitions
    const consumerTaskDefinition = new Ec2TaskDefinition(
      this,
      `${id}-consumer-task-def`,
      {
        networkMode: NetworkMode.AWS_VPC,
      }
    );

    consumerTaskDefinition
      .addContainer(`${id}-consumer-container`, {
        image: ContainerImage.fromDockerImageAsset(consumerImageAsset),
        memoryLimitMiB: 512,
        environment: {
          STAGE: stage,
          TABLE_NAME: socialMediaDataTable.tableName,
          METRIC_NAMESPACE: tweetCountMetric.namespace,
        },
      })
      .addPortMappings({
        containerPort: 80,
      });

    const publisherTaskDefinition = new Ec2TaskDefinition(
      this,
      `${id}-publisher-task-def`,
      {
        networkMode: NetworkMode.AWS_VPC,
      }
    );

    publisherTaskDefinition
      .addContainer(`${id}-publisher-container`, {
        image: ContainerImage.fromDockerImageAsset(publisherImageAsset),
        memoryLimitMiB: 512,
      })
      .addPortMappings({
        containerPort: 80,
      });

    // ECS Services
    const consumerService = new Ec2Service(this, `${id}-consumer-service`, {
      cluster,
      taskDefinition: consumerTaskDefinition,
      desiredCount: 1,
    });

    const publisherService = new Ec2Service(this, `${id}-publisher-service`, {
      cluster,
      taskDefinition: publisherTaskDefinition,
      desiredCount: 1,
    });

    // Register ECS services with ALB
    consumerService.registerLoadBalancerTargets({
      containerName: `${id}-consumer-container`,
      containerPort: 80,
      newTargetGroupId: "consumerTG",
      listener: ListenerConfig.applicationListener(albListener, {
        protocol: ApplicationProtocol.HTTP,
        conditions: [
          ListenerCondition.httpRequestMethods(["GET"]),
          ListenerCondition.pathPatterns(["/tweets/consume/*"]),
        ],
        priority: 10,
      }),
    });

    publisherService.registerLoadBalancerTargets({
      containerName: `${id}-publisher-container`,
      containerPort: 80,
      newTargetGroupId: "publisherTG",
      listener: ListenerConfig.applicationListener(albListener, {
        protocol: ApplicationProtocol.HTTP,
        conditions: [
          ListenerCondition.httpRequestMethods(["GET"]),
          ListenerCondition.pathPatterns(["/tweets/search/stream/*"]),
        ],
        priority: 20,
      }),
    });

    // Lambda Function for Archiving
    const archiveLambda = new NodejsFunction(this, `${id}-archive-lambda`, {
      runtime: Runtime.NODEJS_20_X,
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
    new Rule(this, `${id}-archive-lambda-schedule`, {
      schedule: Schedule.rate(Duration.minutes(30)),
      targets: [new LambdaFunction(archiveLambda)],
    });

    // SNS Topic for Alarm Notifications
    const snsAlarmTopic = new Topic(this, `${id}-alarm-topic`);

    const anomalyDetector = new CfnAnomalyDetector(
      this,
      `${id}-anomaly-detector`,
      {
        metricName: tweetCountMetric.metricName,
        namespace: tweetCountMetric.namespace,
        stat: Stats.SUM,
      }
    );

    const deviation = stage === "live" ? 2 : 3;

    new CfnAlarm(this, `${id}-anomaly-alarm`, {
      alarmDescription: `Anomaly detection alarm for metric ${tweetCountMetric.namespace} - ${tweetCountMetric.metricName} on ${stage}`,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator:
        ComparisonOperator.LESS_THAN_LOWER_OR_GREATER_THAN_UPPER_THRESHOLD,
      treatMissingData: TreatMissingData.IGNORE,
      actionsEnabled: true,
      alarmActions: [snsAlarmTopic.topicArn],
      thresholdMetricId: "ad1",
      metrics: [
        {
          id: "ad1",
          expression: `ANOMALY_DETECTION_BAND(m1, ${deviation})`,
        },
        {
          id: "m1",
          metricStat: {
            metric: {
              metricName: anomalyDetector.metricName!,
              namespace: anomalyDetector.namespace!,
              dimensions: anomalyDetector.dimensions,
            },
            period: tweetCountMetric.period.toSeconds(),
            stat: anomalyDetector.stat!,
          },
        },
      ],
    });

    // Email Subscription for Alarms
    const emails = ["your-email@example.com"];
    emails.forEach((email) => {
      snsAlarmTopic.addSubscription(new EmailSubscription(email));
    });
  }
}
