import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyRuntimeReleaseManifest,
  type RuntimeReleaseManifestV1,
} from "./phase8-release.js";

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    isAbsolute(requestedPath) ||
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("manifest 路径必须是 model/ 内的相对路径。");
  }
  return resolvedPath;
}

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--manifest" || argv[1] === undefined) {
      throw new Error("用法：npm run phase8:verify -- --manifest <runtime-release-manifest.json>");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const manifestPath = resolveInsideModel(modelRoot, argv[1]);
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as RuntimeReleaseManifestV1;
    const artifactRoot = manifest.artifactRoot === "game"
      ? resolve(modelRoot, "..")
      : modelRoot;
    const result = verifyRuntimeReleaseManifest(manifest, artifactRoot);
    process.stdout.write(`${JSON.stringify({
      status: "RUNTIME_RELEASE_MANIFEST_VERIFIED",
      manifestSha256: manifest.manifestSha256,
      ...result,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知清单验证错误。";
    process.stderr.write(`Phase 8 清单验证失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
