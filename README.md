---
title: launch an amazon eks cluster with cdk
author: haimtran
descripton: use cdk to create an amazon eks cluster
publishedDate: 24/04/2023
date: 24/04/2023
---

## Introduction

[Github](https://github.com/cdk-entest/eks-cdk-launch) shows essential components of an Amazon EKS cluster

- Essential Networking
- Essential Scurity
- Launch an EKS Cluster
- Deploy [the First App](https://github.com/cdk-entest/eks-cdk-launch/blob/master/yaml/hello-service.yaml)

## Architecture

![arch](https://user-images.githubusercontent.com/20411077/234173084-3deb3197-cbab-4471-bbff-497c7d6758d9.png)

Essential Networking

- public and private access points
- the control plane is hosted in an AWS account and VPC
- the control plane can auto scale with at least 2 API server instances and 3 ectd instances

Essential Security

- Cluster role so control plane can call other AWS services on your behalf
- Node role for all applications running inside the node
- Use both node role and service account (EC2 launch type) for security best practice
- Use both node role and pod execution role (Faragate launch type) for security best practice
- Three policies are required to attach to the node role
- AmazonEKSClusterPolicy is required to attach to the cluster role

## Network Stack

create a VPC

```ts
const vpc = new aws_ec2.Vpc(this, `${props.name}-Vpc`, {
  vpcName: props.name,
  maxAzs: 3,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  ipAddresses: aws_ec2.IpAddresses.cidr(props.cidr),
  // aws nat gateway service not instance
  natGatewayProvider: aws_ec2.NatProvider.gateway(),
  // can be less than num az default 1 natgw/zone
  natGateways: 1,
  // which public subet have the natgw
  // natGatewaySubnets: {
  //   subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
  // },
  subnetConfiguration: [
    {
      // cdk add igw and route tables
      name: "PublicSubnet",
      cidrMask: 24,
      subnetType: aws_ec2.SubnetType.PUBLIC,
    },
    {
      // cdk add nat and route tables
      name: "PrivateSubnetNat",
      cidrMask: 24,
      subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
  ],
});
```

create security group for worker nodes of EKS cluster

```ts
const eksSecurityGroup = new aws_ec2.SecurityGroup(this, "EksSecurityGroup", {
  securityGroupName: "EksSecurityGroup",
  vpc: vpc,
});

eksSecurityGroup.addIngressRule(
  eksSecurityGroup,
  aws_ec2.Port.allIcmp(),
  "self reference security group"
);
```

add a sts vpc endpoint

```ts
vpc.addInterfaceEndpoint("STSVpcEndpoint", {
  service: aws_ec2.InterfaceVpcEndpointAwsService.STS,
  open: true,
  subnets: {
    subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  securityGroups: [eksSecurityGroup],
});
```

## Cluster Stack

create an EKS cluster using CDK level 1 (equivalent to CloudFormation template)

select subnets where to place the worker nodes

```ts
const subnets: string[] = props.vpc.publicSubnets.map((subnet) =>
  subnet.subnetId.toString()
);
```

create role for the EKS cluster

```ts
const role = new aws_iam.Role(this, `RoleForEksCluster-${props.clusterName}`, {
  roleName: `RoleForEksCluster-${props.clusterName}`,
  assumedBy: new aws_iam.ServicePrincipal("eks.amazonaws.com"),
});

role.addManagedPolicy(
  aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSClusterPolicy")
);
```

create an EKS cluster

```ts
const cluster = new aws_eks.CfnCluster(
  this,
  `EksCluster-${props.clusterName}`,
  {
    name: props.clusterName,
    version: "1.25",
    resourcesVpcConfig: {
      // at least two subnets in different zones
      // at least 6 ip address, recommended 16
      subnetIds: subnets,
      //
      endpointPrivateAccess: false,
      //
      endpointPublicAccess: true,
      // cidr block allowed to access cluster
      // default 0/0
      publicAccessCidrs: ["0.0.0.0/0"],
      // eks will create a security group to allow
      // communication between control and data plane
      // nodegroup double check
      securityGroupIds: [props.eksSecurityGroup.securityGroupId],
    },
    kubernetesNetworkConfig: {
      // don not overlap with VPC
      // serviceIpv4Cidr: "",
    },
    // role for eks call aws service on behalf of you
    roleArn: role.roleArn,
    logging: {
      // by deault control plan logs is not exported to CW
      clusterLogging: {
        enabledTypes: [
          {
            // api | audit | authenticator | controllerManager
            type: "api",
          },
          {
            type: "controllerManager",
          },
          {
            type: "scheduler",
          },
          {
            type: "authenticator",
          },
          {
            type: "audit",
          },
        ],
      },
    },
  }
);
```

create role for worker node

```ts
const nodeRole = new aws_iam.Role(this, `RoleForEksNode-${props.clusterName}`, {
  roleName: `RoleForEksNode-${props.clusterName}`,
  assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
});

nodeRole.addManagedPolicy(
  aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy")
);

nodeRole.addManagedPolicy(
  aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
    "AmazonEC2ContainerRegistryReadOnly"
  )
);

nodeRole.addManagedPolicy(
  aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy")
);
```

add an aws managed group the the cluster

```ts
const nodegroup = new aws_eks.CfnNodegroup(this, "AWSManagedNodeGroupDemo", {
  nodegroupName: "AWSManagedNodeGroupDemo",
  // kubernetes version default from cluster
  // version: "",
  nodeRole: nodeRole.roleArn,
  clusterName: cluster.name!,
  subnets: subnets,
  // eks ami release version default latest
  // releaseVersion: ,
  capacityType: "ON_DEMAND",
  // default t3.medium
  instanceTypes: ["t2.medium"],
  diskSize: 50,
  // ssh remote access
  remoteAccess: {
    ec2SshKey: "eks-node-ssh",
  },
  // scaling configuration
  scalingConfig: {
    desiredSize: 2,
    maxSize: 5,
    minSize: 1,
  },
  // update configuration
  updateConfig: {
    maxUnavailable: 1,
    // maxUnavailablePercentage: 30,
  },
  // label configuration
  labels: {
    environment: "dev",
  },
});
```

## Fargate Profile

create pod role

```ts
const podRole = new aws_iam.Role(
  this,
  `RoleForFargatePod-${props.clusterName}`,
  {
    roleName: `RoleForFargatePod-${props.clusterName}`,
    assumedBy: new aws_iam.ServicePrincipal("eks-fargate-pods.amazonaws.com"),
  }
);

podRole.addManagedPolicy(
  aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
    "AmazonEKSFargatePodExecutionRolePolicy"
  )
);
```

create a Fargate profile

```ts
const appFargateProfile = new aws_eks.CfnFargateProfile(
  this,
  "FirstFargateProfileDemo1",
  {
    clusterName: cluster.name!,
    podExecutionRoleArn: podRole.roleArn,
    selectors: [
      {
        namespace: "demo",
        labels: [
          {
            key: "environment",
            value: "dev",
          },
        ],
      },
    ],
    fargateProfileName: "demo",
    // default all private subnet in the vpc
    subnets: subnets,
    tags: [
      {
        key: "name",
        value: "test",
      },
    ],
  }
);
```

## Node Selector

When an EKS cluster consists of EC2 nodegroup and Fargate profile, in some cases, we want to select specific pods to run some pods. To do that, we can use node labels, node selector, or affinity. For example, as Fargate profile does not support deamonset, we can select only EC2 nodes to launch deamon set as the following

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: eks.amazonaws.com/compute-type
              operator: NotIn
              values:
                - fargate
```

show labels of nodes

```bash
kubect get nodes --show-labels
```

## Cluster Authentication

- Kubernetes Role
- Kubernetes RoleBinding
- AWS IAM and RBAC

Kubernetes Role to setup permissions or what actions are allowed

```yaml
apiVersion: rbac.authorization.Kubernetes.io/v1
kind: Role
metadata:
  creationTimestamp: null
  namespace: default
  name: dev-role
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "patch", "update", "watch"]
```

Kubernetes RoleBinding to bind an identity (group or user) with the Role

```yaml
apiVersion: rbac.authorization.Kubernetes.io/v1
kind: RoleBinding
metadata:
  creationTimestamp: null
  name: dev-role-binding
  namespace: default
subjects:
  - kind: User
    name: developer
    apiGroup: rbac.authorization.Kubernetes.io
roleRef:
  kind: Role
  name: dev-role
  apiGroup: rbac.authorization.Kubernetes.io
```

Update the aws-auth configmap

```bash
kubectl edit -n kube-system configmap/aws-auth
```

An example of the aws-auth, mapping role to user and groups

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: aws-auth
  namespace: kube-system
data:
  mapRoles: |
    - rolearn: xxx 
      username: developer 
    - rolearn: <ARN of instance role (not instance profile)>
      username: system:node:{{EC2PrivateDNSName}}
      groups:
        - system:bootstrappers
        - system:nodes
```

Using eksctl as recommended by aws docs

```bash
eksctl delete iamidentitymapping \
--region=$Region \
--cluster=$ClusterName \
--arn=$Role \
```

Update the kube config

```bash
aws eks update-kubeconfig --name $ClusterName --role-arn $ROLE
```

## Service Account

Quoted from [docs](https://docs.aws.amazon.com/eks/latest/userguide/service-accounts.html): _A Kubernetes service account provides an identity for processes that run in a Pod_. There are some use cases to understand

- A process in a pod want to access data in S3, DynamoDB
- ALB Controller create a ALB controller in AWS
- Amazon EBS CSI Drive add-on creates presistent storate (EBS volumnes) in AWS
- AutoScaler trigger Auto Scaling Group in AWS

Essential components when setting up a service account for Kubernetes. In short, a service account in Kubernetes need to assume an IAM role to access to AWS services.

- OIDC Identity: the EKS cluster should have an OpenID Connect provider
- IAM Identity Provider
- Trust Policy: the process should be able to assume a role in AWS IAM
- ServiceAccount: create a service account in Kubernetes
- ServiceAccount: annotate the service account with the IAM role arn

Let consider two example

- Example 1: setup permissions for the EBS CSI Driver add-on
- Example 2: setup permissions for ADOT-Collector

In example 1, the driver need to create EBS volumnes in AWS services.

- Step 1. Create a service account in Kubernetes
- Step 2. Create Identity Provider in AWS IAM
- Step 3. Create an IAM role in AWS IAM

Step 1. Create a service account in Kubernetes. In this case, the service account **ebs-csi-controller-sa** already created when installing the add-on.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::$ACCOUNT:role/AmazonEKS_EBS_CSI_Driver
  creationTimestamp: "2023-05-13T06:11:46Z"
  labels:
    app.kubernetes.io/component: csi-driver
    app.kubernetes.io/managed-by: EKS
    app.kubernetes.io/name: aws-ebs-csi-driver
    app.kubernetes.io/version: 1.18.0
  name: ebs-csi-controller-sa
  namespace: kube-system
  resourceVersion: "66136"
```

Step 2. Create Identity Provider in AWS IAM

```bash
eksctl utils associate-iam-oidc-provider \
--cluster=$CLUSTER_NAME \
--approve
```

Step 3. Create an IAM role to be assumed by the service account

For example, create a role for the EBS CSI add-on. First, create a trust policy to allow the ID (OpenID Connect) assume the role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/oidc.eks.$REGION.amazonaws.com/id/$OIDC_ID"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.ek$REGION.amazonaws.com/id/$OIDC_ID:aud": "sts.amazonaws.com",
          "oidc.ek$REGION.amazonaws.com/id/$OIDC_ID:sub": "system:serviceaccount:kube-system:ebs-csi-controller-sa"
        }
      }
    }
  ]
}
```

Second, add policies to the role, for example AWS managed **AmazonEBSCSIDriverPolicy** policy to the role.

In example 2, the collector running in Faragte need permissions to send logs to AWS CloudWatch.

- Step 1. Create service account in Kubernetes
- Step 2. Create Identity Provider in AWS IAM
- Step 3. Create a Role in AWS IAM

By using eksctl, three step can be done in two commands below. Under the hoold, eksctl will create a Lambda function which call kubernetes API server.

```bash
#!/bin/bash
CLUSTER_NAME=EksClusterLevel1
REGION=ap-southeast-1
SERVICE_ACCOUNT_NAMESPACE=fargate-container-insights
SERVICE_ACCOUNT_NAME=adot-collector
SERVICE_ACCOUNT_IAM_ROLE=EKS-Fargate-ADOT-ServiceAccount-Role
SERVICE_ACCOUNT_IAM_POLICY=arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

eksctl utils associate-iam-oidc-provider \
--cluster=$CLUSTER_NAME \
--approve

eksctl create iamserviceaccount \
--cluster=$CLUSTER_NAME \
--region=$REGION \
--name=$SERVICE_ACCOUNT_NAME \
--namespace=$SERVICE_ACCOUNT_NAMESPACE \
--role-name=$SERVICE_ACCOUNT_IAM_ROLE \
--attach-policy-arn=$SERVICE_ACCOUNT_IAM_POLICY \
--approve
```

## AutoScaler

How scale up work?

- It checkes any unscheduled pods every 10 seconds (scan-interval)
- Change size (desired size) of the nodegroup of auto-scaling group
- Launch new nodes using templates

How scale down group? CA check for unneeded ndoes

- Every 10 seconds, if no scale up, CA checks which nodes are unneeded by some conditions (CPU, Mem)
- All pods running on the node can be moved to other nodes
- If a node is unneeded for more than 10 minutes, it will be terminated

Install the AutoScaler, for simple demo

- Update role for ec2 node, so it can scale the autoscaling group
- More secure way is to use service account
- Install AutoScaler yaml by kubectl
- Install AutoScaler by reading yaml and add to the cluster by CDK

There are some important parameters

- [AutoScaler reaction time](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time)
- [scan-interval](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time) 10 seconds by default which check for unscheduled pods via API servers
- [--scale-down-unneeded-time](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time)
- [--max-node-provision-time](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time) how log requested nodes to appear, within 15 minutes

Update role for ec2 node to work with auto-scaling group

```ts
nodeRole.addToPolicy(
  new aws_iam.PolicyStatement({
    effect: aws_iam.Effect.ALLOW,
    actions: [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeTags",
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup",
      "ec2:DescribeLaunchTemplateVersions",
    ],
    resources: ["*"],
  })
);
```

Optionally, update autoscaling tags

```ts
props.nodeGroups.forEach((element) => {
  new Tag(
    "Kubernetes.io/cluster-autoscaler/" + props.cluster.clusterName,
    "owned",
    {
      applyToLaunchedInstances: true,
    }
  );

  new Tag("Kubernetes.io/cluster-autoscaler/enabled", "true", {
    applyToLaunchedInstances: true,
  });
  policy.attachToRole(element.role);
});
```

Install AutoScaler by kubectl. Download the yaml and replace YOUR CLUSTER NAME with the cluster name Optionall, use affinity to launch this AutoScaler to the EC2 nodegroup only, no Faragte profile.

```bash
curl -O https://raw.githubusercontent.com/kubernetes/autoscaler/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml
```

Install AutoScaler using kubectl

```bash
kubect apply -f cluster-autoscaler-autodiscover.yaml
```

In case of CDK Construct level 2, it is possible to deploy the AutoScaler yaml by adding manifest to the cluster

```ts
readYamlFile(
  path.join(__dirname, "./../yaml/cluster-autoscaler-autodiscover.yaml"),
  cluster
);
```

Add the AutoScaler to cluster using CDK

```ts
const autoScaler = new AutoScalerHemlStack(app, "AutoScalerHemlStack", {
  cluster: eks.cluster,
  nodeGroups: eks.nodeGroups,
});
autoScaler.addDependency(eks);
```

Also update the scaling configuration of the nodegroup

```ts
  scalingConfig: {
          desiredSize: 2,
          maxSize: 22,
          minSize: 1,
        },
```

For load test, prepare a few things

- Update the cdKubernetes-app/dist/deployemt.yaml to max 1000 pods
- Update the Nodegroup with max 20 instances
- Artillery load test with 500 threads
- Check autoscaling console to the activity

```bash
artillery quick --num 10000 --count 100 "http://$ELB_ENDPOINT"
kubect get hpa --watch
kubect top pod -n default
kubect top node
```

Monitor logs of the AutoScaler

```bash
kubectl -n kube-system logs -f deployment.apps/cluster-autoscaler
```

## Observability for EKS EC2

There are serveral methods

- Applications send logs
- Sidecar container pattern
- Node agent (the most common method)

Depending on EC2 or Fargate, there are different tools

- Container Insights: CloudWatch Agent and Fluent Bit installed per node
- ADOT (AWS Distro for OpenTelemetry) works for both EC2 and Fargate

As the cluster using both EC2 nodegroup and Faragate profile

- Setup CloudWatch Agent and Fluent-bit for EC2 nodegroup
- Setup ADOT for Faragate profile
- Also need to setup the metric server

How CloudWatch Agent and Fluent Bit work?

- CloudWatch Agent installed per EC2 Node and collect metrics, then send to performance log group in CW
- Fluent Bit send logs to log groups: host, application, dataplane

Install metric sersver

```yaml
check the yaml/metric-server.yaml
```

Install CloudWatch Agent and Fluent-bit in EC2 Nodegroup

- replace region with your target region
- replace cluster-name with your cluster-name

```yaml
check the yaml/cwagent-fluent-bit.yaml
```

## Observability for EKS Fargate

How ADOT works in Fargate?

Quoted

```
The kubelet on a worker node in a Kubernetes cluster exposes resource metrics such as CPU, memory, disk, and network usage at the /metrics/cadvisor endpoint. However, in EKS Fargate networking architecture, a pod is not allowed to directly reach the kubelet on that worker node. Hence, the ADOT Collector calls the Kubernetes API Server to proxy the connection to the kubelet on a worker node, and collect kubelet’s cAdvisor metrics for workloads on that node.

```

- An ADOT Collector is installed in a Fargate box
- The ADOT call the API server for metrics
- The API server proxy to Kuberlete in each Fargate Box

Install ADOT in Fargate profile:

- assume the CF exection role
- install iamserviceaccount by assuming CF exection role
- install ADOT agent by using the default role

To assume CF exection role

```bash
aws sts assume-role --role-arn 'arn:aws:xxx' --role-session-name eks
```

Then update the ~/.aws/credentials with recevied credentials, then run the below bash script

```bash
#!/bin/bash
CLUSTER_NAME=EksClusterLevel1
REGION=ap-southeast-1
SERVICE_ACCOUNT_NAMESPACE=fargate-container-insights
SERVICE_ACCOUNT_NAME=adot-collector
SERVICE_ACCOUNT_IAM_ROLE=EKS-Fargate-ADOT-ServiceAccount-Role
SERVICE_ACCOUNT_IAM_POLICY=arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

eksctl utils associate-iam-oidc-provider \
--cluster=$CLUSTER_NAME \
--approve

eksctl create iamserviceaccount \
--cluster=$CLUSTER_NAME \
--region=$REGION \
--name=$SERVICE_ACCOUNT_NAME \
--namespace=$SERVICE_ACCOUNT_NAMESPACE \
--role-name=$SERVICE_ACCOUNT_IAM_ROLE \
--attach-policy-arn=$SERVICE_ACCOUNT_IAM_POLICY \
--approve
```

After created the iamserviceaccount, use the default role to run below command

```bash
ClusterName=EksClusterLevel1
REGION=ap-southeast-1
curl https://raw.githubusercontent.com/aws-observability/aws-otel-collector/main/deployment-template/eks/otel-fargate-container-insights.yaml | sed 's/YOUR-EKS-CLUSTER-NAME/'${ClusterName}'/;s/us-east-1/'${Region}'/' | kubectl apply -f -
```

## Prometheus

This section walk through steps to step up Prometheus

- Prometheus components and methods to setup
- Setup the EBS CSI Driver add-on with service account [here](https://cdk.entest.io/eks/service-account)
- Setup Prometheus and Grafana using helm chart

### Section 1. Components of Prometheus

Check [docs](https://prometheus.io/docs/introduction/overview/)

- Prometheus server
- Alert manager
- Pushgateway
- Node exporter
- PromQL, PrometheusUI, Grafana, API Clients

### Section 2. Setup Prometheus

There are several ways to setup monitoring with Prometheus, please read [docs](https://prometheus-operator.dev/docs/user-guides/getting-started/).

- [Prometheus-community helm chart ](https://github.com/prometheus-community/helm-charts/tree/main)
- [Kube-prometheus ](https://github.com/prometheus-operator/kube-prometheus)
- [Prometheus operator](https://github.com/prometheus-operator)

The easiest way is to use Prometheus community helm chart. First, add the repository

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
```

List charts from the repository

```bash
helm search repo prometheus-community
```

Then install the Prometheus community helm chart with custom configuration

```bash
helm install my-prometheus prometheus-community/prometheus -f ./test/prometheus_values.yaml
```

There are two methods for metric collectioin configuration

- Via ServiceMonitor and PodMonitor in Prometheus Operator [HERE](https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/user-guides/getting-started.md)
- Via scrape_configs in prometheus.yaml [HERE](https://www.cncf.io/blog/2021/10/25/prometheus-definitive-guide-part-iii-prometheus-operator/)

Forward port to see Prometheus server UI

```bash
kubectl port-forward deploy/prometheus-server 8080:9090 -n prometheus
```

First query with Prometheus

```sql
sum by (namespace) (kube_pod_info)
```

### Section 3. Prometheus and Granfana

To install both Prometheus and Grafana, choose another release

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/kube-prometheus-stack -f ./test/prometheus_values.yaml
```

Then port-forward to login the Grafana UI

```bash
kubectl port-forward deploy/prometheus-grafana 8081:3000 -n prometheus
```

Find the password to login Grafana

```bash
kubectl get secret --namespace prometheus prometheus-grafana -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
```

Login Grafana UI, and go to the menu button, find

- Dashboard and select Kubernetes/Compute Resources/ Pod and see
- Explore, select code, and query with PromQL

## Docker Image

Let build a docker image to deploy the next.js app. Here is the dockerfile

```
# layer 1
FROM node:lts as dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# layer 2
FROM node:lts as builder
WORKDIR /app
COPY . .
COPY --from=dependencies /app/node_modules ./node_modules
RUN npm run build

# layer 3
FROM node:lts as runner
WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# run
EXPOSE 3000
CMD ["npm", "start"]
```

The .dockerignore file

```
node_modules
**/node_modules/
.next
.git
```

Let write a python script to automate build and push to aws ecr

```py
import os
import subprocess

# parameters
REGION = "ap-southeast-1"
ACCOUNT = "227135398356"

# delete all docker images
os.system("sudo docker system prune -a")

# build next-app image
os.system("sudo docker build -t next-app . ")

#  aws ecr login
os.system(f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com")

# get image id
IMAGE_ID=os.popen("sudo docker images -q next-app:latest").read()

# tag next-app image
os.system(f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/next-app:latest")

# create ecr repository
os.system(f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name next-app")

# push image to ecr
os.system(f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/next-app:latest")

# run locally to test
os.system(f"sudo docker run -d -p 3000:3000 next-app:latest")
```

Run the container image locally to test it

```bash
sudo docker run -d -p 3000:3000 next-app:latest"
```

## Deploy in EKS

Let deploy the next.js app in EKS, here is the yaml file. Please replace the ecr image path

```yaml
apiVersion: v1
kind: Service
metadata:
  name: next-app-service
spec:
  ports:
    - port: 80
      targetPort: 3000
  selector:
    app: next-app
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: next-app-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: next-app
  template:
    metadata:
      labels:
        app: next-app
    spec:
      containers:
        - image: 227135398356.dkr.ecr.ap-southeast-1.amazonaws.com/next-app:latest
          name: next-app
          ports:
            - containerPort: 3000
          resources:
            limits:
              cpu: 500m
            requests:
              cpu: 500m
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: next-app-hpa
spec:
  maxReplicas: 1000
  metrics:
    - resource:
        name: cpu
        target:
          averageUtilization: 5
          type: Utilization
      type: Resource
  minReplicas: 2
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: next-app-deployment
```

## HTTPS Service

It is possible to use a domain registered in another account and create Route53 record in this account.

- Account A: register a domain from Route53
- Account A: create a record in Route53 which route to LB in account B
- Account B: create an ACM certificate and confirming by email
- Account B: create a service.yaml with annotations specifing the certificate

```yaml
apiVersion: v1
kind: Service
metadata:
  name: flask-app-service
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-backend-protocol: http
    service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:ap-southeast-1:$ACCOUNT:certificate/$ID"
    service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "https"
spec:
  ports:
    - port: 80
      targetPort: 8080
      name: http
    - port: 443
      targetPort: 8080
      name: https
  selector:
    app: flask-app
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flask-app-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: flask-app
  template:
    metadata:
      labels:
        app: flask-app
    spec:
      containers:
        - image: $ACCOUNT.dkr.ecr.ap-southeast-1.amazonaws.com/flask-app:latest
          name: flask-app
          ports:
            - containerPort: 8080
          resources:
            limits:
              cpu: 100m
            requests:
              cpu: 100m
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: flask-app-hpa
spec:
  maxReplicas: 1000
  metrics:
    - resource:
        name: cpu
        target:
          averageUtilization: 5
          type: Utilization
      type: Resource
  minReplicas: 2
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: flask-app-deployment
```

TODO: image here

Inside cluster we can shell into a busy box and wget to clusterip of the service

```bash
kubectl run busybox --image=busybox --rm -it --command -- bin/sh
```

then wget the cluster ip

```bash
wget -O- http://10.100.24.166:80
```

describe a service

```bash
describe service book-app-service
```

## Troubleshooting

- cloudformation execution role
- kubectl config update

After cdk bootstrap, it is recommended to update the trust policy of the cloudformation execution role it can be assumed by the role attached to dev machine.

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
        "AWS": "arn:aws:sts::$ACCOUNT_ID:assumed-role/TeamRole/MasterKey"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Since the cluster created by CloudFormation, we need to run kube config update before can run kubectl from our terminal. Find the cloudformation execution role from aws console, then replace below role arn with the CF exection role.

```bash
aws eks update-kubeconfig --name cluster-xxxxx --role-arn arn:aws:iam::112233445566:role/yyyyy
```

Make sure that the role which your terminal assuming has a trust relationship with the CF execution role

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

Since the EKS cluster is created by an CloudFormation execution role, we need to take note

- Update kube config with the role before running kubectl
- Ensure that your terminal can assume the CF execution role (trust policy)
- Assume the CF execution role, aws configure before running eksctl

Rolling update a deployment in Kubernetes

```bash
kubectl rollout restart deployment/flask-app-deployment
```

## Reference

- [Setup Container Insights](https://repost.aws/knowledge-center/cloudwatch-container-insights-eks-fargate)

- [Container Insights Fargate](https://aws-otel.github.io/docs/getting-started/container-insights/eks-fargate)

- [Fluent-bit EKS Fargate](https://aws.amazon.com/blogs/containers/fluent-bit-for-amazon-eks-on-aws-fargate-is-here/)

- [Node Selector Fluent-bit not in Fargate](https://github.com/aws/amazon-vpc-cni-Kubernetes/blob/master/config/master/aws-Kubernetes-cni-cn.yaml#L100)

- [eksctl Service Account](https://aws.amazon.com/blogs/containers/introducing-amazon-cloudwatch-container-insights-for-amazon-eks-fargate-using-aws-distro-for-opentelemetry/)

- [Fargate Profile CPU and Mem](https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html)

- [AutoScaler reaction time](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time)

- [Prometheus Operator Blog](https://blog.container-solutions.com/prometheus-operator-beginners-guide)

- [Service HTTPS](https://repost.aws/knowledge-center/eks-apps-tls-to-activate-https)

- [EKS HTTPS](https://repost.aws/knowledge-center/terminate-https-traffic-eks-acm)

## Jupyter Notebook

```
http://a2392d969c12f4e54ad1339d701fff9e-1597214113.ap-southeast-1.elb.amazonaws.com/lab?token=353fa7be714cfe810cf60a37be95488000ceb9398f111444
```

```bash
aws eks update-kubeconfig --name EksClusterLevel1 --role-arn arn:aws:iam::392194582387:role/cdk-hnb659fds-cfn-exec-role-392194582387-ap-southeast-1
```
