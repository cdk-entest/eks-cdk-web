import { aws_eks } from "aws-cdk-lib";
import { KubernetesManifest } from "aws-cdk-lib/aws-eks";
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
