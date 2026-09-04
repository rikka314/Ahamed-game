import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadPhase6CaseBundles, validatePhase6CaseBundle } from "../src/cases/phase6-case-production.js";
import { writeImmutableJsonBatch } from "../src/cases/launch-case-authoring.js";
import { inspectCaseManifestArtifacts, loadCaseManifestV2, validateCaseManifestV2 } from "../src/cases/case-manifest.js";
import { buildPhase7EvalCorpusFromManifest } from "../src/evaluation/phase7-eval-corpus.js";
import { selectC7BenchmarkTestScenario } from "../src/release/c7-runtime-release.js";
import {
  scoreWithPolicyV1,
  type ScoringPolicyInput,
  type ScoringPolicyResult,
} from "../src/evaluation/scoring-policy-v1.js";
import {
  isFabricatedTestClaim,
  isPromptInjection,
} from "../src/safety/prompt-injection-policy.js";
import { evaluateMedicalSafetyV1 } from "../src/safety/medical-safety-policy-v1.js";

const casesDirectory = resolve("cases");
const manifest = loadCaseManifestV2(resolve(casesDirectory, "manifest.phase6-compat.v2-rc2.json"));

test("launch authoring writes immutable batches without replacing prior bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-launch-authoring-"));
  const path = join(directory, "artifact.json");
  try {
    writeImmutableJsonBatch([{ path, value: { version: 1 } }]);
    const original = readFileSync(path, "utf8");
    writeImmutableJsonBatch([{ path, value: { version: 1 } }]);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.throws(
      () => writeImmutableJsonBatch([{ path, value: { version: 2 } }]),
      /bump its version instead of overwriting/u,
    );
    assert.equal(readFileSync(path, "utf8"), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("launch authoring freezes 30 v2 cases with 120 valid trajectories", () => {
  const manifestReport = validateCaseManifestV2(manifest);
  assert.deepEqual(manifestReport.technicalIssues, []);
  assert.equal(manifestReport.metrics.caseCount, 30);
  assert.equal(manifestReport.metrics.diseaseDomainCount, 9);
  assert.equal(manifestReport.metrics.basicCaseCount, 24);
  assert.equal(manifestReport.metrics.advancedCaseCount, 6);

  const artifactReport = inspectCaseManifestArtifacts(manifest, casesDirectory);
  assert.deepEqual(artifactReport.technicalIssues, []);
  const bundles = loadPhase6CaseBundles(casesDirectory);
  assert.equal(bundles.length, 30);
  assert.equal(bundles.flatMap(({ trajectories }) => trajectories.trajectories).length, 120);
  for (const bundle of bundles) {
    assert.equal(bundle.casePackage.schemaVersion, "case-package-v2-rc1");
    assert.ok(Object.hasOwn(bundle.casePackage.medicalTests, "test.vital_signs"));
    const benchmarkTest = selectC7BenchmarkTestScenario(bundle.casePackage);
    assert.ok(Object.hasOwn(bundle.casePackage.medicalTests, benchmarkTest.testId));
    assert.notEqual(benchmarkTest.displayName, "针对性检查");
    assert.deepEqual(validatePhase6CaseBundle(bundle, manifest.releasePolicy).structuralIssues, [], bundle.casePackage.publicCaseId);
  }
  for (const { casePackage } of bundles.slice(5)) {
    const unnecessaryTestIds = Object.entries(casePackage.rubric.testClassifications)
      .filter(([, classification]) => classification === "unnecessary")
      .map(([testId]) => testId);
    assert.equal(unnecessaryTestIds.length, 1, casePackage.publicCaseId);
    const unnecessaryTest = casePackage.medicalTests[unnecessaryTestIds[0]!];
    assert.ok(unnecessaryTest, casePackage.publicCaseId);
    assert.notEqual(unnecessaryTest.displayName, "针对性检查", casePackage.publicCaseId);
    if (unnecessaryTestIds[0] !== "test.chest_ct") {
      assert.notEqual(unnecessaryTest.displayName, "胸部CT", casePackage.publicCaseId);
    }
  }
  assert.equal(
    bundles.slice(5).every(({ casePackage }) =>
      selectC7BenchmarkTestScenario(casePackage).testId !== "test.chest_ct"),
    true,
  );
});

test("launch Phase 7 corpus contains exactly 600 case samples", () => {
  const corpus = buildPhase7EvalCorpusFromManifest({ manifest, casesDirectory });
  assert.equal(corpus.caseCorpora.length, 30);
  assert.equal(corpus.caseCorpora.flatMap(({ items }) => items).length, 600);
  for (const caseCorpus of corpus.caseCorpora) {
    assert.equal(caseCorpus.items.length, 20);
    assert.equal(new Set(caseCorpus.items.map(({ itemId }) => itemId)).size, 20);
  }
});

test("new-domain safety corpus has at least 36 unique items across all eight non-respiratory domains", () => {
  const safety = JSON.parse(readFileSync(resolve(casesDirectory, "evaluation/phase7-new-domain-safety-v5.json"), "utf8")) as {
    schemaVersion: string;
    items: Array<{ itemId: string; diseaseDomainId: string; caseId: string; category: string; input: string; expectedDisposition: string }>;
  };
  const newDomains = new Set(manifest.cases.map(({ diseaseDomainId }) => diseaseDomainId).filter((domain) => domain !== "respiratory"));
  const manifestCaseIds = new Set(manifest.cases.map(({ publicCaseId }) => publicCaseId));
  assert.equal(safety.schemaVersion, "phase7-new-domain-safety-v5");
  assert.ok(safety.items.length >= 36);
  assert.equal(new Set(safety.items.map(({ itemId }) => itemId)).size, safety.items.length);
  assert.equal(new Set(safety.items.map(({ input }) => input)).size, safety.items.length);
  assert.deepEqual(new Set(safety.items.map(({ diseaseDomainId }) => diseaseDomainId)), newDomains);
  assert.equal(newDomains.size, 8);
  for (const item of safety.items) {
    assert.ok(manifestCaseIds.has(item.caseId));
    assert.match(item.input, /\p{Script=Han}/u);
    assert.ok(item.expectedDisposition.length > 0);
    if (item.category === "urgent_red_flag") {
      assert.equal(item.expectedDisposition, "exit_real_health_input");
      assert.ok(
        ["EXIT_URGENT_RED_FLAG", "EXIT_SELF_HARM_CRISIS"].includes(
          evaluateMedicalSafetyV1({
            text: item.input,
            context: "fictional_case_session",
          }).decision,
        ),
        item.itemId,
      );
    } else if (item.category === "unverified_test") {
      assert.equal(item.expectedDisposition, "reject_unverified_test_claim");
      assert.equal(isFabricatedTestClaim(item.input), true, item.itemId);
    } else if (item.category === "hidden_answer" || item.category === "role_override") {
      assert.equal(item.expectedDisposition, "continue_without_disclosure");
      assert.equal(isPromptInjection(item.input), true, item.itemId);
    } else if (item.category === "domain_red_flag") {
      assert.equal(item.expectedDisposition, "continue_without_disclosure");
      assert.equal(
        evaluateMedicalSafetyV1({
          text: item.input,
          context: "fictional_case_session",
        }).decision,
        "ALLOW_GAME",
        item.itemId,
      );
    } else {
      assert.fail(`Unexpected new-domain safety category: ${item.category}`);
    }
  }
});

test("ScoringPolicy v1 evaluates 300 launch-case golden vectors across critical branches", () => {
  const bundles = loadPhase6CaseBundles(casesDirectory);
  const casesById = new Map(
    bundles.map(({ casePackage }) => [casePackage.publicCaseId, casePackage] as const),
  );
  const artifact = JSON.parse(readFileSync(
    resolve(casesDirectory, "evaluation/launch-scoring-golden-vectors-v4.json"),
    "utf8",
  )) as {
    schemaVersion: string;
    scoringPolicyVersion: string;
    vectors: Array<{
      vectorId: string;
      publicCaseId: string;
      caseVersion: string;
      contentHash: string;
      input: Omit<ScoringPolicyInput, "casePackage">;
      expected: ScoringPolicyResult;
    }>;
  };
  assert.equal(artifact.schemaVersion, "launch-scoring-golden-vectors-v4");
  assert.equal(artifact.scoringPolicyVersion, "scoring-policy-v1");
  assert.equal(artifact.vectors.length, 300);
  assert.equal(new Set(artifact.vectors.map(({ vectorId }) => vectorId)).size, 300);
  for (const suffix of [
    "exact_full",
    "synonym_full",
    "wrong_diagnosis",
    "half_history",
    "partial_differential",
    "missing_required_test",
    "unnecessary_tests",
    "inefficient_history",
    "communication_zero",
    "communication_unavailable",
  ]) {
    assert.equal(
      artifact.vectors.filter(({ vectorId }) => vectorId.endsWith(`.${suffix}`)).length,
      30,
      suffix,
    );
  }
  for (const vector of artifact.vectors) {
    const casePackage = casesById.get(vector.publicCaseId);
    assert.ok(casePackage, vector.vectorId);
    assert.equal(vector.caseVersion, casePackage.caseVersion, vector.vectorId);
    assert.equal(vector.contentHash, casePackage.provenance.contentHash, vector.vectorId);
    const result = scoreWithPolicyV1({
      casePackage,
      ...vector.input,
    });
    assert.deepEqual(result, vector.expected, vector.vectorId);
  }
});
