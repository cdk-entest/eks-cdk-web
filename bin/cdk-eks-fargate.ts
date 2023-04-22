import * as cdk from "aws-cdk-lib";
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

