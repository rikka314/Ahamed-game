import assert from "node:assert/strict";
import test from "node:test";

import { PHASE7_EVAL_CORPUS } from "../src/evaluation/phase7-eval-corpus.js";
import {
  runPhase7OfflineEvalHarness,
  validatePhase7EvalCorpus,
} from "../src/evaluation/phase7-eval-harness.js";

test("offline harness validates counts, IDs, case binding, and category coverage", () => {
  const report = validatePhase7EvalCorpus(PHASE7_EVAL_CORPUS);

  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.counts.cases, 30);
  assert.equal(report.counts.caseItems, 600);
  assert.ok(report.counts.safetyItems >= 30);
});

test("offline harness reports each structural defect without executing a provider", () => {
  const corpus = structuredClone(PHASE7_EVAL_CORPUS);
  corpus.caseCorpora[0]!.items.pop();
  corpus.caseCorpora[1]!.items[0]!.itemId = corpus.caseCorpora[0]!.items[0]!.itemId;
  corpus.caseCorpora[2]!.items[0]!.caseId = "wrong_case";
  corpus.caseCorpora[3]!.items = corpus.caseCorpora[3]!.items.filter(
    ({ category }) => category !== "ambiguous",
  );
  corpus.caseCorpora[4]!.items[0]!.expectedFactIds = ["fact.not_allowed"];
  corpus.caseCorpora[4]!.items[1]!.expectedAction = "other";
  corpus.caseCorpora[4]!.items.find(({ category }) => category === "repeat")!
    .expectedFactIds = ["fact.chief_complaint"];

  const report = validatePhase7EvalCorpus(corpus);
  assert.equal(report.valid, false);
  assert.match(report.issues.join("\n"), /exactly 20 items/u);
  assert.match(report.issues.join("\n"), /duplicate itemId/u);
  assert.match(report.issues.join("\n"), /must bind to case/u);
  assert.match(report.issues.join("\n"), /missing category ambiguous/u);
  assert.match(report.issues.join("\n"), /outside askableFactIds/u);
  assert.match(report.issues.join("\n"), /must expect ask_patient/u);
  assert.match(report.issues.join("\n"), /must match repeated item facts/u);
});

test("invalid corpus blockers never expose untrusted hidden fact identifiers", () => {
  const corpus = structuredClone(PHASE7_EVAL_CORPUS);
  corpus.caseCorpora[0]!.items[0]!.expectedFactIds = [
    "fact.super_secret_truth",
  ];

  const report = runPhase7OfflineEvalHarness({
    corpus,
    requireFullCandidateBenchmark: true,
    publishedCases: [],
  });
  assert.equal(report.gate.code, "PHASE7_CORPUS_INVALID");
  assert.equal(report.gate.providerCalls, 0);
  assert.equal(report.gate.blockers.length, 1);
  assert.match(
    report.gate.blockers[0]!,
    /^Phase 7 corpus failed structural validation \(\d+ issues\); inspect local validation details\.$/u,
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /fact\.super_secret_truth|askableFactIds|expectedFactIds/u,
  );
});

test("full candidate benchmark is stably blocked at zero published cases and exposes no hidden truth", () => {
  const first = runPhase7OfflineEvalHarness({
    requireFullCandidateBenchmark: true,
    publishedCases: [],
  });
  const second = runPhase7OfflineEvalHarness({
    requireFullCandidateBenchmark: true,
    publishedCases: [],
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, "blocked");
  assert.equal(first.evidenceStatus, "development_only");
  assert.equal(first.caseStatus, "structurally_ready_draft");
  assert.equal(first.gate.code, "PHASE6_PUBLISHED_CASES_REQUIRED");
  assert.equal(first.gate.publishedCases, 0);
  assert.equal(first.gate.requiredPublishedCases, 30);
  assert.equal(first.gate.releaseValidationMethod, "ai_cross_validation");
  assert.equal(first.gate.providerCalls, 0);
  assert.deepEqual(first.gate.blockers, [
    "完整候选 benchmark 必须精确绑定评估语料的 30 个已发布病例；当前匹配 0 个。",
  ]);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(
    serialized,
    /answerKey|rubric|patientFacts|internalCaseId|targetDiagnosis|acceptedSynonyms|askableFactIds|expectedFactIds/u,
  );
  assert.doesNotMatch(
    serialized,
    /普通感冒|流行性感冒|急性咽炎|急性支气管炎|社区获得性肺炎/u,
  );
});

test("full candidate benchmark rejects thirty unrelated published IDs", () => {
  const report = runPhase7OfflineEvalHarness({
    requireFullCandidateBenchmark: true,
    publishedCases: Array.from({ length: 30 }, (_, index) => ({
      publicCaseId: `unrelated-${index + 1}`,
      caseVersion: "1.0.0",
      contentHash: `sha256:${String(index + 1).padStart(64, "0")}`,
      packageStatus: "published" as const,
      releaseValidationMethod: "ai_cross_validation" as const,
    })),
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.gate.code, "PHASE6_PUBLISHED_CASES_REQUIRED");
  assert.equal(report.gate.publishedCases, 0);
  assert.equal(report.gate.providerCalls, 0);
});

test("full candidate benchmark is ready for the exact AI-validated published cases", () => {
  const report = runPhase7OfflineEvalHarness({
    requireFullCandidateBenchmark: true,
    publishedCases: PHASE7_EVAL_CORPUS.caseCorpora.map(({ caseId, caseVersion, contentHash }) => ({
      publicCaseId: caseId,
      caseVersion,
      contentHash,
      packageStatus: "published" as const,
      releaseValidationMethod: "ai_cross_validation" as const,
    })),
  });

  assert.equal(report.status, "full_candidate_benchmark_ready");
  assert.equal(report.gate.code, "FULL_CANDIDATE_BENCHMARK_READY");
  assert.equal(report.gate.publishedCases, 30);
  assert.equal(report.gate.releaseValidationMethod, "ai_cross_validation");
  assert.deepEqual(report.gate.blockers, []);
  assert.equal(report.gate.providerCalls, 0);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /answerKey|rubric|patientFacts|internalCaseId|targetDiagnosis|acceptedSynonyms|askableFactIds|expectedFactIds/u,
  );
});

test("full candidate benchmark rejects matching IDs with a drifted version or content hash", () => {
  const exactCases = PHASE7_EVAL_CORPUS.caseCorpora.map(
    ({ caseId, caseVersion, contentHash }) => ({
      publicCaseId: caseId,
      caseVersion,
      contentHash,
      packageStatus: "published" as const,
      releaseValidationMethod: "ai_cross_validation" as const,
    }),
  );
  const wrongVersion = structuredClone(exactCases);
  wrongVersion[0]!.caseVersion = "9.9.9";
  const wrongHash = structuredClone(exactCases);
  wrongHash[0]!.contentHash = `sha256:${"f".repeat(64)}`;

  for (const publishedCases of [wrongVersion, wrongHash]) {
    const report = runPhase7OfflineEvalHarness({
      requireFullCandidateBenchmark: true,
      publishedCases,
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.gate.code, "PHASE6_PUBLISHED_CASES_REQUIRED");
    assert.equal(report.gate.publishedCases, 29);
    assert.equal(report.gate.providerCalls, 0);
  }
});

test("offline development summary remains explicit and provider-free", () => {
  const report = runPhase7OfflineEvalHarness();

  assert.equal(report.status, "development_corpus_ready");
  assert.equal(report.mode, "offline_no_provider");
  assert.equal(report.gate.providerCalls, 0);
  assert.equal(report.summary.caseCount, 30);
  assert.equal(report.summary.caseItemCount, 600);
  assert.ok(report.summary.safetyItemCount >= 30);
});
