import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { resolveC7PublishedReviewArtifactPath } from
  "../src/release/c7-runtime-manifest-runner.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("C7 runtime manifest runner enforces review sidecar path/hash pairing", () => {
  const casesRoot = mkdtempSync(resolve(tmpdir(), "ahamed-c7-review-binding-"));
  try {
    const relativePath = "published/e2/case-1.ai-review.json";
    const validationPath = resolve(casesRoot, relativePath);
    mkdirSync(resolve(casesRoot, "published/e2"), { recursive: true });
    writeFileSync(validationPath, "review evidence", "utf8");
    const validationSha256 = sha256("review evidence");
    const base = { publicCaseId: "case_1" };

    assert.equal(
      resolveC7PublishedReviewArtifactPath(casesRoot, {
        ...base,
        reviewStatus: "missing",
      }),
      undefined,
    );
    for (const artifact of [
      { ...base, reviewStatus: "missing" as const, validationRecordPath: relativePath },
      { ...base, reviewStatus: "missing" as const, validationSha256 },
    ]) {
      assert.throws(
        () => resolveC7PublishedReviewArtifactPath(casesRoot, artifact),
        /must not bind validation evidence/iu,
      );
    }
    for (const artifact of [
      { ...base, reviewStatus: "approved" as const, validationRecordPath: relativePath },
      { ...base, reviewStatus: "approved" as const, validationSha256 },
    ]) {
      assert.throws(
        () => resolveC7PublishedReviewArtifactPath(casesRoot, artifact),
        /validation evidence is missing/iu,
      );
    }
    assert.equal(
      resolveC7PublishedReviewArtifactPath(casesRoot, {
        ...base,
        reviewStatus: "approved",
        validationRecordPath: relativePath,
        validationSha256,
      }),
      validationPath,
    );
    assert.throws(
      () => resolveC7PublishedReviewArtifactPath(casesRoot, {
        ...base,
        reviewStatus: "approved",
        validationRecordPath: relativePath,
        validationSha256: "0".repeat(64),
      }),
      /hash drifted/iu,
    );
  } finally {
    rmSync(casesRoot, { recursive: true, force: true });
  }
});
