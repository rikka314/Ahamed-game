import { readFileSync } from "node:fs";

import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { InMemoryCaseRepository } from "./case-repository.js";

export class FileCaseRepository extends InMemoryCaseRepository {
  constructor(paths: string[]) {
    const cases = paths.map((path) => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      assertCasePackage(parsed);
      return parsed satisfies CasePackage;
    });
    super(cases);
  }
}
