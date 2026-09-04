import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCaseReviewEvidence,
  ObservedCaseReviewTransport,
  verifyCaseReviewEvidence,
  type CaseReviewCallAttemptV1,
  type CaseReviewSidecarArtifactV1,
} from "../src/evaluation/case-ai-cross-review-evidence.js";
import { generatePhase8CaseCrossReviewV3 } from "../src/evaluation/phase8-ai-evidence.js";
import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
  OpenAITransportResponse,
} from "../src/providers/openai-model-provider.js";
import { sha256Canonical } from "../src/release/phase8-release.js";
import { createCaseV2Fixture } from "./fixtures/case-v2-fixture.js";

const PASSING_OUTPUT = JSON.stringify({
  decision: "approved",
  checks: {
    clinicalConsistency: "pass",
    diagnosisSolvability: "pass",
    redFlagExclusions: "pass",
    rubricConsistency: "pass",
    regressionCoverage: "pass",
    hiddenTruthSafety: "pass",
  },
  findings: ["审核通过。"],
});

class StubTransport implements OpenAIResponsesTransport {
  readonly protocol = "openai-responses";
  readonly providerName = "openai-compatible.test";
  readonly endpointSha256 = "a".repeat(64);
  readonly requests: OpenAITransportRequest[] = [];

  constructor(
    private readonly failClinical = false,
    private readonly malformedClinical = false,
  ) {}

  async create(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
    this.requests.push(structuredClone(request));
    if (this.failClinical && request.schema.name.includes("clinical_safety")) {
      throw Object.assign(new Error("transient failure"), { code: "OPENAI_TRANSIENT" });
    }
    return {
      status: "completed",
      outputText:
        this.malformedClinical && request.schema.name.includes("clinical_safety")
          ? "{not-json"
          : PASSING_OUTPUT,
      responseId: `response-${this.requests.length}`,
      requestId: `request-${this.requests.length}`,
      modelId: "model-snapshot-1",
    };
  }
}

function draftCase() {
  const value = createCaseV2Fixture();
  value.packageStatus = "draft";
  delete value.releaseReview;
  return value;
}

test("v3 case cross-review makes two blind, non-stored Provider calls", async () => {
  const delegate = new StubTransport();
  const transport = new ObservedCaseReviewTransport(delegate);
  const review = await generatePhase8CaseCrossReviewV3({
    casePackage: draftCase(),
    transport,
    modelId: "configured-model",
    now: () => new Date("2026-09-03T00:00:00.000Z"),
    runId: (role) => `run.${role}.test`,
  });

  assert.equal(review.decision, "approved");
  assert.equal(review.validations.length, 2);
  assert.deepEqual(
    review.validations.map(({ role }) => role),
    ["clinical_safety", "diagnostic_quality"],
  );
  assert.equal(new Set(delegate.requests.map(({ operationId }) => operationId)).size, 2);
  assert.ok(delegate.requests.every(({ store }) => store === false));
  assert.equal(transport.attempts.length, 2);
  assert.ok(transport.attempts.every(({ status }) => status === "completed"));
});

test("v3 case cross-review records failed_to_run and still invokes the isolated counterpart", async () => {
  const delegate = new StubTransport(true);
  const transport = new ObservedCaseReviewTransport(delegate);
  const review = await generatePhase8CaseCrossReviewV3({
    casePackage: draftCase(),
    transport,
    modelId: "configured-model",
  });

  assert.equal(review.decision, "not_run");
  assert.equal(review.validations.length, 2);
  assert.equal(review.validations[0]!.role, "clinical_safety");
  assert.equal(review.validations[0]!.runStatus, "failed_to_run");
  assert.equal(review.validations[0]!.decision, "not_run");
  assert.equal(review.validations[1]!.role, "diagnostic_quality");
  assert.equal(review.validations[1]!.runStatus, "completed");
  assert.equal(review.validations[1]!.decision, "approved");
  assert.deepEqual(review.findings, [
    "transient failure",
    "审核通过。",
    "1 counterpart review call(s) completed but the isolated pair was incomplete.",
  ]);
  assert.equal(delegate.requests.filter(({ schema }) => schema.name.includes("clinical_safety")).length, 2);
  assert.equal(delegate.requests.filter(({ schema }) => schema.name.includes("diagnostic_quality")).length, 1);
});

test("case review evidence classifies malformed completed Provider output as an incomplete failed response", async () => {
  const delegate = new StubTransport(false, true);
  const transport = new ObservedCaseReviewTransport(delegate);
  const review = await generatePhase8CaseCrossReviewV3({
    casePackage: draftCase(),
    transport,
    modelId: "configured-model",
  });
  const root = mkdtempSync(join(tmpdir(), "ahamed-case-review-malformed-"));
  try {
    mkdirSync(join(root, "reviews"));
    const relativePath = "reviews/case.ai-review.json";
    const path = join(root, relativePath);
    const bytes = `${JSON.stringify(review, null, 2)}\n`;
    writeFileSync(path, bytes);
    const casePackage = draftCase();
    const sidecar: CaseReviewSidecarArtifactV1 = {
      publicCaseId: casePackage.publicCaseId,
      caseId: review.caseId,
      caseVersion: review.caseVersion,
      contentHash: review.contentHash,
      path: relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const evidence = buildCaseReviewEvidence({
      expectedCaseCount: 1,
      configuredModelId: "configured-model",
      attempts: transport.attempts,
      sidecars: [sidecar],
      reviews: [review],
    });

    assert.equal(review.decision, "not_run");
    assert.equal(evidence.status, "incomplete");
    assert.equal(evidence.completedCalls, 1);
    assert.equal(evidence.failedOrSkippedCalls, 1);
    const failedAttempt = evidence.attempts.find(({ role }) => role === "clinical_safety");
    assert.equal(failedAttempt?.status, "failed_response");
    assert.equal(failedAttempt?.failureCode, "INVALID_PROVIDER_REVIEW_RESPONSE");
    assert.equal(evidence.actualModelId, "model-snapshot-1");
    assert.deepEqual(verifyCaseReviewEvidence(evidence, root), {
      caseCount: 1,
      completedCalls: 1,
      checkAssertions: 6,
      status: "incomplete",
    });

    const invalidStatus = structuredClone(evidence);
    (invalidStatus.attempts[0] as unknown as { status: string }).status = "unknown";
    invalidStatus.attemptsSha256 = sha256Canonical(invalidStatus.attempts);
    assert.throws(
      () => verifyCaseReviewEvidence(invalidStatus, root),
      /attempt status or response fields/u,
    );

    const failedResponseModelDrift = structuredClone(evidence);
    const failedResponse = failedResponseModelDrift.attempts.find(
      ({ status }) => status === "failed_response",
    )!;
    failedResponse.actualModelId = "model-snapshot-drift";
    failedResponseModelDrift.attemptsSha256 = sha256Canonical(
      failedResponseModelDrift.attempts,
    );
    assert.throws(
      () => verifyCaseReviewEvidence(failedResponseModelDrift, root),
      /actual model (?:ID )?drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function approvedReview() {
  const casePackage = draftCase();
  const checks = {
    clinicalConsistency: "pass" as const,
    diagnosisSolvability: "pass" as const,
    redFlagExclusions: "pass" as const,
    rubricConsistency: "pass" as const,
    regressionCoverage: "pass" as const,
    hiddenTruthSafety: "pass" as const,
  };
  return {
    schemaVersion: "ai-case-cross-review-v3" as const,
    caseId: casePackage.internalCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash: casePackage.provenance.contentHash!,
    decision: "approved" as const,
    validations: (["clinical_safety", "diagnostic_quality"] as const).map((role) => ({
      validatorId: `validator.${role}`,
      role,
      modelId: "model-snapshot-1",
      promptVersion: role === "clinical_safety"
        ? "clinical-safety-case-validation-v2"
        : "diagnostic-quality-case-validation-v2",
      validationRunId: `run.${role}.one`,
      isolation: { independentInvocation: true as const, counterpartOutputVisible: false as const },
      runStatus: "completed" as const,
      decision: "approved" as const,
      validatedAt: "2026-09-03T00:00:00.000Z",
      checks,
      findings: ["审核通过。"],
    })),
    findings: ["审核通过。"],
  };
}

function attempt(
  role: "clinical_safety" | "diagnostic_quality",
): CaseReviewCallAttemptV1 {
  return {
    operationId: `operation.${role}`,
    clientRequestId: `request.${role}`,
    attempt: 1,
    publicCaseId: "case-fixture-public",
    role,
    providerName: "openai-compatible.test",
    configuredModelId: "configured-model",
    actualModelId: "model-snapshot-1",
    promptSha256: "b".repeat(64),
    inputSha256: "c".repeat(64),
    schemaSha256: "d".repeat(64),
    caseContentHash: approvedReview().contentHash,
    store: false,
    status: "completed",
    providerRequestId: `provider.${role}`,
  };
}

test("case review verifier rejects path escape, model drift, duplicate invocation, and hash drift", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-case-review-"));
  try {
    mkdirSync(join(root, "reviews"));
    const review = approvedReview();
    const relativePath = "reviews/case.ai-review.json";
    const path = join(root, relativePath);
    const bytes = `${JSON.stringify(review, null, 2)}\n`;
    writeFileSync(path, bytes);
    const sidecar: CaseReviewSidecarArtifactV1 = {
      publicCaseId: "case-fixture-public",
      caseId: review.caseId,
      caseVersion: review.caseVersion,
      contentHash: review.contentHash,
      path: relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const evidence = buildCaseReviewEvidence({
      expectedCaseCount: 1,
      configuredModelId: "configured-model",
      attempts: [attempt("clinical_safety"), attempt("diagnostic_quality")],
      sidecars: [sidecar],
      reviews: [review],
    });
    assert.deepEqual(verifyCaseReviewEvidence(evidence, root), {
      caseCount: 1,
      completedCalls: 2,
      checkAssertions: 12,
      status: "complete",
    });

    const pathEscape = structuredClone(evidence);
    pathEscape.sidecars[0]!.path = "../outside.json";
    pathEscape.sidecarSetSha256 = sha256Canonical(pathEscape.sidecars);
    assert.throws(() => verifyCaseReviewEvidence(pathEscape, root), /escapes|ENOENT/u);

    const modelDrift = structuredClone(evidence);
    modelDrift.attempts[1]!.actualModelId = "model-snapshot-2";
    modelDrift.attemptsSha256 = sha256Canonical(modelDrift.attempts);
    assert.throws(
      () => verifyCaseReviewEvidence(modelDrift, root),
      /metric drifted: status|model.*drifted/u,
    );

    const duplicate = structuredClone(evidence);
    duplicate.attempts[1]!.operationId = duplicate.attempts[0]!.operationId;
    duplicate.attemptsSha256 = sha256Canonical(duplicate.attempts);
    assert.throws(() => verifyCaseReviewEvidence(duplicate, root), /invocation ID is duplicated/u);

    const bindingDrift = structuredClone(evidence);
    bindingDrift.sidecars[0]!.contentHash = `sha256:${"e".repeat(64)}`;
    bindingDrift.sidecarSetSha256 = sha256Canonical(bindingDrift.sidecars);
    assert.throws(() => verifyCaseReviewEvidence(bindingDrift, root), /contentHash|content hash/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
