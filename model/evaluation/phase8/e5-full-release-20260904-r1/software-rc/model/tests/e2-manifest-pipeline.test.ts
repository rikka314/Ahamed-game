import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  inspectCaseManifestArtifacts,
  loadCaseManifestV2,
  validateCaseManifestV2,
  type CaseManifestV2,
} from "../src/cases/case-manifest.js";
import {
  loadPhase6CaseBundlesFromManifest,
} from "../src/cases/phase6-case-production.js";
import {
  getRequiredRedFlagIds,
  loadRedFlagPolicyV2,
} from "../src/cases/red-flag-policy.js";

const HASHES = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

function makeManifest(caseCount: number): CaseManifestV2 {
  return {
    manifestVersion: "case-manifest-v2-rc1",
    casePackageSchemaVersion: "case-package-v2-rc1",
    allowedCasePackageSchemaVersions: [
      "case-package-v1-rc1",
      "case-package-v2-rc1",
    ],
    provenanceSchemaVersion: "provenance-record-v2",
    aiReviewSchemaVersion: "ai-case-cross-review-v3",
    reviewPolicy: "non_blocking",
    releasePolicy: {
      policyVersion: "model-release-policy-v1",
      expectedCaseCount: caseCount,
      requiredPersonas: [{
        personaTemplateId: "gentle_cooperative",
        count: caseCount,
        minimumDiseaseDomains: 1,
      }],
      diseaseDomainQuotas: [{
        diseaseDomainId: "respiratory",
        count: caseCount,
      }],
      difficultyQuotas: { basic: caseCount, advanced: 0 },
      minimumRegressionTrajectoriesPerCase: 4,
      minimumRealDialogueTurnsPerCase: 12,
      requiredTestStates: [
        "not_completed",
        "pending_confirmation",
        "completed",
      ],
      qualityThresholds: {
        patientGeneratedReplyRate: 1,
        maximumControllerProviderCalls: 0,
        maximumLocalFakeReplies: 0,
        maximumDiagnosisLeaks: 0,
        maximumUncompletedTestResultLeaks: 0,
        minimumPersonaConsistencyRate: 0.95,
        minimumContextFollowupAccuracy: 0.95,
        minimumTestActionAccuracy: 0.95,
        maximumSeriousFactErrors: 0,
      },
    },
    aiReviewPolicy: {
      schemaVersions: [
        "ai-case-cross-validation-v1",
        "ai-case-cross-review-v3",
      ],
      requiredRoles: ["clinical_safety", "diagnostic_quality"],
      independentInvocation: true,
      counterpartOutputVisible: false,
    },
    reviewSummary: {
      status: "not_run",
      findingsCount: caseCount,
      staleCount: 0,
      notRunCount: caseCount,
    },
    redFlagPolicyVersion: "red-flag-policy-manifest-v2",
    patientPromptVersion: "v0.5.0",
    evaluationPolicyVersion: "scoring-policy-v1",
    contentHashPolicyVersion: "case-content-hash-v2",
    cases: Array.from({ length: caseCount }, (_, index) => ({
      publicCaseId: `case_fixture_${String(index + 1).padStart(2, "0")}`,
      patientRoleId: `patient-role.fixture-${String(index + 1).padStart(2, "0")}`,
      caseVersion: "1.0.0-rc.1",
      casePackageSchemaVersion: "case-package-v2-rc1",
      path: `draft/case-${index + 1}.json`,
      regressionPath: `regression/case-${index + 1}.trajectories.json`,
      evaluationCorpusPath: "evaluation/phase7-respiratory-v1.json",
      contentHash: `sha256:${HASHES}`,
      packageStatus: "draft",
      reviewStatus: "not_run",
      diseaseDomainId: "respiratory",
      difficulty: "basic",
      personaTemplateId: "gentle_cooperative",
    })),
  };
}

test("one-case, five-case, and thirty-case manifests use the same semantic validator", () => {
  for (const caseCount of [1, 5, 30]) {
    const report = validateCaseManifestV2(makeManifest(caseCount), {
      knownRedFlagPolicyVersions: ["red-flag-policy-manifest-v2"],
    });
    assert.deepEqual(report.technicalIssues, [], `${caseCount}-case technical issues`);
    assert.equal(
      report.findings.filter(({ code }) => code === "AI_REVIEW_NOT_RUN").length,
      caseCount,
    );
    assert.equal(
      report.findings.some(({ code }) => code === "REVIEW_SUMMARY_MISMATCH"),
      false,
    );
    assert.equal(report.metrics.caseCount, caseCount);
  }
});

test("manifest dry-run reports identity, quota, and red-flag policy drift as structured findings", () => {
  const manifest = makeManifest(30);
  manifest.cases[1]!.publicCaseId = manifest.cases[0]!.publicCaseId;
  manifest.cases[2]!.patientRoleId = manifest.cases[0]!.patientRoleId;
  manifest.releasePolicy.requiredPersonas[0]!.count = 29;
  manifest.releasePolicy.diseaseDomainQuotas[0]!.count = 29;
  manifest.releasePolicy.difficultyQuotas.basic = 29;

  const report = validateCaseManifestV2(manifest, {
    knownRedFlagPolicyVersions: [],
  });
  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has("DUPLICATE_PUBLIC_CASE_ID"));
  assert.ok(codes.has("DUPLICATE_PATIENT_ROLE_ID"));
  assert.ok(codes.has("PERSONA_QUOTA_MISMATCH"));
  assert.ok(codes.has("DISEASE_DOMAIN_QUOTA_MISMATCH"));
  assert.ok(codes.has("DIFFICULTY_QUOTA_MISMATCH"));
  assert.ok(codes.has("RED_FLAG_POLICY_MISSING"));
  assert.deepEqual(report.technicalIssues, []);
});

test("manifest policy enforces schema allowlists and exact declared quota catalogs", () => {
  const schemaManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc2.json",
  );
  schemaManifest.allowedCasePackageSchemaVersions = ["case-package-v2-rc1"];
  schemaManifest.cases[0]!.casePackageSchemaVersion = "case-package-v1-rc1";
  const schemaReport = validateCaseManifestV2(schemaManifest);
  const schemaCodes = new Set(
    schemaReport.findings.map(
      (finding) => finding.code,
    ),
  );
  assert.ok(schemaCodes.has("CASE_SCHEMA_NOT_ALLOWED"));
  assert.ok(
    schemaReport.technicalIssues.some((issue) =>
      issue.includes("CASE_SCHEMA_NOT_ALLOWED")
    ),
  );

  const manifest = makeManifest(5);
  manifest.releasePolicy.requiredPersonas = [{
    personaTemplateId: "alternate_persona",
    count: 0,
    minimumDiseaseDomains: 1,
  }];
  manifest.releasePolicy.diseaseDomainQuotas = [{
    diseaseDomainId: "alternate_domain",
    count: 0,
  }];

  const codes = new Set(
    validateCaseManifestV2(manifest).findings.map(({ code }) => code),
  );
  assert.ok(codes.has("UNDECLARED_PERSONA"));
  assert.ok(codes.has("UNDECLARED_DISEASE_DOMAIN"));
  assert.ok(codes.has("QUOTA_TOTAL_MISMATCH"));
});

test("thirty-case artifact dry-run reports missing files and hash drift without aborting", () => {
  const manifest = makeManifest(30);
  const root = mkdtempSync(join(tmpdir(), "ahamed-e2-thirty-dry-run-"));
  try {
    const source = loadCaseManifestV2(
      "cases/manifest.phase6-compat.v2-rc2.json",
    ).cases[0]!;
    const target = manifest.cases[0]!;
    target.casePackageSchemaVersion = source.casePackageSchemaVersion;
    target.path = "draft/case-1.json";
    const destination = join(root, target.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join("cases", source.path), destination);

    const report = inspectCaseManifestArtifacts(manifest, root);
    const codes = new Set(report.findings.map(({ code }) => code));
    assert.ok(codes.has("MISSING_CASE_FILE"));
    assert.ok(codes.has("MISSING_REGRESSION_FILE"));
    assert.ok(codes.has("MISSING_EVALUATION_CORPUS_FILE"));
    assert.ok(codes.has("CONTENT_HASH_MISMATCH"));
    assert.ok(report.technicalIssues.some((issue) => issue.includes("MISSING_CASE_FILE")));
    assert.ok(report.technicalIssues.some((issue) => issue.includes("CONTENT_HASH_MISMATCH")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact inspection reports missing files and canonical hash drift without scanning extra drafts", () => {
  const sourceManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc2.json",
  );
  const root = mkdtempSync(join(tmpdir(), "ahamed-e2-manifest-"));
  try {
    const selected = sourceManifest.cases[0]!;
    const manifest = structuredClone(sourceManifest);
    manifest.releasePolicy.expectedCaseCount = 1;
    manifest.releasePolicy.requiredPersonas = [{
      personaTemplateId: selected.personaTemplateId,
      count: 1,
      minimumDiseaseDomains: 1,
    }];
    manifest.releasePolicy.diseaseDomainQuotas = [{
      diseaseDomainId: selected.diseaseDomainId,
      count: 1,
    }];
    manifest.releasePolicy.difficultyQuotas = {
      basic: selected.difficulty === "basic" ? 1 : 0,
      advanced: selected.difficulty === "advanced" ? 1 : 0,
    };
    manifest.reviewSummary = {
      status: selected.reviewStatus,
      findingsCount: 1,
      staleCount: selected.reviewStatus === "stale" ? 1 : 0,
      notRunCount: selected.reviewStatus === "not_run" ? 1 : 0,
    };
    manifest.cases = [selected];

    for (const path of [
      selected.path,
      selected.regressionPath,
      selected.evaluationCorpusPath,
      selected.reviewRecordPath,
    ]) {
      if (path === undefined) continue;
      const destination = join(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join("cases", path), destination);
    }
    mkdirSync(join(root, "draft"), { recursive: true });
    writeFileSync(join(root, "draft", "unlisted-invalid.json"), "not-json", "utf8");

    assert.deepEqual(
      inspectCaseManifestArtifacts(manifest, root).findings,
      [],
    );
    assert.equal(
      loadPhase6CaseBundlesFromManifest({ manifest, casesDirectory: root })
        .bundles.length,
      1,
    );

    rmSync(join(root, selected.regressionPath));
    assert.ok(
      inspectCaseManifestArtifacts(manifest, root).findings.some(
        ({ code }) => code === "MISSING_REGRESSION_FILE",
      ),
    );

    cpSync(join("cases", selected.regressionPath), join(root, selected.regressionPath));
    manifest.cases[0]!.contentHash = `sha256:${"f".repeat(64)}`;
    assert.ok(
      inspectCaseManifestArtifacts(manifest, root).findings.some(
        ({ code }) => code === "CONTENT_HASH_MISMATCH",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact inspection validates review schema, binding, and manifest status", () => {
  const sourceManifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc2.json",
  );
  const root = mkdtempSync(join(tmpdir(), "ahamed-e2-review-binding-"));
  try {
    const selected = structuredClone(sourceManifest.cases[0]!);
    const manifest = structuredClone(sourceManifest);
    manifest.releasePolicy.expectedCaseCount = 1;
    manifest.releasePolicy.requiredPersonas = [{
      personaTemplateId: selected.personaTemplateId,
      count: 1,
      minimumDiseaseDomains: 1,
    }];
    manifest.releasePolicy.diseaseDomainQuotas = [{
      diseaseDomainId: selected.diseaseDomainId,
      count: 1,
    }];
    manifest.releasePolicy.difficultyQuotas = { basic: 1, advanced: 0 };
    manifest.reviewSummary = {
      status: "approved",
      findingsCount: 0,
      staleCount: 0,
      notRunCount: 0,
    };
    selected.reviewStatus = "approved";
    manifest.cases = [selected];
    for (const path of [
      selected.path,
      selected.regressionPath,
      selected.evaluationCorpusPath,
      selected.reviewRecordPath,
    ]) {
      if (path === undefined) continue;
      const destination = join(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join("cases", path), destination);
    }

    const report = inspectCaseManifestArtifacts(manifest, root);
    assert.ok(report.findings.some(({ code }) => code === "REVIEW_BINDING_MISMATCH"));
    assert.ok(report.technicalIssues.some((issue) => issue.includes("REVIEW_BINDING_MISMATCH")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale reviews remain bound to the same case identity", () => {
  const manifest = loadCaseManifestV2(
    "cases/manifest.phase6-compat.v2-rc2.json",
  );
  const firstReviewPath = manifest.cases[0]!.reviewRecordPath;
  const secondReviewPath = manifest.cases[1]!.reviewRecordPath;
  assert.ok(firstReviewPath !== undefined && secondReviewPath !== undefined);
  manifest.cases[0]!.reviewRecordPath = secondReviewPath;
  manifest.cases[1]!.reviewRecordPath = firstReviewPath;

  const report = inspectCaseManifestArtifacts(manifest, resolve("cases"));
  assert.equal(
    report.technicalIssues.filter((issue) =>
      issue.includes("REVIEW_BINDING_MISMATCH")
    ).length,
    2,
  );
});

test("red-flag policy composes common and domain-specific requirements for all launch domains", () => {
  const policy = loadRedFlagPolicyV2();
  assert.equal(policy.policyVersion, "red-flag-policy-manifest-v2");
  assert.equal(policy.domains.length, 9);
  for (const domain of policy.domains) {
    const required = getRequiredRedFlagIds(policy, domain.diseaseDomainId);
    assert.ok(required.length > policy.commonRedFlagIds.length);
    assert.equal(new Set(required).size, required.length);
    for (const common of policy.commonRedFlagIds) assert.ok(required.includes(common));
  }
  assert.throws(
    () => getRequiredRedFlagIds(policy, "unknown-domain"),
    /unknown disease domain/u,
  );
});

test("the committed thirty-case launch manifest is structurally valid and explicitly bound", () => {
  const manifest = JSON.parse(
    readFileSync("cases/manifest.phase6-compat.v2-rc2.json", "utf8"),
  ) as unknown;
  const report = validateCaseManifestV2(manifest, {
    knownRedFlagPolicyVersions: ["red-flag-policy-manifest-v2"],
  });
  assert.deepEqual(report.technicalIssues, []);
  assert.equal(
    report.findings.filter(({ code }) => code === "AI_REVIEW_NOT_RUN").length,
    30,
  );
  assert.equal(
    report.findings.some(({ code }) => code === "REVIEW_SUMMARY_MISMATCH"),
    false,
  );
  assert.equal(report.metrics.caseCount, 30);
});
