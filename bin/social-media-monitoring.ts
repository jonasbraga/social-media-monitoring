#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SocialMediaMonitoringStack } from "../lib/social-media-monitoring-stack";

const stage = process.env.STAGE || "dev";

const app = new cdk.App();
const stackName = "social-media-monitoring-stack-" + stage;
new SocialMediaMonitoringStack(app, stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  stage,
});
