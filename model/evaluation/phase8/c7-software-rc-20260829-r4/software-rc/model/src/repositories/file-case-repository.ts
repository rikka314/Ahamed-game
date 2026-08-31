import { readFileSync } from "node:fs";

import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import { InMemoryCaseRepository } from "./case-repository.js";

export class FileCaseRepository extends InMemoryCaseRepository {
  constructor(paths: string[]) {
    const cases = paths.map((path) => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      assertCasePackageJsonSchema(parsed);
      assertCasePackage(parsed);
      if (
        parsed.packageStatus === "published" &&
        parsed.provenance.contentHash !== computeCaseContentHash(parsed)
      ) {
        throw new Error(
          "published case content hash does not match AI-validated published content",
        );
      }
      return parsed satisfies CasePackage;
    });
    super(cases);
  }
}
