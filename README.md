---
title: deploy polly app and scale on amazon eks
author: haimtran
descripton: deploy polly app and scale on amazon eks
publishedDate: 24/04/2023
date: 24/04/2023
---

## Introduction

[Github](https://github.com/cdk-entest/eks-cdk-web/tree/master) shows how to deploy a simple webapp and scale it on amazon eks

- Amazon EKS architecture
- Launch an EKS cluster using CDK
- Setup HPA and CA
- Deploy the polly webapp
- Scale the polly webapp

## Amazon EKS Architecture

![arch](https://user-images.githubusercontent.com/20411077/234173084-3deb3197-cbab-4471-bbff-497c7d6758d9.png)

Essential Networking

- public and private access points
- the control plane is hosted in an AWS account and VPC
- the control plane can auto scale with at least 2 API server instances and 3 ectd instances

Essential Security

- Cluster role so control plane can call other AWS services on your behalf
- Node role for all applications running inside the node
- Use both node role and service account (EC2 launch type) for security best practice
- Use service account and pod execution role (Faragate launch type) for security best practice
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

Let create an EKS cluster using CDK level 1 (equivalent to CloudFormation template). Select subnets where to place the worker nodes

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

## Horizontal Pod AutoScaler

![eks_hpa](https://github.com/cdk-entest/eks-cdk-web/assets/20411077/21acf4d5-2a8c-4eba-8d3d-ebac17baeb93)

<LinkedImage alt="eks hpa" src="/thumbnail/eks_hpa.png" />

The HPA scales based on default or custom (external) metrics. How it works?

- Metrics are specified in the HPA definition
- Once during the period (15 seconds), the controller manager queries the metrics
- HPA access and adjust the scale parameter in Deployment or StatefulSet

It is possible to setup custom metrics, such as SQS length from AWS CloudWatch, or use a Lambda functionn to trigger Kubernetes scale via updating, setting Deployment, StatefulSet with a new number of replica . There are important parameters

- [horizontal-pod-autoscaler-sync-period]() default is 15 seconds
- [horizontal-pod-autoscaler-initial-readiness-delay] default 30 seconds
- [horizontal-pod-autoscaler-cpu-initialization-period] default 5 minutes
- [horizontal-pod-autoscaler-downscale-stabilization] of stabilization window default is 300 seconds
- [Stabilization Window](https://github.com/kubernetes/enhancements/blob/master/keps/sig-autoscaling/853-configurable-hpa-scale-velocity/README.md#stabilization-window)

[Scaling algorithm](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)

- ceil[currentReplicas * (Current / Desired)]

First, setup metrics server which monitor CPU usage

```ts
export class MetricServerStack extends Stack {
  constructor(scope: Construct, id: string, props: MetricServerProps) {
    super(scope, id, props);

    const cluster = props.cluster;

    readYamlFile(path.join(__dirname, "./../yaml/metric_server.yaml"), cluster);
  }
}
```

deploy a HPA

```yaml
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: cdk8s-app-webhorizontalautoscaler-c82a277e
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
    name: cdk8s-app-deployment-c8f953f2
```

For scaling based on custom metrics, there are some methods

- CloudWatch => Adapter => External metrics => HPA
- CloudWatch => Lambda => Update deployment

External metrics example, this CRD resource tells the adapter how to retrieve metric data from CW

```yaml
apiVersion: metrics.aws/v1alpha1
kind: ExternalMetric:
  metadata:
    name: hello-queue-length
  spec:
    name: hello-queue-length
    resource:
      resource: "deployment"
    queries:
      - id: sqs_helloworld
        metricStat:
          metric:
            namespace: "AWS/SQS"
            metricName: "ApproximateNumberOfMessagesVisible"
            dimensions:
              - name: QueueName
                value: "helloworld"
          period: 300
          stat: Average
          unit: Count
        returnData: true
```

HPA based on the custom metric

```yaml
kind: HorizontalPodAutoscaler
apiVersion: autoscaling/v2beta1
metadata:
  name: sqs-consumer-scaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1beta1
    kind: Deployment
    name: sqs-consumer
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: External
      external:
        metricName: hello-queue-length
        targetAverageValue: 30
```

## Cluster AutoScaler

![eks_ca](https://github.com/cdk-entest/eks-cdk-web/assets/20411077/9cdc3601-9393-4a4f-a598-ed87c19f0de2)

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

Install AutoScaler using kubectl

```bash
kubect apply -f yaml/cluster-autoscaler-autodiscover.yaml
```

## Book App Service

It is possible to use a domain registered in another account and create Route53 record in this account.

- Account A: register a domain from Route53
- Account A: create a record in Route53 which route to LB in account B
- Account B: create an ACM certificate and confirming by email
- Account B: create a service.yaml with annotations specifing the certificate

```yaml
apiVersion: v1
kind: Service
metadata:
  name: book-app-service
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-backend-protocol: http
    service.beta.kubernetes.io/aws-load-balancer-ssl-cert: arn:aws:acm:ap-southeast-1:$ACCOUNT_ID:certificate/xxx
    service.beta.kubernetes.io/aws-load-balancer-ssl-ports: https
spec:
  ports:
    - port: 80
      targetPort: 8080
      name: http
    - port: 443
      targetPort: 8080
      name: https
  selector:
    app: book-app
  type: LoadBalancer
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: book-app-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: book-app
  template:
    metadata:
      labels:
        app: book-app
    spec:
      containers:
        - image: $ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/book-app:latest
          name: book-app
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
  name: book-app-hpa
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
    name: book-app-deployment
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

## Load Test

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

- [HPA Introduction](https://aws.amazon.com/blogs/opensource/horizontal-pod-autoscaling-eks/)

- [Kubernetes HPA](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)

- [EKS scale based on CW metrics](https://aws.amazon.com/blogs/compute/scaling-kubernetes-deployments-with-amazon-cloudwatch-metrics/)

- [HPA parameters](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#support-for-custom-metrics)

- [Lambda trigger scale](https://aws.amazon.com/blogs/containers/autoscaling-amazon-eks-services-based-on-custom-prometheus-metrics-using-cloudwatch-container-insights/)

- [ECS custom metrics scale](https://aws.amazon.com/blogs/containers/amazon-elastic-container-service-ecs-auto-scaling-using-custom-metrics/)

- [EKS Fargate scale on custom metrics](https://aws.amazon.com/blogs/containers/autoscaling-eks-on-fargate-with-custom-metrics/)

- [Setup AutoScaler](https://docs.aws.amazon.com/eks/latest/userguide/autoscaling.html)

- [Stabilization Window](https://github.com/kubernetes/enhancements/blob/master/keps/sig-autoscaling/853-configurable-hpa-scale-velocity/README.md#stabilization-window)

- [Scaling algorithm](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)

- [My Note ](https://d2cvlmmg8c0xrp.cloudfront.net/book/amazon_eks_auto_scaling_haimtran.pdf)

- [Node Selector Fluent-bit not in Fargate](https://github.com/aws/amazon-vpc-cni-Kubernetes/blob/master/config/master/aws-Kubernetes-cni-cn.yaml#L100)

- [Fargate Profile CPU and Mem](https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html)

- [AutoScaler reaction time](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#how-can-i-modify-cluster-autoscaler-reaction-time)

- [Service HTTPS](https://repost.aws/knowledge-center/eks-apps-tls-to-activate-https)

- [EKS HTTPS](https://repost.aws/knowledge-center/terminate-https-traffic-eks-acm)
