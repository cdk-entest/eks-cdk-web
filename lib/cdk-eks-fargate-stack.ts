import { aws_ec2, aws_eks, Stack, StackProps } from "aws-cdk-lib";
import { KubernetesManifest } from "aws-cdk-lib/aws-eks";
import { App, Chart, ChartProps } from "cdk8s";
import { IntOrString, KubeDeployment, KubeService } from "../imports/k8s";
import { Construct } from "constructs";
import * as cdk8s from "cdk8s";
import * as fs from "fs";
import * as yaml from "js-yaml";

export function readYamlFromDir(dir: string, cluster: aws_eks.Cluster) {
  let previousResource: KubernetesManifest;
  fs.readdirSync(dir, "utf8").forEach((file) => {
    if (file != undefined && file.split(".").pop() == "yaml") {
      let data = fs.readFileSync(dir + file, "utf8");
      if (data != undefined) {
        let i = 0;
        yaml.loadAll(data).forEach((item) => {
          const resource = cluster.addManifest(
            file.substr(0, file.length - 5) + i,
            item as any
          );
          // @ts-ignore
          if (previousResource != undefined) {
            resource.node.addDependency(previousResource);
          }
          previousResource = resource;
          i++;
        });
      }
    }
  });
}

export interface CdkEksFargateStackProps extends StackProps {
  vpcId: string;
}

export class CdkEksFargateStack extends Stack {
  constructor(scope: Construct, id: string, props: CdkEksFargateStackProps) {
    super(scope, id, props);

    // lookup existing vpc
    const vpc = aws_ec2.Vpc.fromLookup(this, "LookUpVpc", {
      vpcId: props.vpcId,
      vpcName: "DevDemo",
    });

    // create a cluster
    const cluster = new aws_eks.Cluster(this, "HelloCluster", {
      version: aws_eks.KubernetesVersion.V1_21,
      clusterName: "HelloCluster",
      outputClusterName: true,
      endpointAccess: aws_eks.EndpointAccess.PUBLIC,
      vpc: vpc,
      vpcSubnets: [{ subnetType: aws_ec2.SubnetType.PUBLIC }],
      defaultCapacity: 0,
    });

    cluster.addNodegroupCapacity("MyNodeGroup", {
      instanceTypes: [new aws_ec2.InstanceType("m5.large")],
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
    cluster.addCdk8sChart("my-chart", new MyChart(new cdk8s.App(), "MyChart"));
  }
}

export class MyChart extends Chart {
  constructor(scope: Construct, id: string, props: ChartProps = {}) {
    super(scope, id, props);

    const label = { app: "hello-k8s" };

    new KubeService(this, "service", {
      spec: {
        type: "LoadBalancer",
        ports: [{ port: 80, targetPort: IntOrString.fromNumber(8080) }],
        selector: label,
      },
    });

    new KubeDeployment(this, "deployment", {
      spec: {
        replicas: 2,
        selector: {
          matchLabels: label,
        },
        template: {
          metadata: { labels: label },
          spec: {
            containers: [
              {
                name: "hello-kubernetes",
                image: "paulbouwer/hello-kubernetes:1.7",
                ports: [{ containerPort: 8080 }],
              },
            ],
          },
        },
      },
    });
  }
}
