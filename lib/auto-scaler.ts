import { aws_eks, aws_iam as iam } from "aws-cdk-lib";
import { aws_eks as eks } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Tag } from "aws-cdk-lib";
import { readYamlFile, readYamlFromDir } from "../utils/read_yaml";
import * as path from "path";

/**
 * The properties for the Cluster Autoscaler.
 */
export interface ClusterAutoscalerProps {
  /**
   * The EKS cluster to deploy the cluster autoscaler to.
   *
   * @default none
   */
  cluster: eks.Cluster;

  /**
   * An array of Autoscaling Groups, known as node groups, to configure for autoscaling.
   *
   * @default none
   */
  // nodeGroups: Array<autoscaling.AutoScalingGroup>;

  nodeGroups: Array<aws_eks.Nodegroup>;

  /**
   * The version of the Cluster Autoscaler to deploy.
   *
   * @default v1.14.6
   */
  version?: String;
}

/**
 * The Cluster Autoscaler Construct. This will create a new IAM Policy, add labels to the ASGs, and
 * deploy the Cluster Autoscaler manifest.
 */
export class ClusterAutoscaler extends Construct {
  /**
   *  The IAM policy created by this construct.
   */
  public readonly policy: iam.Policy;

  /**
   * The Kubernetes Resource that defines the Cluster Autoscaler K8s resources.
   */
  public readonly clusterAutoscaler: eks.KubernetesManifest;

  /**
   * Constructs a new instance of the Cluster Autoscaler.
   *
   * @param scope Construct
   * @param id string
   * @param props ClusterAutoscalerProps
   */
  constructor(scope: Construct, id: string, props: ClusterAutoscalerProps) {
    super(scope, id);

    const cluster = props.cluster;

    // define the cluster autoscaler policy statements
    // https://docs.aws.amazon.com/en_pv/eks/latest/userguide/cluster-autoscaler.html#ca-create-ngs
    const policyStatement = new iam.PolicyStatement();
    policyStatement.addResources("*");
    policyStatement.addActions(
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeTags",
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup",
      "ec2:DescribeLaunchTemplateVersions"
    );

    // create the policy based on the statements
    const policy = new iam.Policy(this, "cluster-autoscaler-policy", {
      policyName: "ClusterAutoscalerPolicy",
      statements: [policyStatement],
    });

    // loop through all of the node groups and attach the policy
    props.nodeGroups.forEach((element) => {
      new Tag(
        "k8s.io/cluster-autoscaler/" + props.cluster.clusterName,
        "owned",
        { applyToLaunchedInstances: true }
      );

      new Tag("k8s.io/cluster-autoscaler/enabled", "true", {
        applyToLaunchedInstances: true,
      });
      policy.attachToRole(element.role);
    });

    //
    readYamlFile(
      path.join(__dirname, "./../yaml/cluster-autoscaler-autodiscover.yaml"),
      cluster
    );
  }
}
