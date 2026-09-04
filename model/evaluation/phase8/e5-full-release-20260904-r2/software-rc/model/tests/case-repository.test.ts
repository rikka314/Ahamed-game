import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryCaseRepository } from "../src/repositories/case-repository.js";
import { FileCaseRepository } from "../src/repositories/file-case-repository.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

test("in-memory case repository retains immutable historical versions and selects the last input as current", () => {
  const version1 = createCaseFixture();
  const version2 = structuredClone(version1);
  version2.caseVersion = "2.0.0";
  version2.playerVisible.chiefComplaint = "Updated chief complaint";
  version2.redFlagExclusionMatrix.caseVersion = "2.0.0";

  const repository = new InMemoryCaseRepository([version1, version2]);

  assert.equal(repository.findByPublicId(version1.publicCaseId)?.caseVersion, "2.0.0");
  assert.equal(
    repository.findByPublicIdAndVersion(version1.publicCaseId, "1.0.0")
      ?.playerVisible.chiefComplaint,
    version1.playerVisible.chiefComplaint,
  );
  assert.equal(
    repository.findByPublicIdAndVersion(version1.publicCaseId, "2.0.0")
      ?.playerVisible.chiefComplaint,
    "Updated chief complaint",
  );
});

test("in-memory case repository returns defensive clones for current and historical lookups", () => {
  const version1 = createCaseFixture();
  const version2 = structuredClone(version1);
  version2.caseVersion = "2.0.0";
  version2.redFlagExclusionMatrix.caseVersion = "2.0.0";
  const repository = new InMemoryCaseRepository([version1, version2]);

  const current = repository.findByPublicId(version1.publicCaseId);
  const historical = repository.findByPublicIdAndVersion(
    version1.publicCaseId,
    version1.caseVersion,
  );
  assert.ok(current);
  assert.ok(historical);
  current.playerVisible.chiefComplaint = "mutated current";
  historical.playerVisible.chiefComplaint = "mutated historical";

  assert.notEqual(
    repository.findByPublicId(version1.publicCaseId)?.playerVisible.chiefComplaint,
    "mutated current",
  );
  assert.notEqual(
    repository.findByPublicIdAndVersion(version1.publicCaseId, version1.caseVersion)
      ?.playerVisible.chiefComplaint,
    "mutated historical",
  );
});

test("file case repository rejects published content that no longer matches its AI-validated hash", () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-case-repository-"));
  const path = join(directory, "tampered-published-case.json");
  const published = JSON.parse(
    readFileSync(
      "cases/published/case_c01_respiratory_001--1.0.0-draft.1.json",
      "utf8",
    ),
  ) as ReturnType<typeof createCaseFixture>;
  published.playerVisible.chiefComplaint = "篡改后的主诉";
  writeFileSync(path, `${JSON.stringify(published, null, 2)}\n`, "utf8");

  try {
    assert.throws(
      () => new FileCaseRepository([path]),
      /content hash does not match AI-validated published content/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
