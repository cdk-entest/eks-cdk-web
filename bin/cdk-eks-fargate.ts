#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CdkEksFargateStack } from "../lib/cdk-eks-fargate-stack";
import { VpcStack } from "../lib/network-stack";

const region = "us-east-1";
const app = new cdk.App();

const network = new VpcStack(app, "NetworkStack", {
  cidr: "10.0.0.0/16",
  name: "Network",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
});

const cluster = new CdkEksFargateStack(app, "CdkEksFargateStack", {
  vpc: network.vpc,
  webImage: `${process.env.CDK_DEFAULT_ACCOUNT}.dkr.ecr.${region}.amazonaws.com/flask-app-demo`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
});

cluster.addDependency(network);
