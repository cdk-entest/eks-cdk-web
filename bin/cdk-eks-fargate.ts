#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
// import { CdkEksFargateStack } from "../lib/cdk-eks-fargate-stack-backup";
import { VpcStack } from "../lib/network-stack";
import { EksClusterStack } from "../lib/eks-cluster-stack";

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

new EksClusterStack(app, "EksClusterStack", {
  clusterName: "EksDemo",
  eksSecurityGroup: network.eksSecurityGroup,
  vpc: network.vpc,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
});

// backup
// const cluster = new CdkEksFargateStack(app, "CdkEksFargateStack", {
//   vpc: network.vpc,
//   webImage: `${process.env.CDK_DEFAULT_ACCOUNT}.dkr.ecr.${region}.amazonaws.com/flask-app`,
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//     region: region,
//   },
// });
// cluster.addDependency(network);
