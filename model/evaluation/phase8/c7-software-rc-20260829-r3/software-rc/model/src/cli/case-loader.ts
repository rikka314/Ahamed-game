import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertCasePackage,
  type CasePackage,
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

export const DIALOGUE_CANDIDATE_CASE_PATHS = [
  "cases/draft/c01-common-cold-v1.json",
  "cases/draft/c02-influenza-v1.json",
  "cases/draft/c03-acute-pharyngitis-v1.json",
  "cases/draft/c04-acute-bronchitis-v1.json",
  "cases/draft/c05-mild-cap-v1.json",
] as const;

export function loadDialogueCandidateCasePackages(
  modelRoot: string,
): CasePackage[] {
  return loadCasePackages(
    DIALOGUE_CANDIDATE_CASE_PATHS.map((path) => resolve(modelRoot, path)),
  );
}
