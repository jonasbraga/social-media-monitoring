import { Construct } from "constructs";
import { Stack, StackProps, Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import { Vpc, SecurityGroup, Port } from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
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
  FargateService,
  FargateTaskDefinition,
  ContainerImage,
  ListenerConfig,
  LogDrivers,
  AwsLogDriverMode,
  DeploymentControllerType,
} from "aws-cdk-lib/aws-ecs";
import {
  DockerImageAsset,
  NetworkMode,
  Platform,
} from "aws-cdk-lib/aws-ecr-assets";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";

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
    const applicationPort = 3000;

    // Use default account VPC
    const vpc = Vpc.fromLookup(this, `${id}-default-vpc`, { isDefault: true });

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

    // DynamoDB Tables
    const socialMediaDataTable = new Table(
      this,
      `${id}-social-media-data-table`,
      {
        tableName: `social-media-data-table-${stage}`,
        partitionKey: {
          name: "PROVIDER#CRITERIA",
          type: AttributeType.STRING,
        },
        removalPolicy:
          stage === "live" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        sortKey: { name: "ID", type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
      }
    );

    const itemCountTable = new Table(this, `${id}-item-count-table`, {
      tableName: `item-count-table-${stage}`,
      partitionKey: {
        name: "PROVIDER#CRITERIA",
        type: AttributeType.STRING,
      },
      removalPolicy:
        stage === "live" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // S3 Bucket
    const archiveBucket = new Bucket(this, `${id}-archive-bucket`, {
      bucketName: `social-media-archive-bucket-${stage}`,
      removalPolicy:
        stage === "live" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Application Load Balancer
    const alb = new ApplicationLoadBalancer(this, `${id}-alb`, {
      loadBalancerName: "alb",
      vpc,
      internetFacing: true,
    });

    // ALB Listener on port 80 (HTTP) for public access without port in URL
    const albListener = alb.addListener(`${id}-listener`, {
      port: 80,
      open: true,
    });

    // Default action for unmatched requests
    albListener.addAction(`${id}-default-action`, {
      action: ListenerAction.fixedResponse(200, {
        contentType: "text/plain",
        messageBody: "Default action",
      }),
    });

    // ECS Services with updated security groups

    const consumerSecurityGroup = new SecurityGroup(this, `${id}-consumer-sg`, {
      vpc,
      description: "Security group for consumer service",
      allowAllOutbound: true,
    });

    const publisherSecurityGroup = new SecurityGroup(
      this,
      `${id}-publisher-sg`,
      {
        vpc,
        description: "Security group for publisher service",
        allowAllOutbound: true,
      }
    );

    // Allow ALB to communicate with tasks on the application port
    const albSecurityGroup = alb.connections.securityGroups[0];

    publisherSecurityGroup.connections.allowFrom(
      albSecurityGroup,
      Port.tcp(applicationPort), // Allow traffic on the application port only
      "Allow ALB to reach publisher tasks on port " + applicationPort
    );
    consumerSecurityGroup.connections.allowFrom(
      albSecurityGroup,
      Port.tcp(applicationPort), // Allow traffic on the application port only
      "Allow ALB to reach consumer tasks on port " + applicationPort
    );

    // Allow consumer to connect to publisher on the application port
    publisherSecurityGroup.connections.allowFrom(
      consumerSecurityGroup,
      Port.tcp(applicationPort),
      "Allow consumer to connect to publisher on port" + applicationPort
    );

    // ECS Cluster
    const cluster = new Cluster(this, `${id}-cluster`, {
      clusterName: `${id}-cluster`,
      vpc,
    });

    // Service Discovery Namespace
    const namespace = cluster.addDefaultCloudMapNamespace({
      name: "service.local",
    });

    // Build Docker images using DockerImageAsset
    const consumerImageAsset = new DockerImageAsset(
      this,
      `${id}-consumer-image`,
      {
        assetName: `${id}-consumer-image`,
        directory: join(__dirname, "../src/recent-tweets-monitor"),
        target: stage === "live" ? "production" : "development",
        networkMode: NetworkMode.HOST,
        platform: Platform.LINUX_AMD64,
      }
    );

    const publisherImageAsset = new DockerImageAsset(
      this,
      `${id}-publisher-image`,
      {
        directory: join(__dirname, "../src/x-api-mock-server"),
        target: stage === "live" ? "production" : "development",
        networkMode: NetworkMode.HOST,
        platform: Platform.LINUX_AMD64,
      }
    );

    // ECS Task Definitions
    const consumerTaskDefinition = new FargateTaskDefinition(
      this,
      `${id}-consumer-task-def`,
      {
        cpu: 256,
        memoryLimitMiB: 512,
      }
    );

    const publisherCloudMapName = "publisher";
    const publisherInternalEndpoint = `http://${publisherCloudMapName}.${namespace.namespaceName}:${applicationPort}`;

    consumerTaskDefinition.addContainer(`${id}-consumer-container`, {
      image: ContainerImage.fromDockerImageAsset(consumerImageAsset),
      portMappings: [{ containerPort: applicationPort }], // Map container's application port to host
      logging: LogDrivers.awsLogs({
        streamPrefix: "consumer-logs",
        mode: AwsLogDriverMode.NON_BLOCKING,
        maxBufferSize: Size.mebibytes(25),
        logRetention:
          stage === "live" ? RetentionDays.FIVE_DAYS : RetentionDays.ONE_DAY,
      }),

      environment: {
        PORT: `${applicationPort}`,
        STAGE: stage,
        SOCIAL_MEDIA_TABLE_NAME: socialMediaDataTable.tableName,
        ITEMS_COUNT_TABLE_NAME: itemCountTable.tableName,
        METRIC_NAMESPACE: tweetCountMetric.namespace,
        // For now only internal endpoint is supported
        PUBLISHER_ENDPOINT:
          stage === "live"
            ? publisherInternalEndpoint
            : publisherInternalEndpoint,
      },
    });

    const publisherTaskDefinition = new FargateTaskDefinition(
      this,
      `${id}-publisher-task-def`,
      {
        cpu: 256,
        memoryLimitMiB: 512,
      }
    );

    publisherTaskDefinition.addContainer(`${id}-publisher-container`, {
      image: ContainerImage.fromDockerImageAsset(publisherImageAsset),
      portMappings: [{ containerPort: applicationPort }], // Map container's application port to host
      logging: LogDrivers.awsLogs({
        streamPrefix: "publisher-logs",
        mode: AwsLogDriverMode.NON_BLOCKING,
        maxBufferSize: Size.mebibytes(25),
        logRetention:
          stage === "live" ? RetentionDays.FIVE_DAYS : RetentionDays.ONE_DAY,
      }),
      environment: {
        PORT: `${applicationPort}`, // Application listens on the application port
        STAGE: stage,
      },
    });

    // ECS Services
    const consumerService = new FargateService(this, `${id}-consumer-service`, {
      serviceName: `${id}-consumer-service`,
      healthCheckGracePeriod: Duration.seconds(120),
      cluster,
      taskDefinition: consumerTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [consumerSecurityGroup],
      deploymentController: {
        type: DeploymentControllerType.ECS,
      },
      circuitBreaker: {
        rollback: true,
      },
    });

    const publisherService = new FargateService(
      this,
      `${id}-publisher-service`,
      {
        serviceName: `${id}-publisher-service`,
        cluster,
        healthCheckGracePeriod: Duration.seconds(120),
        taskDefinition: publisherTaskDefinition,
        desiredCount: 1,
        assignPublicIp: true,
        securityGroups: [publisherSecurityGroup],
        cloudMapOptions: {
          name: publisherCloudMapName,
          cloudMapNamespace: namespace,
        },
        deploymentController: {
          type: DeploymentControllerType.ECS,
        },
        circuitBreaker: {
          rollback: true,
        },
      }
    );

    // Register ECS services with ALB
    consumerService.registerLoadBalancerTargets({
      containerName: `${id}-consumer-container`,
      containerPort: applicationPort, // Target container port
      newTargetGroupId: `${id}-consumer-tg`,
      listener: ListenerConfig.applicationListener(albListener, {
        healthCheck: {
          enabled: true,
          path: "/consumer/health",
        },
        protocol: ApplicationProtocol.HTTP,
        conditions: [
          ListenerCondition.httpRequestMethods(["GET"]),
          ListenerCondition.pathPatterns([
            "/tweets/consume/*",
            "/consumer/health",
          ]),
        ],
        priority: 10,
      }),
    });

    publisherService.registerLoadBalancerTargets({
      containerName: `${id}-publisher-container`,
      containerPort: applicationPort, // Target container port
      newTargetGroupId: `${id}-publisher-tg`,
      listener: ListenerConfig.applicationListener(albListener, {
        healthCheck: {
          enabled: true,
          path: "/publisher/health",
        },
        protocol: ApplicationProtocol.HTTP,
        conditions: [
          ListenerCondition.httpRequestMethods(["GET"]),
          ListenerCondition.pathPatterns([
            "/tweets/search/stream/*",
            "/publisher/health",
          ]),
        ],
        priority: 20,
      }),
    });

    // Permissions for ECS consumer task
    socialMediaDataTable.grantWriteData(consumerTaskDefinition.taskRole);
    itemCountTable.grantWriteData(consumerTaskDefinition.taskRole);
    consumerTaskDefinition.taskRole.attachInlinePolicy(
      new Policy(this, `${id}-consumer-task-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["cloudwatch:PutMetricData"],
          }),
        ],
      })
    );

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
        esbuildArgs: { "--packages": "bundle" },
      },
      functionName: `archive-tweets-lambda-${stage}`,
      environment: {
        STAGE: stage,
        BUCKET_NAME: archiveBucket.bucketName,
        SOCIAL_MEDIA_TABLE_NAME: socialMediaDataTable.tableName,
        ITEMS_COUNT_TABLE_NAME: itemCountTable.tableName,
      },
      handler: "handler",
      entry: join(__dirname, "../src/archive-lambda/index.ts"),
    });

    // Permissions for Lambda
    archiveBucket.grantWrite(archiveLambda);
    socialMediaDataTable.grantReadWriteData(archiveLambda);
    itemCountTable.grantReadWriteData(archiveLambda);

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
    const emails = ["jonasbraga2001+aws_alarms@gmail.com"];
    emails.forEach((email) => {
      snsAlarmTopic.addSubscription(new EmailSubscription(email));
    });
  }
}
