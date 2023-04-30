import { aws_ec2, aws_eks, Stack, StackProps, aws_iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import { WebAppChart } from "./webapp-eks-chart";
import { App } from "cdk8s";
import * as path from "path";
import { readYamlFile } from "../utils/read_yaml";
import { KubectlV24Layer } from "@aws-cdk/lambda-layer-kubectl-v24";
import { ClusterAutoscaler } from "./auto-scaler";

export interface CdkEksFargateStackProps extends StackProps {
  clusterName: string;
  vpc: aws_ec2.Vpc;
  webImage: string;
}

export class CdkEksFargateStack extends Stack {
  public readonly cluster: aws_eks.Cluster;
  public readonly nodeGroups: Array<aws_eks.Nodegroup> = [];

  constructor(scope: Construct, id: string, props: CdkEksFargateStackProps) {
    super(scope, id, props);

    // node role
    const nodeRole = new aws_iam.Role(this, "RoleForEksNode", {
      roleName: "RoleForEksNode",
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    nodeRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "CloudWatchAgentServerPolicy"
      )
    );

    nodeRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEKSWorkerNodePolicy"
      )
    );

    nodeRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEC2ContainerRegistryReadOnly"
      )
    );

    nodeRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy")
    );

    // create a cluster
    const cluster = new aws_eks.Cluster(this, props.clusterName, {
      version: aws_eks.KubernetesVersion.V1_24,
      kubectlLayer: new KubectlV24Layer(this, "kubectlLayer"),
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
    const nodeGroup = cluster.addNodegroupCapacity("MyNodeGroup", {
      instanceTypes: [new aws_ec2.InstanceType("t2.small")],
      subnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
      minSize: 2,
      desiredSize: 3,
      maxSize: 20,
      capacityType: aws_eks.CapacityType.ON_DEMAND,
      nodeRole: nodeRole,
    });

    // export output
    this.cluster = cluster;
    this.nodeGroups.push(nodeGroup);
  }
}

interface DeployChartProps extends StackProps {
  cluster: aws_eks.Cluster;
}

export class DeployChartStack extends Stack {
  constructor(scope: Construct, id: string, props: DeployChartProps) {
    super(scope, id, props);

    const cluster = props.cluster;

    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "test-update-deployment" },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: "test1" } },
        template: {
          metadata: { labels: { app: "test1" } },
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

    // cluster.addManifest("HelloManifest", deployment);
    cluster.addCdk8sChart(
      "TestWebAppChart",
      new WebAppChart(new App(), "TestWebAppChart", { image: "" })
    );
  }
}

interface MetricServerProps extends StackProps {
  cluster: aws_eks.Cluster;
}

export class MetricServerStack extends Stack {
  constructor(scope: Construct, id: string, props: MetricServerProps) {
    super(scope, id, props);

    const cluster = props.cluster;

    readYamlFile(path.join(__dirname, "./../yaml/metric_server.yaml"), cluster);
  }
}

interface AutoScalerProps extends StackProps {
  cluster: aws_eks.Cluster;
  nodeGroups: aws_eks.Nodegroup[];
}

export class AutoScalerHemlStack extends Stack {
  constructor(scope: Construct, id: string, props: AutoScalerProps) {
    super(scope, id, props);

    const cluster = props.cluster;

    new ClusterAutoscaler(this, "ClusterAutoScaler", {
      cluster: cluster,
      nodeGroups: props.nodeGroups,
    });
  }
}
