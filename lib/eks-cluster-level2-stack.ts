import { aws_ec2, aws_eks, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { WebAppChart } from "./webapp-eks-chart";
import { App } from "cdk8s";

export interface CdkEksFargateStackProps extends StackProps {
  clusterName: string;
  vpc: aws_ec2.Vpc;
  webImage: string;
}

export class CdkEksFargateStack extends Stack {
  public readonly cluster: aws_eks.ICluster;

  constructor(scope: Construct, id: string, props: CdkEksFargateStackProps) {
    super(scope, id, props);

    // create a cluster
    const cluster = new aws_eks.Cluster(this, props.clusterName, {
      version: aws_eks.KubernetesVersion.V1_23,
      clusterName: props.clusterName,
      outputClusterName: true,
      endpointAccess: aws_eks.EndpointAccess.PUBLIC,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: aws_ec2.SubnetType.PUBLIC }],
      defaultCapacity: 0,
      clusterLogging: [
        aws_eks.ClusterLoggingTypes.API,
        aws_eks.ClusterLoggingTypes.AUTHENTICATOR,
        aws_eks.ClusterLoggingTypes.AUDIT,
        aws_eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        aws_eks.ClusterLoggingTypes.SCHEDULER,
      ],
    });

    // add nodegroup
    cluster.addNodegroupCapacity("MyNodeGroup", {
      instanceTypes: [new aws_ec2.InstanceType("t2.small")],
      subnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
      minSize: 2,
      desiredSize: 3,
      maxSize: 5,
      capacityType: aws_eks.CapacityType.ON_DEMAND,
    });

    // deployment manifest
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "test-deployment" },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: "test" } },
        template: {
          metadata: { labels: { app: "test" } },
          spec: {
            containers: [
              {
                name: "hello-kubernetes",
                image: "paulbouwer/hello-kubernetes:1.5",
                ports: [{ containerPort: 8080 }],
              },
            ],
          },
        },
      },
    };

//    new aws_eks.KubernetesManifest(this, "HelloManifest", {
//      cluster,
//      manifest: [deployment],
//    });

    // create a cdk8s chart
//    const chart = new WebAppChart(new App(), "TestWebAppChart", { image: "" });
 //   cluster.addCdk8sChart("TestWebAppChart", chart);

    // export output
    this.cluster = cluster;
  }
}

interface DeployChartProps extends StackProps {
  cluster: aws_eks.ICluster;
}

export class DeployChartStack extends Stack {
  constructor(scope: Construct, id: string, props: DeployChartProps) {
    super(scope, id, props);

    const chart = new WebAppChart(new App(), "WebAppChart", { image: "" });

    props.cluster.addCdk8sChart("WebAppChart", chart);
  }
}
