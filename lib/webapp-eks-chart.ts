import { Chart, ChartProps } from "cdk8s";
import { IntOrString, KubeDeployment, KubeService } from "../imports/k8s";
import { Construct } from "constructs";

interface WebAppChartProps extends ChartProps {
  image: string;
}

export class WebAppChart extends Chart {
  constructor(scope: Construct, id: string, props: WebAppChartProps) {
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
                image: props.image,
                ports: [{ containerPort: 8080 }],
              },
            ],
          },
        },
      },
    });
  }
}
