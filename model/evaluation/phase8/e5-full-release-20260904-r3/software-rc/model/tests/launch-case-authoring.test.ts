import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadPhase6CaseBundles, validatePhase6CaseBundle } from "../src/cases/phase6-case-production.js";
import {
  buildLaunchCaseTrajectories,
  generateLaunchCaseArtifacts,
  writeImmutableJsonBatch,
} from "../src/cases/launch-case-authoring.js";
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
const manifest = loadCaseManifestV2(resolve(casesDirectory, "manifest.phase6-compat.v2-rc9.json"));

test("launch authoring aligns review-critical facts and regression expectations", () => {
  const generated = generateLaunchCaseArtifacts({ write: false });
  const generatedManifest = generated.manifest as {
    cases: Array<{
      path: string;
      regressionPath: string;
      evaluationCorpusPath: string;
      reviewRecordPath: string;
    }>;
  };
  assert.equal(generated.scoringGoldenVectors.schemaVersion, "launch-scoring-golden-vectors-v11");

  for (const entry of generatedManifest.cases) {
    assert.match(entry.path, /^v2-rc9\//u);
    assert.match(entry.regressionPath, /^regression-v10\//u);
    assert.match(entry.evaluationCorpusPath, /-launch-v9\.json$/u);
    assert.match(entry.reviewRecordPath, /^ai-review-v3-rc9\//u);
  }

  for (const casePackage of generated.cases) {
    const provenanceSourceIds = new Set(
      casePackage.provenance.sources.map(({ sourceId }) => sourceId),
    );
    for (const entry of casePackage.redFlagExclusionMatrix.entries) {
      assert.equal(
        provenanceSourceIds.has(entry.criterionSourceId),
        true,
        `${casePackage.publicCaseId} must bind ${entry.redFlagId} to a provenance source`,
      );
    }
    const matrixFactIds = casePackage.redFlagExclusionMatrix.entries
      .filter(({ applicable }) => applicable)
      .flatMap(({ evidenceFactIds }) => evidenceFactIds);
    assert.equal(
      matrixFactIds.every((factId) => casePackage.rubric.mustAskFactIds.includes(factId)),
      true,
      `${casePackage.publicCaseId} must score every applicable red flag`,
    );

    const trajectories = buildLaunchCaseTrajectories(casePackage);
    const success = trajectories.trajectories.find(({ kind }) => kind === "success");
    assert.ok(success, casePackage.publicCaseId);
    const successFactIds = success.steps.flatMap((step) =>
      step.action === "ask" ? step.expectedFactIds : [],
    );
    const successAskSteps = success.steps.filter((step) => step.action === "ask");
    assert.equal(success.expected.medicalTurns, successAskSteps.length, casePackage.publicCaseId);
    for (const step of successAskSteps) {
      for (const factId of step.expectedFactIds) {
        const patientFact = casePackage.patientFacts[factId];
        assert.ok(patientFact, `${casePackage.publicCaseId} ${factId}`);
        assert.equal(
          patientFact.questionMatchers.some((matcher) => step.input.includes(matcher)),
          true,
          `${casePackage.publicCaseId} success question must explicitly target ${factId}`,
        );
        if (factId === "fact.high_risk_population") {
          for (const matcher of patientFact.questionMatchers) {
            assert.match(step.input, new RegExp(matcher, "u"), casePackage.publicCaseId);
          }
        }
      }
      const implicitlyTriggeredFactIds = casePackage.rubric.mustAskFactIds.filter((factId) =>
        casePackage.patientFacts[factId]!.questionMatchers.some((matcher) => step.input.includes(matcher)),
      );
      assert.deepEqual(
        [...implicitlyTriggeredFactIds].sort(),
        [...step.expectedFactIds].sort(),
        `${casePackage.publicCaseId} success question must not disclose a fact assigned to another step`,
      );
    }
    assert.equal(
      matrixFactIds.every((factId) => successFactIds.includes(factId)),
      true,
      `${casePackage.publicCaseId} success trajectory must exercise every red flag`,
    );

    const unknown = trajectories.trajectories.find(({ kind }) => kind === "unknown");
    assert.ok(unknown, casePackage.publicCaseId);
    const [unknownStep] = unknown.steps;
    assert.equal(unknownStep?.action, "ask", casePackage.publicCaseId);
    if (unknownStep?.action === "ask") {
      assert.equal(unknownStep.expectedFactIds.length, 1, casePackage.publicCaseId);
      if (!unknownStep.expectedFactIds.includes("fact.relevant_exposure")) {
        assert.doesNotMatch(unknownStep.input, /相关接触|诱因|暴露/u, casePackage.publicCaseId);
      }
      if (!unknownStep.expectedFactIds.includes("fact.prior_episode")) {
        assert.doesNotMatch(unknownStep.input, /以前是否发生|既往发作|复发/u, casePackage.publicCaseId);
      }
    }

    const failure = trajectories.trajectories.find(({ kind }) => kind === "failure");
    assert.ok(failure, casePackage.publicCaseId);
    const unnecessaryTestIds = failure.steps.flatMap((step) =>
      step.action === "test" && casePackage.rubric.testClassifications[step.testId] === "unnecessary"
        ? [step.testId]
        : [],
    );
    assert.deepEqual(failure.expected.unnecessaryTestIds, unnecessaryTestIds, casePackage.publicCaseId);
    assert.deepEqual(
      [...unnecessaryTestIds].sort(),
      Object.entries(casePackage.rubric.testClassifications)
        .filter(([, classification]) => classification === "unnecessary")
        .map(([testId]) => testId)
        .sort(),
      `${casePackage.publicCaseId} failure trajectory must cover every unnecessary test classification`,
    );
  }

  const byId = new Map(generated.cases.map((casePackage) => [casePackage.publicCaseId, casePackage]));
  const c03 = byId.get("case_c03_respiratory_003");
  assert.ok(c03);
  for (const factId of ["fact.stridor", "fact.muffled_voice", "fact.trismus", "fact.unilateral_neck_swelling"]) {
    assert.ok(Object.hasOwn(c03.patientFacts, factId), factId);
    assert.ok(c03.rubric.mustAskFactIds.includes(factId), factId);
  }

  const c09 = byId.get("case_c09_cardiometabolic_002");
  assert.equal(c09?.patientFacts["fact.diabetes_type_features"]?.status, "present");
  assert.ok(c09?.rubric.mustAskFactIds.includes("fact.diabetes_type_features"));
  assert.equal(c09?.medicalTests["test.hba1c"], undefined);
  assert.match(c09?.medicalTests["test.diabetes_type_assessment"]?.displayName ?? "", /分型/u);
  assert.match(c09?.medicalTests["test.diabetes_type_assessment"]?.report ?? "", /糖化血红蛋白/u);
  assert.match(c09?.medicalTests["test.diabetes_type_assessment"]?.report ?? "", /C肽|自身抗体/u);

  const c08 = byId.get("case_c08_cardiometabolic_001");
  assert.match(c08?.patientFacts["fact.primary_pattern"]?.value ?? "", /\d{3}\/\d{2}/u);
  assert.match(c08?.patientFacts["fact.secondary_cause_features"]?.value ?? "", /肾脏|内分泌/u);
  assert.match(c08?.patientFacts["fact.bp_raising_medications"]?.value ?? "", /激素|兴奋剂/u);
  assert.match(c08?.medicalTests["test.hypertension_assessment"]?.report ?? "", /动态血压/u);
  assert.match(c08?.medicalTests["test.hypertension_assessment"]?.report ?? "", /肌酐|电解质|尿常规/u);

  const c14 = byId.get("case_c14_digestive_002");
  assert.match(c14?.patientFacts["fact.onset"]?.value ?? "", /六个月|半年/u);
  const c14Dysphagia = c14?.redFlagExclusionMatrix.entries.find(
    ({ redFlagId }) => redFlagId === "redflag.progressive_dysphagia",
  );
  assert.equal(c14Dysphagia?.applicable, true);
  assert.ok(c14?.rubric.mustAskFactIds.includes("fact.progressive_dysphagia"));

  const c23 = byId.get("case_c23_dermatology_001");
  assert.equal(c23?.patientFacts["fact.relevant_exposure"]?.status, "present");
  assert.ok(c23?.rubric.mustAskFactIds.includes("fact.relevant_exposure"));

  const c29 = byId.get("case_c29_mentalhealth_001");
  assert.match(c29?.patientFacts["fact.associated_pattern"]?.value ?? "", /疲劳/u);
  assert.match(c29?.patientFacts["fact.associated_pattern"]?.value ?? "", /注意力/u);

  const c30 = byId.get("case_c30_mentalhealth_002");
  assert.equal(c30?.patientFacts["fact.somatic_expression"]?.status, "present");
  assert.ok(c30?.rubric.mustAskFactIds.includes("fact.somatic_expression"));

  const c06 = byId.get("case_c06_respiratory_006");
  assert.equal(c06?.patientFacts["fact.relevant_exposure"]?.status, "present");
  assert.ok(c06?.rubric.mustAskFactIds.includes("fact.relevant_exposure"));

  const c17 = byId.get("case_c17_urinary_001");
  assert.match(
    c17?.patientFacts["fact.high_risk_population"]?.value ?? "",
    /妊娠|免疫抑制|糖尿病/u,
  );
  assert.doesNotMatch(
    c17?.patientFacts["fact.high_risk_population"]?.value ?? "",
    /孤立肾|泌尿系结构异常/u,
  );
  assert.match(c17?.patientFacts["fact.single_kidney"]?.value ?? "", /孤立肾|泌尿系结构异常/u);

  const c02 = byId.get("case_c02_respiratory_002");
  assert.match(c02?.medicalTests["test.respiratory_virus_panel"]?.report ?? "", /Influenza A/u);

  for (const caseId of ["case_c21_musculoskeletal_002", "case_c22_musculoskeletal_003"] as const) {
    const targetCase = byId.get(caseId);
    assert.ok(targetCase);
    for (const requiredRedFlagId of ["redflag.cauda_equina", "redflag.progressive_neurologic_deficit"]) {
      const matrixEntry: { applicable: boolean; evidenceFactIds: string[] } | undefined = targetCase.redFlagExclusionMatrix.entries.find(
        ({ redFlagId: candidateId }) => candidateId === requiredRedFlagId,
      );
      assert.equal(matrixEntry?.applicable, false, `${caseId} ${requiredRedFlagId}`);
      assert.deepEqual(matrixEntry?.evidenceFactIds, [], `${caseId} ${requiredRedFlagId}`);
    }
  }

  const c22 = byId.get("case_c22_musculoskeletal_003");
  assert.match(c22?.medicalTests["test.joint_assessment"]?.report ?? "", /关节液|结晶/u);

  const c26 = byId.get("case_c26_pediatrics_002");
  const c26Mastoid = c26?.redFlagExclusionMatrix.entries.find(
    ({ redFlagId }) => redFlagId === "redflag.mastoid_swelling",
  );
  assert.equal(c26Mastoid?.applicable, false);
  assert.deepEqual(c26Mastoid?.evidenceFactIds, []);
  assert.equal(Object.hasOwn(c26?.patientFacts ?? {}, "fact.mastoid_swelling"), false);

  const c27 = byId.get("case_c27_gynecology_001");
  assert.doesNotMatch(c27?.medicalTests["test.pelvic_assessment"]?.report ?? "", /妊娠证据/u);

  for (const casePackage of generated.cases.slice(5)) {
    for (const entry of casePackage.redFlagExclusionMatrix.entries) {
      assert.match(entry.canonicalName, /\p{Script=Han}/u, `${casePackage.publicCaseId} ${entry.redFlagId}`);
    }
  }
});

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
  const safety = JSON.parse(readFileSync(resolve(casesDirectory, "evaluation/phase7-new-domain-safety-v11.json"), "utf8")) as {
    schemaVersion: string;
    items: Array<{ itemId: string; diseaseDomainId: string; caseId: string; category: string; input: string; expectedDisposition: string }>;
  };
  const newDomains = new Set(manifest.cases.map(({ diseaseDomainId }) => diseaseDomainId).filter((domain) => domain !== "respiratory"));
  const manifestCaseIds = new Set(manifest.cases.map(({ publicCaseId }) => publicCaseId));
  assert.equal(safety.schemaVersion, "phase7-new-domain-safety-v11");
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
    resolve(casesDirectory, "evaluation/launch-scoring-golden-vectors-v11.json"),
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
  assert.equal(artifact.schemaVersion, "launch-scoring-golden-vectors-v11");
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
