import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  LaunchContentPolicyValidationError,
  assertLaunchContentPolicy,
  createLaunchContentPolicyQualityRecord,
  loadLaunchContentPolicy,
  validateLaunchContentPolicy,
} from "../src/cases/launch-content-policy.js";

test("E0 launch policy freezes the 30-case matrix and all target quotas", () => {
  const policy = loadLaunchContentPolicy();
  const result = validateLaunchContentPolicy(policy);

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.metrics, {
    totalCases: 30,
    migratedCases: 5,
    newCases: 25,
    basicCases: 24,
    advancedCases: 6,
    diseaseDomains: 9,
    personas: 6,
    uniquePublicCaseIds: 30,
    uniquePatientRoleIds: 30,
  });
  assert.deepEqual(
    Object.fromEntries(
      policy.diseaseDomains.map(({ domainId, quota }) => [domainId, quota]),
    ),
    {
      respiratory: 7,
      cardiometabolic: 5,
      digestive: 4,
      urinary_renal: 3,
      musculoskeletal: 3,
      dermatology: 2,
      pediatrics: 2,
      gynecology: 2,
      mental_health: 2,
    },
  );
});

test("E0 policy quality record is reproducible and keeps AI review non-blocking", () => {
  const policy = loadLaunchContentPolicy();
  const persisted = JSON.parse(
    readFileSync(
      "cases/policy/launch-content-policy-e0-quality-record.v1.json",
      "utf8",
    ),
  ) as { recordedAt: string };
  const computed = createLaunchContentPolicyQualityRecord(
    policy,
    persisted.recordedAt,
  );

  assert.deepEqual(computed, persisted);
  assert.equal(computed.technicalStatus, "passed");
  assert.equal(computed.aiReview.reviewPolicy, "non_blocking");
  assert.equal(computed.aiReview.status, "not_run");
  assert.ok(computed.checks.every(({ status }) => status === "pass"));
  assert.equal(computed.supersededEvidence.status, "superseded");
});

test("E0 policy rejects schema drift and unknown top-level fields", () => {
  const policy = loadLaunchContentPolicy() as unknown as Record<string, unknown>;
  policy["schemaVersion"] = "launch-content-policy-v999";
  policy["unexpected"] = true;

  assert.throws(
    () => assertLaunchContentPolicy(policy),
    (error: unknown) =>
      error instanceof LaunchContentPolicyValidationError &&
      error.issues.some((issue) => issue.includes("value does not match const")) &&
      error.issues.some((issue) => issue.includes("additional property not allowed")),
  );
});

test("E0 semantic validation detects duplicate IDs, quota drift, and unsafe scope", () => {
  const policy = structuredClone(loadLaunchContentPolicy());
  policy.cases[1]!.publicCaseId = policy.cases[0]!.publicCaseId;
  policy.cases[2]!.patientRoleId = policy.cases[0]!.patientRoleId;
  policy.cases[3]!.difficulty = "advanced";
  policy.cases[4]!.launchSafetyClass = "excluded_high_risk";
  policy.cases[5]!.personaTemplateId = "gentle_cooperative";
  policy.diseaseDomains[0]!.quota = 6;
  policy.diseaseDomains[1]!.newCaseQuota = 4;

  const result = validateLaunchContentPolicy(policy);

  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /publicCaseId .* duplicated/u);
  assert.match(result.issues.join("\n"), /patientRoleId .* duplicated/u);
  assert.match(result.issues.join("\n"), /difficulty quota basic=24, advanced=6/u);
  assert.match(result.issues.join("\n"), /excluded high-risk launch scope/u);
  assert.match(result.issues.join("\n"), /persona gentle_cooperative quota/u);
  assert.match(result.issues.join("\n"), /domain respiratory quota/u);
  assert.match(result.issues.join("\n"), /domain cardiometabolic new-case quota/u);
});

test("E0 semantic validation enforces persona domain spread and fixed migration batches", () => {
  const policy = structuredClone(loadLaunchContentPolicy());
  for (const item of policy.cases) {
    if (item.personaTemplateId === "gentle_cooperative") {
      item.diseaseDomainId = "respiratory";
    }
  }
  policy.cases[0]!.productionBatch = "B1";
  policy.cases[0]!.origin = "new";

  const result = validateLaunchContentPolicy(policy);

  assert.equal(result.valid, false);
  assert.match(
    result.issues.join("\n"),
    /persona gentle_cooperative must span at least 3 disease domains/u,
  );
  assert.match(result.issues.join("\n"), /C01-C05 must be migrated in M0/u);
  assert.match(result.issues.join("\n"), /migrated case quota must equal 5/u);
});

test("E0 semantic validation rejects ambiguous policy catalogs and reviewer roles", () => {
  const policy = structuredClone(loadLaunchContentPolicy());
  policy.diseaseDomains[1]!.domainId = policy.diseaseDomains[0]!.domainId;
  policy.personas[1]!.personaTemplateId =
    policy.personas[0]!.personaTemplateId;
  policy.productionBatches[1]!.batchId = policy.productionBatches[0]!.batchId;
  policy.launchExclusions[1]!.exclusionId =
    policy.launchExclusions[0]!.exclusionId;
  policy.sourceLicensePolicy.decisionRules[1]!.sourceKind =
    policy.sourceLicensePolicy.decisionRules[0]!.sourceKind;
  policy.sourceLicensePolicy.reviewers[1]!.role = "source_provenance";
  policy.supersededEvidence.artifacts[1]!.artifactId =
    policy.supersededEvidence.artifacts[0]!.artifactId;

  const result = validateLaunchContentPolicy(policy);

  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /disease domain .* duplicated/u);
  assert.match(result.issues.join("\n"), /persona policy .* duplicated/u);
  assert.match(result.issues.join("\n"), /production batch .* duplicated/u);
  assert.match(result.issues.join("\n"), /launch exclusion .* duplicated/u);
  assert.match(result.issues.join("\n"), /source decision rule .* duplicated/u);
  assert.match(
    result.issues.join("\n"),
    /source reviewers must contain both isolated roles/u,
  );
  assert.match(result.issues.join("\n"), /superseded artifact .* duplicated/u);
});

test("E0 source, version, and supersession policies remain explicit", () => {
  const policy = loadLaunchContentPolicy();

  assert.deepEqual(policy.versionPolicy.migratedCaseVersion, {
    candidate: "1.1.0-rc.1",
    final: "1.1.0",
  });
  assert.deepEqual(policy.versionPolicy.newCaseVersion, {
    candidate: "1.0.0-rc.1",
    final: "1.0.0",
  });
  assert.equal(policy.versionPolicy.patientPromptVersion, "v0.5.0");
  assert.equal(policy.versionPolicy.contentHashPolicyVersion, "case-content-hash-v2");
  assert.equal(policy.sourceLicensePolicy.unresolvedSource.disposition, "record_high_risk_and_continue");
  assert.equal(policy.sourceLicensePolicy.unresolvedSource.allowVerbatimReuse, false);
  assert.ok(policy.sourceLicensePolicy.prohibitedSourceKinds.length >= 6);
  assert.equal(policy.supersededEvidence.status, "superseded");
  assert.ok(policy.supersededEvidence.artifacts.length >= 5);

  const policyDirectory = resolve("cases/policy");
  const supersessionPath = resolve(
    policyDirectory,
    policy.supersededEvidence.recordPath,
  );
  assert.equal(existsSync(supersessionPath), true);
  const supersession = JSON.parse(readFileSync(supersessionPath, "utf8")) as {
    status: string;
    boundArtifacts: Array<{
      artifactId: string;
      path: string;
      sha256: string;
      status: string;
    }>;
  };
  assert.equal(supersession.status, "superseded");
  assert.deepEqual(
    new Set(supersession.boundArtifacts.map(({ artifactId }) => artifactId)),
    new Set(
      policy.supersededEvidence.artifacts.map(({ artifactId }) => artifactId),
    ),
  );
  for (const artifact of supersession.boundArtifacts) {
    const artifactPath = resolve(dirname(supersessionPath), artifact.path);
    assert.equal(existsSync(artifactPath), true, artifact.artifactId);
    assert.equal(artifact.status, "superseded");
    assert.equal(
      createHash("sha256").update(readFileSync(artifactPath)).digest("hex"),
      artifact.sha256,
      artifact.artifactId,
    );
  }
});
