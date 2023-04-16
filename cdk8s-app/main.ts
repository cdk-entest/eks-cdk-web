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
  image: "700267065772.dkr.ecr.us-east-1.amazonaws.com/flask-web:latest",
});
app.synth();
