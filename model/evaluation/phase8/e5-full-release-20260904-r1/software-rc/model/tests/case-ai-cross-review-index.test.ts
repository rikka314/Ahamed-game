import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  verifyCaseAiCrossReviewIndex,
  type CaseReviewIndex,
} from "../src/evaluation/case-ai-cross-review-verify.js";
import { sha256Canonical } from "../src/release/phase8-release.js";

const modelRoot = existsSync(resolve(process.cwd(), "cases/manifest.phase6-compat.v2-rc2.json"))
  ? resolve(process.cwd())
  : resolve(process.cwd(), "model");
const sourceEvidenceDirectory = resolve(
  modelRoot,
  "evaluation/phase8/c7-ai-release-20260904-r3",
);

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test(
  "case AI index verifier rejects top-level and transitive evidence tampering",
  { skip: !existsSync(sourceEvidenceDirectory) },
  () => {
    const temporaryRoot = mkdtempSync(join(resolve(modelRoot, "evaluation/phase8"), "case-ai-index-test-"));
    const evidenceDirectory = join(temporaryRoot, "evidence");
    try {
      cpSync(sourceEvidenceDirectory, evidenceDirectory, { recursive: true });
      const indexPath = join(evidenceDirectory, "ai-evidence-index.json");
      const index = JSON.parse(readFileSync(indexPath, "utf8")) as CaseReviewIndex;
      const evidenceRelative = relative(modelRoot, evidenceDirectory).replaceAll("\\", "/");
      index.caseValidations = index.caseValidations.map((binding) => ({
        ...binding,
        path: `${evidenceRelative}/case-validations/${basename(binding.path)}`,
      }));
      index.caseValidationSetSha256 = sha256Canonical(index.caseValidations);
      index.safetyCorpus.path = `${evidenceRelative}/${basename(index.safetyCorpus.path)}`;
      writeJson(indexPath, index);

      assert.equal(
        verifyCaseAiCrossReviewIndex({ modelRoot, indexPath }).status,
        "complete",
      );

      const mutations: Array<{
        mutate: (candidate: CaseReviewIndex) => void;
        pattern: RegExp;
      }> = [
        {
          mutate: (candidate) => {
            (candidate as unknown as Record<string, unknown>)["reviewFindings"] = [{
              code: "CASE_AI_REVIEW_NOT_APPROVED",
              scope: "tampered-case",
              decision: "approved",
            }];
          },
          pattern: /quality findings drifted/u,
        },
        {
          mutate: (candidate) => {
            candidate.releasePolicy.expectedCaseCount += 1;
          },
          pattern: /release policy drifted/u,
        },
        {
          mutate: (candidate) => {
            candidate.publishedArtifacts[0]!.caseSha256 = "0".repeat(64);
          },
          pattern: /published artifact hash drifted/u,
        },
        {
          mutate: (candidate) => {
            candidate.safetyCorpus.totalSamples -= 1;
          },
          pattern: /safety corpus source binding drifted/u,
        },
      ];
      for (const { mutate, pattern } of mutations) {
        const candidate = structuredClone(index);
        mutate(candidate);
        writeJson(indexPath, candidate);
        assert.throws(
          () => verifyCaseAiCrossReviewIndex({ modelRoot, indexPath }),
          pattern,
        );
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);
