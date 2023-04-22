import * as cdk from "aws-cdk-lib";
import {
  CdkEksFargateStack,
  DeployChartStack,
} from "../lib/eks-cluster-level2-stack";
import { VpcStack } from "../lib/network-stack";

const app = new cdk.App();

const network = new VpcStack(app, "NetworkStack", {
  cidr: "10.0.0.0/16",
  name: "Network",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const eks = new CdkEksFargateStack(app, "CdkEksFargateStack", {
  clusterName: "EksClusterLevel2",
  vpc: network.vpc,
  webImage: "",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// const deploy = new DeployChartStack(app, "DeployChartStack", {
//   cluster: eks.cluster,
// });

eks.addDependency(network);
// deploy.addDependency(eks);