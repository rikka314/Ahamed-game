import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectCaseManifestArtifacts,
  validateCaseManifestV2,
  type CaseManifestV2,
} from "./case-manifest.js";

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    throw new Error("manifest path must be relative to model/");
  }
  const path = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, path);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("manifest path must stay inside model/");
  }
  return path;
}

function requestedManifestPath(argv: readonly string[]): string {
  if (argv.length === 0) return "cases/manifest.phase6-compat.v2-rc9.json";
  if (argv.length !== 2 || argv[0] !== "--manifest" || argv[1] === undefined) {
    throw new Error(
      "usage: npm run cases:validate:manifest -- [--manifest <cases/manifest.json>]",
    );
  }
  return argv[1];
}

function main(): void {
  try {
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const path = resolveInsideModel(
      modelRoot,
      requestedManifestPath(process.argv.slice(2)),
    );
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const validation = validateCaseManifestV2(value);
    if (validation.technicalIssues.length > 0) {
      throw new Error(validation.technicalIssues.join("; "));
    }
    const manifest = value as CaseManifestV2;
    const artifactReport = inspectCaseManifestArtifacts(manifest, dirname(path));
    if (artifactReport.technicalIssues.length > 0) {
      throw new Error(artifactReport.technicalIssues.join("; "));
    }
    const findings = [...validation.findings, ...artifactReport.findings];
    process.stdout.write(`${JSON.stringify({
      status: "reported",
      reviewPolicy: manifest.reviewPolicy,
      manifestVersion: manifest.manifestVersion,
      releasePolicyVersion: manifest.releasePolicy.policyVersion,
      manifestPath: relative(modelRoot, path).replaceAll("\\", "/"),
      metrics: validation.metrics,
      reviewSummary: manifest.reviewSummary,
      findings,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`case manifest validation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
