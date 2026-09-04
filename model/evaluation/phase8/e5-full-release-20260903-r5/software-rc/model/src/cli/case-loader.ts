import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  assertCasePackage,
  type CasePackage,
  assertSupportedCasePackage,
  type SupportedCasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";

export function loadCasePackages(paths: readonly string[]): CasePackage[] {
  if (paths.length === 0) throw new Error("At least one case path is required.");
  return paths.map((path) => {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    assertCasePackageJsonSchema(parsed);
    assertCasePackage(parsed);
    return parsed;
  });
}

export function loadSupportedCasePackages(
  paths: readonly string[],
): SupportedCasePackage[] {
  if (paths.length === 0) throw new Error("At least one case path is required.");
  return paths.map((path) => {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    assertCasePackageJsonSchema(parsed);
    assertSupportedCasePackage(parsed);
    return parsed;
  });
}

export const DIALOGUE_RELEASE_MANIFEST_PATH =
  "cases/manifest.dialogue-rc.v1-rc1.json";

interface DialogueReleaseManifest {
  publishedCases: Array<{
    publicCaseId: string;
    caseVersion: string;
    contentHash: string;
    path: string;
  }>;
}

export function loadDialogueCandidateCasePackages(
  modelRoot: string,
): CasePackage[] {
  const casesRoot = resolve(modelRoot, "cases");
  const manifest = JSON.parse(
    readFileSync(resolve(modelRoot, DIALOGUE_RELEASE_MANIFEST_PATH), "utf8"),
  ) as DialogueReleaseManifest;
  if (
    !Array.isArray(manifest.publishedCases) ||
    manifest.publishedCases.length !== 5 ||
    new Set(manifest.publishedCases.map(({ publicCaseId }) => publicCaseId)).size !== 5
  ) {
    throw new Error("Dialogue release manifest must contain exactly five unique published cases.");
  }
  const paths = manifest.publishedCases.map(({ path }) => {
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      !path.startsWith("published/") ||
      path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      throw new Error(`Unsafe dialogue release case path: ${path}`);
    }
    const resolvedPath = resolve(casesRoot, path);
    const relativePath = relative(casesRoot, resolvedPath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      throw new Error(`Dialogue release case escaped cases/: ${path}`);
    }
    return resolvedPath;
  });
  const packages = loadCasePackages(paths);
  packages.forEach((casePackage, index) => {
    const binding = manifest.publishedCases[index]!;
    if (
      casePackage.packageStatus !== "published" ||
      casePackage.publicCaseId !== binding.publicCaseId ||
      casePackage.caseVersion !== binding.caseVersion ||
      casePackage.provenance.contentHash !== binding.contentHash
    ) {
      throw new Error(`Dialogue release case binding drifted: ${binding.publicCaseId}`);
    }
  });
  return packages;
}
