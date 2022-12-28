#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CdkEksFargateStack } from "../lib/cdk-eks-fargate-stack";

const app = new cdk.App();
new CdkEksFargateStack(app, "CdkEksFargateStack", {
  vpcId: "vpc-07cafc6a819930727",
  webImage: `${process.env.CDK_DEFAULT_ACCOUNT}.dkr.ecr.ap-southeast-1.amazonaws.com/flask-app-demo`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-1",
  },
});
