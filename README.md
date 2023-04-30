---
title: introduction to eks on aws with cdk
author: haimtran
descripton: using cdk and cdk8s to deploy eks
publishedDate:
date:
---

## Introduction

- Hello EKS and CDK8s
- Deploy by adding manifest in yaml
- Deploy by CDK8s construct
- Expose a service via ALB
- Update kube-config (CDK output noted)
- Monitor with CloudWatch Container Insight
- Please create key-pair for ec2 node (sorry)

## Project Structure

init a cdk project by command

```bash
cdk init
```

then also install dependencies for cdk8s

```bash
npm install package.json
```

package.json

```json
{
  "name": "cdk-eks-fargate",
  "version": "0.1.0",
  "bin": {
    "cdk-eks-fargate": "bin/cdk-eks-fargate.js"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "jest",
    "cdk": "cdk"
  },
  "devDependencies": {
    "@types/jest": "^27.5.2",
    "@types/js-yaml": "^4.0.5",
    "@types/node": "10.17.27",
    "@types/prettier": "2.6.0",
    "aws-cdk": "2.67.0",
    "jest": "^27.5.1",
    "ts-jest": "^27.1.4",
    "ts-node": "^10.9.1",
    "typescript": "~3.9.7"
  },
  "dependencies": {
    "aws-cdk-lib": "2.67.0",
    "cdk8s": "^2.5.86",
    "cdk8s-plus-24": "^2.3.7",
    "constructs": "^10.0.0",
    "js-yaml": "^4.1.0",
    "package.json": "^2.0.1",
    "source-map-support": "^0.5.21"
  }
}
```

then check the project structure as below

```ts
|--bin
   |--cdk-eks-fargate.ts
|--imports
   |--k8s.ts
|--lib
   |--cdk-eks-fargate-stack.ts
   |--network-stack.ts
   |--webapp-eks-chart.ts
|--webapp
   |--Dockerfile
   |--app.y
   |--requirements.txt
   |-static
   |--templates
|--package.json
```

## Create a EKS Cluster

create a eks cluster

```ts
const cluster = new aws_eks.Cluster(this, "HelloCluster", {
  version: aws_eks.KubernetesVersion.V1_21,
  clusterName: "HelloCluster",
  outputClusterName: true,
  endpointAccess: aws_eks.EndpointAccess.PUBLIC,
  vpc: vpc,
  vpcSubnets: [{ subnetType: aws_ec2.SubnetType.PUBLIC }],
  defaultCapacity: 0,
});
```

add node group (there are different type of node group). By default, a AWS managed group with 2 m5.large instances will be created, and those nodes placed in private subnet with NAT by default. Set defaultCapacity to 0 will not apply this default setting, then add a node group as below

```ts
cluster.addNodegroupCapacity("MyNodeGroup", {
  instanceTypes: [new aws_ec2.InstanceType("m5.large")],
  subnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
});
```

we need to understand there are three roles

- creation role which is assumed by CDK in this case
- cluster role which is assumed by the cluster on behalf of us to access aws resources
- master role which is added to kubernetes RBAC

to kubectl into the cluster, we need to configure out client with the creation role. Please look up this role in CloudFormation

```bash
aws eks update-kubeconfig --name cluster-xxxxx --role-arn arn:aws:iam::112233445566:role/yyyyy
Added new context arn:aws:eks:rrrrr:112233445566:cluster/cluster-xxxxx to /home/boom/.kube/config
```

## Deploy by Adding Manifest (YAML)

option 1 is to add manifest to a cluster to deploy an container application

```ts
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
```

assume that there are already a YAML file then it can be read and added to the cluster by a function as below

```tsx
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
```

## Deploy by Construct

create a cdk8s chart as below

```ts
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
```

then integrate the chart with cdk stack (cluster) as below

```ts
cluster.addCdk8sChart("my-chart", new MyChart(new cdk8s.App(), "MyChart"));
```

## Expose a Service via ALB

to expose a service so that it is publicly accessible via the internet, one solution is via a LoadBalancer service which we be deployed as a classic load balancer in AWS cloud provider

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cdk8s-service-c844e1e1
spec:
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: hello-k8s
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cdk8s-deployment-c8087a1b
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-k8s
  template:
    metadata:
      labels:
        app: hello-k8s
    spec:
      containers:
        - image: paulbouwer/hello-kubernetes:1.7
          name: hello-kubernetes
          ports:
            - containerPort: 8080
```

## Horizontal Scaling

following the kubernetes docs [HERE] to see how to create a Horizontal Pod AutoScaler

```yaml
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: cdk8s-webhorizontalautoscaler-c8c254b6
spec:
  maxReplicas: 5
  metrics:
    - resource:
        name: cpu
        target:
          averageUtilization: 85
          type: Utilization
      type: Resource
  minReplicas: 2
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: hello-k8s
```

create the HPA using cdk8s as

```ts
new KubeHorizontalPodAutoscalerV2Beta2(this, "WebHorizontalAutoScaler", {
  spec: {
    minReplicas: 2,
    maxReplicas: 5,
    scaleTargetRef: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "hello-k8s",
    },
    // default 80% cpu utilization
    metrics: [
      {
        type: "Resource",
        resource: {
          name: "cpu",
          target: {
            type: "Utilization",
            averageUtilization: 85,
          },
        },
      },
    ],
  },
});
```

## Develop with CDK8S

install cdk8s

```bash
npm install -g cdk8s-cli
```

create a new cdk8s-app directory

```bash
mkdir cdk8s-app
```

and then init a new cdk8s project

```bash
cdk8s init typescript-app
```

project structure

```
|--bin
   |--cdk-eks-fargate.ts
|--lib
   |--eks-cluster-stack.ts
   |--network-stack.ts
|--cdk8s-app
   |--dist
   |--imports
   |--main.ts
```

synthesize from ts to yaml

```bash
cdk8s --app 'npx ts-node main.ts' synth
```

develop an service and auto-scaling

```ts
import { App, Chart, ChartProps } from "cdk8s";
import {
  IntOrString,
  KubeDeployment,
  KubeService,
  KubeHorizontalPodAutoscalerV2Beta2,
} from "./imports/k8s";
import { Construct } from "constructs";

interface WebAppChartProps extends ChartProps {
  image: string;
}

export class WebAppChart extends Chart {
  constructor(scope: Construct, id: string, props: WebAppChartProps) {
    super(scope, id, props);

    const label = { app: "hello-cdk8s" };

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
                // image: "paulbouwer/hello-kubernetes:1.7",
                image: props.image,
                ports: [{ containerPort: 8080 }],
              },
            ],
          },
        },
      },
    });

    new KubeHorizontalPodAutoscalerV2Beta2(this, "WebHorizontalAutoScaler", {
      spec: {
        minReplicas: 2,
        maxReplicas: 5,
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: "hello-cdk8s",
        },
        // default 80% cpu utilization
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: {
                type: "Utilization",
                averageUtilization: 85,
              },
            },
          },
        ],
      },
    });
  }
}

const app = new App();
new WebAppChart(app, "cdk8s-app", {
  image: "$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/flask-web:latest",
});
app.synth();
```

## Build Docker Image

install docker engine

```bash
https://docs.docker.com/engine/install/ubuntu/
```

build my image

```bash
docker build -t flask-app .
```

run docker image

```bash
docker run -d -p 3000:3000 flask-app:latest
```

list docker running

```bash
docker ps
```

stop all running containers

```bash
docker kill $(docker ps -q)
```

delete all docker images

```bash
docker system prune -a

```

docker ecr log in

```bash
aws ecr get-login-password --region us-east-1 | sudo docker login --username AWS --password-stdin 642644951129.dkr.ecr.us-east-1.amazonaws.com
```

tag image

```bash
sudo docker tag 121345bea3b3 642644951129.dkr.ecr.us-east-1.amazonaws.com/flask-app:latest
```

push image to ecr

```bash
sudo docker push 642644951129.dkr.ecr.us-east-1.amazonaws.com/flask-app:latest
```

please go to aws ecr console and create flask-app repository

## Observability

Install metrics server [here](https://docs.aws.amazon.com/eks/latest/userguide/metrics-server.html)

```bash
kubectl top pods
kubectl top nodes
```

Ensure that nodes has permissions to send metrics to cloudwatch [here](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-prerequisites.html) by attaching the following aws managed policy to nodes.

```ts
CloudWatchAgentServerPolicy;
```

Follow [this](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-setup-EKS-quickstart.html) to quick start create CloudWatch agent and Fluentbit which send metrics and logs to CloudWatch

```bash
ClusterName=EksDemo
RegionName=us-east-1
FluentBitHttpPort='2020'
FluentBitReadFromHead='Off'
[[${FluentBitReadFromHead} = 'On']] && FluentBitReadFromTail='Off'|| FluentBitReadFromTail='On'
[[-z ${FluentBitHttpPort}]] && FluentBitHttpServer='Off' || FluentBitHttpServer='On'
curl https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluent-bit-quickstart.yaml | sed 's/{{cluster_name}}/'${ClusterName}'/;s/{{region_name}}/'${RegionName}'/;s/{{http_server_toggle}}/"'${FluentBitHttpServer}'"/;s/{{http_server_port}}/"'${FluentBitHttpPort}'"/;s/{{read_from_head}}/"'${FluentBitReadFromHead}'"/;s/{{read_from_tail}}/"'${FluentBitReadFromTail}'"/' | kubectl apply -f -
```

delete the Container Insight

```bash
curl https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluent-bit-quickstart.yaml | sed 's/{{cluster_name}}/'${ClusterName}'/;s/{{region_name}}/'${LogRegion}'/;s/{{http_server_toggle}}/"'${FluentBitHttpServer}'"/;s/{{http_server_port}}/"'${FluentBitHttpPort}'"/;s/{{read_from_head}}/"'${FluentBitReadFromHead}'"/;s/{{read_from_tail}}/"'${FluentBitReadFromTail}'"/' | kubectl delete -f -
```

## Kube Config

create kube config (if you already deleted it)

```bash
aws eks update-kubeconfig --region region-code --name my-cluster
```

if the cluster created by CDK or cloudformation, so we need to update the kube configu with the execution role.

```bash
aws eks update-kubeconfig --name cluster-xxxxx --role-arn arn:aws:iam::112233445566:role/yyyyy
```

there are some ways to find the role arn

- from cloudformation CDK bootstrap
- from CDK terminal output
- query EKS cluster loggroup given that authenticator log enabled

ensure than the execution role can be assumed by AWS account from your termial

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudformation.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::$ACCOUNT:role/TeamRole"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

## Troubleshotting

Ensure that the role which used to create the EKS cluster and the role used to access the cluster are the same. In case of CDK deploy, the output from CDK terminal look like this

```bash
Outputs:
ClusterConfigCommand43AAE40F = aws eks update-kubeconfig --name cluster-xxxxx --role-arn arn:aws:iam::112233445566:role/yyyyy

```

copy and run the update config command

```bash
aws eks update-kubeconfig --name cluster-xxxxx --role-arn arn:aws:iam::112233445566:role/yyyyy
Added new context arn:aws:eks:rrrrr:112233445566:cluster/cluster-xxxxx to /home/boom/.kube/config
```

Shell into a busybox and wget the service

```bash
kubectl run busybox --image=busybox --rm -it --command -- bin/sh
```

After using CDK to deploy a yaml manifest,

```ts
cluster.addManifest("HelloDeployment", deployment);
```

then if we update the deployment yaml and CDK deploy againt, [error appear](https://github.com/aws/aws-cdk/issues/15072), this is due to mismatch, hardcode of Lambda layer, please fix it

```bash
npm install @aws-cdk/lambda-layer-kubectl-v24
```

then update cluster stack

```ts
 version: aws_eks.KubernetesVersion.V1_24,
kubectlLayer: new KubectlV24Layer(this, "kubectlLayer")
```

## Load Test

```bash
artillery quick --num 10000 --count 100 "http://$ELB_ENDPOINT"
kubect get hpa --watch
kubect top pod -n default
kubect top node
```

## Reference

- [amazon eks cdk](https://aws.amazon.com/blogs/architecture/field-notes-managing-an-amazon-eks-cluster-using-aws-cdk-and-cloud-resource-property-manager/)

- [cdk chart example](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_eks-readme.html#cdk8s-charts)

- [aws managed node group](https://aws.amazon.com/blogs/containers/leveraging-amazon-eks-managed-node-group-with-placement-group-for-low-latency-critical-applications/)

- [kubernetes pod select node label](https://kubernetes.io/docs/tasks/configure-pod-container/assign-pods-nodes/)

- [kube config update](https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html)

- [install metrics server](https://docs.aws.amazon.com/eks/latest/userguide/metrics-server.html)

- [CDK EKS workshop](https://catalog.us-east-1.prod.workshops.aws/workshops/c15012ac-d05d-46b1-8a4a-205e7c9d93c9/en-US/40-deploy-clusters/300-container/330-chart)

- [read yaml file](https://github.com/yjw113080/aws-cdk-eks-multi-region-skeleton/blob/master/utils/read-file)

- [error lambda KubectlLayer](https://github.com/aws/aws-cdk/issues/15072)

- [fix error lambda KubectlLayer](https://github.com/cdklabs/awscdk-asset-kubectl)

- [kubenetes reserved cpu](https://github.com/awslabs/amazon-eks-ami/pull/367)

- [KuberServed resource](https://kubernetes.io/docs/tasks/administer-cluster/reserve-compute-resources/)

```
CdkEksFargateStack.EksClusterLevel2ClusterName5A4A7685 = EksClusterLevel2
CdkEksFargateStack.EksClusterLevel2ConfigCommand393D8FC7 = aws eks update-kubeconfig --name EksClusterLevel2 --region us-west-2 --role-arn arn:aws:iam::002123586681:role/CdkEksFargateStack-EksClusterLevel2MastersRole40A1-PF3HKRBKGN9F
CdkEksFargateStack.EksClusterLevel2GetTokenCommandA1DFFD22 = aws eks get-token --cluster-name EksClusterLevel2 --region us-west-2 --role-arn arn:aws:iam::002123586681:role/CdkEksFargateStack-EksClusterLevel2MastersRole40A1-PF3HKRBKGN9F
```

1. 
  Namespace                   Name                                              CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  ---------                   ----                                              ------------  ----------  ---------------  -------------  ---
  amazon-cloudwatch           cloudwatch-agent-75hqg                            200m (21%)    200m (21%)  200Mi (13%)      200Mi (13%)    27m
  amazon-cloudwatch           fluent-bit-w8knb                                  500m (53%)    0 (0%)      100Mi (6%)       200Mi (13%)    28m
  default                     cdk8s-app-deployment-c8f953f2-5b5d597c74-9hnt5    100m (10%)    100m (10%)  0 (0%)           0 (0%)         23m
  kube-system                 aws-node-mt8sz                                    25m (2%)      0 (0%)      0 (0%)           0 (0%)         28m
  kube-system                 kube-proxy-4prll                                  100m (10%)    0 (0%)      0 (0%)           0 (0%)         28m
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource                    Requests     Limits
  --------                    --------     ------
  cpu                         925m (98%)   300m (31%)
  memory                      300Mi (20%)  400Mi (26%)
  ephemeral-storage           0 (0%)       0 (0%)
  hugepages-2Mi               0 (0%)       0 (0%)
  attachable-volumes-aws-ebs  0            0


2. 
  Namespace                   Name                               CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  ---------                   ----                               ------------  ----------  ---------------  -------------  ---
  amazon-cloudwatch           cloudwatch-agent-rh72m             200m (21%)    200m (21%)  200Mi (13%)      200Mi (13%)    166m
  amazon-cloudwatch           fluent-bit-vrg7l                   500m (53%)    0 (0%)      100Mi (6%)       200Mi (13%)    166m
  kube-system                 aws-node-fv5m9                     25m (2%)      0 (0%)      0 (0%)           0 (0%)         9h
  kube-system                 kube-proxy-5sdfz                   100m (10%)    0 (0%)      0 (0%)           0 (0%)         9h
  kube-system                 metrics-server-66964f547c-d7xgq    100m (10%)    0 (0%)      200Mi (13%)      0 (0%)         9h
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource                    Requests     Limits
  --------                    --------     ------
  cpu                         925m (98%)   200m (21%)
  memory                      500Mi (33%)  400Mi (26%)
  ephemeral-storage           0 (0%)       0 (0%)
  hugepages-2Mi               0 (0%)       0 (0%)
  attachable-volumes-aws-ebs  0            0

3.  

 Namespace                   Name                                                    CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  ---------                   ----                                                    ------------  ----------  ---------------  -------------  ---
  amazon-cloudwatch           cloudwatch-agent-t2w68                                  200m (21%)    200m (21%)  200Mi (13%)      200Mi (13%)    166m
  default                     cdk8s-app-deployment-c8f953f2-5b5d597c74-djdnw          100m (10%)    100m (10%)  0 (0%)           0 (0%)         23m
  default                     testwebappchart-deployment-c8b028d9-669fcf7c77-z97tk    0 (0%)        0 (0%)      0 (0%)           0 (0%)         9h
  default                     testwebappchart-deployment-c8b028d9-669fcf7c77-zx4f5    0 (0%)        0 (0%)      0 (0%)           0 (0%)         9h
  kube-system                 aws-node-lqtkg                                          25m (2%)      0 (0%)      0 (0%)           0 (0%)         9h
  kube-system                 coredns-57ff979f67-hk64k                                100m (10%)    0 (0%)      70Mi (4%)        170Mi (11%)    9h
  kube-system                 coredns-57ff979f67-nlrcr                                100m (10%)    0 (0%)      70Mi (4%)        170Mi (11%)    9h
  kube-system                 kube-proxy-cnk48                                        100m (10%)    0 (0%)      0 (0%)           0 (0%)         9h
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource                    Requests     Limits
  --------                    --------     ------
  cpu                         625m (66%)   300m (31%)
  memory                      340Mi (22%)  540Mi (36%)
  ephemeral-storage           0 (0%)       0 (0%)
  hugepages-2Mi               0 (0%)       0 (0%)
  attachable-volumes-aws-ebs  0       

4. 
 Namespace                   Name                      CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  ---------                   ----                      ------------  ----------  ---------------  -------------  ---
  amazon-cloudwatch           cloudwatch-agent-4lrf4    200m (21%)    200m (21%)  200Mi (13%)      200Mi (13%)    27m
  amazon-cloudwatch           fluent-bit-v66wl          500m (53%)    0 (0%)      100Mi (6%)       200Mi (13%)    28m
  kube-system                 aws-node-gq2z6            25m (2%)      0 (0%)      0 (0%)           0 (0%)         28m
  kube-system                 kube-proxy-5gdbh          100m (10%)    0 (0%)      0 (0%)           0 (0%)         28m
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource                    Requests     Limits
  --------                    --------     ------
  cpu                         825m (87%)   200m (21%)
  memory                      300Mi (20%)  400Mi (26%)
  ephemeral-storage           0 (0%)       0 (0%)
  hugepages-2Mi               0 (0%)       0 (0%)
  attachable-volumes-aws-ebs  0            0

5. 
 Namespace                   Name                                   CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  ---------                   ----                                   ------------  ----------  ---------------  -------------  ---
  amazon-cloudwatch           cloudwatch-agent-6zvnt                 200m (21%)    200m (21%)  200Mi (13%)      200Mi (13%)    166m
  amazon-cloudwatch           fluent-bit-xnfkf                       500m (53%)    0 (0%)      100Mi (6%)       200Mi (13%)    166m
  kube-system                 aws-node-hrrts                         25m (2%)      0 (0%)      0 (0%)           0 (0%)         9h
  kube-system                 cluster-autoscaler-5c5bb8c959-tfcrb    100m (10%)    100m (10%)  600Mi (40%)      600Mi (40%)    125m
  kube-system                 kube-proxy-p8g89                       100m (10%)    0 (0%)      0 (0%)           0 (0%)         9h
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource                    Requests     Limits
  --------                    --------     ------
  cpu                         925m (98%)   300m (31%)
  memory                      900Mi (60%)  1000Mi (67%)
  ephemeral-storage           0 (0%)       0 (0%)
  hugepages-2Mi               0 (0%)       0 (0%)
  attachable-volumes-aws-ebs  0            0
  
