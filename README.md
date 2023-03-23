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


## Reference 

[amazon eks cdk](https://aws.amazon.com/blogs/architecture/field-notes-managing-an-amazon-eks-cluster-using-aws-cdk-and-cloud-resource-property-manager/)

