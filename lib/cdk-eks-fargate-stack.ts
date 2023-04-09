import { aws_ec2, aws_eks, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cdk8s from "cdk8s";
import { WebAppChart } from "./webapp-eks-chart";

export interface CdkEksFargateStackProps extends StackProps {
  vpc: aws_ec2.Vpc;
  webImage: string;
}

export class CdkEksFargateStack extends Stack {
  constructor(scope: Construct, id: string, props: CdkEksFargateStackProps) {
    super(scope, id, props);

    // create a cluster
    const cluster = new aws_eks.Cluster(this, "HelloCluster", {
      version: aws_eks.KubernetesVersion.V1_21,
      clusterName: "HelloCluster",
      outputClusterName: true,
      endpointAccess: aws_eks.EndpointAccess.PUBLIC,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: aws_ec2.SubnetType.PUBLIC }],
      defaultCapacity: 0,
    });

    cluster.addNodegroupCapacity("MyNodeGroup", {
      instanceTypes: [new aws_ec2.InstanceType("t2.small")],
      subnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
    });

    // apply a kubernetes manifest to the cluster
    cluster.addManifest("mypod", {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "mypod" },
      spec: {
        containers: [
          {
            name: "hello",
            image: "paulbouwer/hello-kubernetes:1.5",
            ports: [{ containerPort: 8080 }],
          },
        ],
      },
    });

    // method 1: read the yaml into a cluster
    // readYamlFromDir("./cdk8s/dist/", cluster);

    // method 2: cdk8s integration chart
    cluster.addCdk8sChart(
      "webapp",
      new WebAppChart(new cdk8s.App(), "WebAppChart", {
        image: props.webImage,
      })
    );
  }
}
