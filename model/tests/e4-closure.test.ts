import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import type { CasePackageV2 } from "../src/domain/case-package.js";
import { computeCaseContentHash } from "../src/domain/case-content-hash.js";
import type { OpenAIResponsesTransport, OpenAITransportRequest } from "../src/providers/openai-model-provider.js";
import {
  buildE4CrossLayerJourney,
  buildE4EvidenceIndex,
  buildE4GameSourceSnapshot,
  buildE4RuntimeSurfaceScan,
  canonicalJson,
  E4_PATIENT_ACTOR_SLOTS,
  sha256E4Canonical,
} from "../src/evaluation/e4-cross-layer-evidence.js";
import { runE4IndependentAiReview, type E4ReviewerId } from "../src/evaluation/e4-independent-ai-review.js";
import {
  buildE4ClosureReviewTarget,
  buildE4PatientIdentityClosure,
  verifyE4JourneyIdentityBindings,
} from "../src/release/e4-closure.js";
import { createCaseV2Fixture } from "./fixtures/case-v2-fixture.js";

const HASH = "a".repeat(64);
const SCANNER_IMPLEMENTATION = {
  path: "game/tests/e2e/e4-patient-identity-closure.spec.ts",
  sha256: HASH,
  bytes: 1,
} as const;

function runtimeSubject() {
  const files = [{
    path: "game/app/page.tsx",
    sha256: HASH,
    bytes: 1,
  }];
  const artifacts = [{
    path: "/",
    status: 200,
    contentType: "text/html; charset=utf-8",
    sha256: HASH,
    bytes: 1,
  }];
  return {
    gameSource: {
      schemaVersion: "e4-game-source-snapshot-v1" as const,
      files,
      sourceTreeSha256: sha256E4Canonical(files),
    },
    browserRuntime: {
      schemaVersion: "e4-browser-runtime-snapshot-v1" as const,
      browserName: "chromium" as const,
      freshWebServerRequired: true as const,
      pagePath: "/",
      artifacts,
      artifactSetSha256: sha256E4Canonical(artifacts),
    },
  };
}

function launchCases(): CasePackageV2[] {
  return Array.from({ length: 30 }, (_, index) => {
    const code = String(index + 1).padStart(2, "0");
    const value = createCaseV2Fixture();
    value.internalCaseId = `internal_e4_${code}`;
    value.publicCaseId = `case_e4_${code}`;
    value.caseVersion = "2.0.0-rc.1";
    value.patientIdentity.patientRoleId = `patient-role.public-c${code}`;
    value.redFlagExclusionMatrix.caseId = value.internalCaseId;
    value.redFlagExclusionMatrix.caseVersion = value.caseVersion;
    value.provenance.contentHash = computeCaseContentHash(value);
    if (value.releaseReview !== undefined) {
      value.releaseReview.caseId = value.internalCaseId;
      value.releaseReview.caseVersion = value.caseVersion;
      value.releaseReview.contentHash = value.provenance.contentHash;
    }
    return value;
  });
}

function runtimeObservations() {
  return [
    { surface: "console", availability: "observed", serializedValues: ["clinic loaded"] },
    { surface: "indexedDB", availability: "observed", serializedValues: [] },
    { surface: "localStorage", availability: "observed", serializedValues: [] },
    { surface: "sessionStorage", availability: "observed", serializedValues: [] },
    { surface: "cacheStorage", availability: "not_available", serializedValues: [], reason: "not implemented by fixture browser" },
    { surface: "saveExport", availability: "not_available", serializedValues: [], reason: "game has no save export yet" },
  ] as const;
}

function runtimeScan() {
  return buildE4RuntimeSurfaceScan({
    generatedAt: "2026-09-03T00:00:00.000Z",
    scannerImplementation: SCANNER_IMPLEMENTATION,
    subject: runtimeSubject(),
    observations: runtimeObservations(),
  });
}

function fakeTransport(role: E4ReviewerId): OpenAIResponsesTransport {
  return {
    providerName: "openai-compatible.fixture",
    protocol: "openai-responses",
    endpointSha256: HASH,
    async create(request: OpenAITransportRequest) {
      const required = role === "contract_projection_reviewer"
        ? ["share_only_projection", "thirty_unique_patient_roles", "fifteen_two_patient_shifts", "session_turn_identity_binding"]
        : ["public_artifact_allowlist", "browser_storage_surfaces", "console_and_cache_surfaces", "private_evidence_separation"];
      assert.equal(request.role, "review");
      return {
        status: "completed",
        outputText: JSON.stringify({ decision: "passed", assessedControls: required, findings: [] }),
        responseId: `response.${role}`,
        modelId: "review-model",
      };
    },
  };
}

describe("E4 cross-layer closure evidence", () => {
  it("does not treat an honestly unavailable save/export surface as an automatic leakage failure", async () => {
    let capturedInstructions = "";
    const review = await runE4IndependentAiReview({
      reviewerId: "hidden_data_leakage_reviewer",
      reviewTarget: { runtimeSurfaceScan: runtimeScan() },
      transport: {
        ...fakeTransport("hidden_data_leakage_reviewer"),
        async create(request) {
          capturedInstructions = request.instructions;
          return await fakeTransport("hidden_data_leakage_reviewer").create(request);
        },
      },
      modelId: "review-model",
      invocationId: "invocation.hidden-data.unavailable-save",
    });

    assert.equal(review.promptVersion, "e4-hidden-data-leakage-review-v3");
    assert.match(capturedInstructions, /not_available.*不应自动判定为 failed/iu);
    assert.match(capturedInstructions, /仅在.*敏感数据泄漏.*scan_failed.*错误声称已扫描/iu);
  });

  it("changes the game source subject when an application file changes", () => {
    const root = mkdtempSync(resolve(tmpdir(), "ahamed-e4-source-"));
    try {
      for (const directory of ["app", "assets", "components", "public", "scripts", "src", "tests"]) {
        mkdirSync(resolve(root, directory));
        writeFileSync(resolve(root, directory, "fixture.txt"), directory);
      }
      for (const file of [
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "playwright.config.ts",
        "tsconfig.json",
        "eslint.config.mjs",
        "vitest.config.ts",
        "next-env.d.ts",
        ".npmrc",
      ]) writeFileSync(resolve(root, file), file);
      const before = buildE4GameSourceSnapshot(root);
      writeFileSync(resolve(root, "next-env.d.ts"), "generated by a different Next.js command");
      const afterGeneratedTypeChange = buildE4GameSourceSnapshot(root);
      assert.equal(before.sourceTreeSha256, afterGeneratedTypeChange.sourceTreeSha256);
      writeFileSync(resolve(root, "app", "fixture.txt"), "changed application source");
      const after = buildE4GameSourceSnapshot(root);
      assert.notEqual(before.sourceTreeSha256, after.sourceTreeSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs 30 ModelService create/ask journeys in the real two-slot mapping", async () => {
    const cases = launchCases();
    const result = await buildE4CrossLayerJourney({
      cases,
      manifestPath: "cases/final.json",
      manifestSha256: HASH,
      generatedAt: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(result.publicEvidence.metrics.caseCount, 30);
    assert.equal(result.publicEvidence.shifts.length, 15);
    assert.deepEqual(
      result.publicEvidence.shifts[0]?.cases.map(({ actorSlotId }) => actorSlotId),
      E4_PATIENT_ACTOR_SLOTS,
    );
    assert.equal(new Set(result.publicEvidence.shifts.flatMap(({ cases }) => cases.map(({ summary }) => summary.patientRoleId))).size, 30);
    assert.doesNotMatch(JSON.stringify(result.publicEvidence), /answerKey|patientFacts|personaTemplateId|rubric/u);
    assert.equal(result.privateEvidence.operations.length, 30);
    const expectedCases = cases.map((casePackage) => ({
      internalCaseId: casePackage.internalCaseId,
      publicCaseId: casePackage.publicCaseId,
      caseVersion: casePackage.caseVersion,
      contentHash: casePackage.provenance.contentHash!,
      patientRoleId: casePackage.patientIdentity.patientRoleId,
    }));
    assert.doesNotThrow(() => verifyE4JourneyIdentityBindings({
      expectedCases,
      publicJourney: result.publicEvidence,
      privateJourney: result.privateEvidence,
    }));
    const privateTamper = structuredClone(result.privateEvidence);
    privateTamper.operations[0]!.publicCaseId = "case_e4_tampered";
    assert.throws(
      () => verifyE4JourneyIdentityBindings({
        expectedCases,
        publicJourney: result.publicEvidence,
        privateJourney: privateTamper,
      }),
      /binding drifted/u,
    );
    const publicTamper = structuredClone(result.publicEvidence);
    (publicTamper.shifts[0]!.cases[0].summary as unknown as {
      patientRoleId: string;
    }).patientRoleId = "patient-role.tampered";
    assert.throws(
      () => verifyE4JourneyIdentityBindings({
        expectedCases,
        publicJourney: publicTamper,
        privateJourney: result.privateEvidence,
      }),
      /binding drifted/u,
    );
  });

  it("passes unavailable surfaces truthfully and fails on a sensitive runtime value", () => {
    const clean = runtimeScan();
    assert.equal(clean.status, "pass");
    assert.equal(clean.metrics.unavailableSurfaces, 2);
    assert.doesNotMatch(JSON.stringify(clean), /clinic loaded/u);
    assert.ok(clean.observations.every((observation) => !("serializedValues" in observation)));
    const dirty = buildE4RuntimeSurfaceScan({
      scannerImplementation: SCANNER_IMPLEMENTATION,
      subject: runtimeSubject(),
      observations: runtimeObservations().map((observation) =>
        observation.surface === "localStorage"
          ? { ...observation, serializedValues: ["answerKey"] }
          : observation,
      ),
    });
    assert.equal(dirty.status, "fail");
    assert.equal(dirty.metrics.sensitiveMatches, 1);
  });

  it("detects bare direct identifiers across runtime storage surfaces", () => {
    for (const serializedValue of [
      "contact=alice@example.com",
      "phone=13800138000",
      "id=11010519491231002X",
    ]) {
      const scan = buildE4RuntimeSurfaceScan({
        scannerImplementation: SCANNER_IMPLEMENTATION,
        subject: runtimeSubject(),
        observations: runtimeObservations().map((observation) =>
          observation.surface === "localStorage"
            ? { ...observation, serializedValues: [serializedValue] }
            : observation,
        ),
      });
      assert.equal(scan.status, "fail", serializedValue);
      assert.equal(scan.metrics.sensitiveMatches, 1, serializedValue);
      assert.equal(
        scan.observations.flatMap(({ sensitiveMatches }) => sensitiveMatches)[0]?.category,
        "direct_identifier",
        serializedValue,
      );
      assert.doesNotMatch(JSON.stringify(scan), new RegExp(serializedValue, "u"));
    }
  });

  it("binds two isolated single-role reviews into a non-overwriting closure shape", async () => {
    const journey = await buildE4CrossLayerJourney({
      cases: launchCases(), manifestPath: "cases/final.json", manifestSha256: HASH,
      generatedAt: "2026-09-03T00:00:00.000Z",
    });
    const scan = runtimeScan();
    const base = { schemaVersion: "e4-patient-identity-quality-record-v1", metrics: { publicPatientRoles: 30 } };
    const publicContent = canonicalJson(journey.publicEvidence);
    const privateContent = canonicalJson(journey.privateEvidence);
    const index = buildE4EvidenceIndex({
      generatedAt: "2026-09-03T00:00:00.000Z", manifestPath: "cases/final.json", manifestSha256: HASH,
      publicPath: "public/e4.json", publicContent, privatePath: "private/e4.json", privateContent,
    });
    const target = buildE4ClosureReviewTarget({ baseQualityRecord: base, journeyIndex: index, publicJourney: journey.publicEvidence, runtimeSurfaceScan: scan });
    const reviews = await Promise.all((["contract_projection_reviewer", "hidden_data_leakage_reviewer"] as const).map((reviewerId) =>
      runE4IndependentAiReview({
        reviewerId,
        reviewTarget: target,
        transport: fakeTransport(reviewerId),
        modelId: "review-model",
        invocationId: `invocation.${reviewerId}`,
        now: () => new Date("2026-09-03T01:02:03.456Z"),
      }),
    ));
    assert.equal(reviews[0]!.attemptedAt, "2026-09-03T01:02:03.456Z");
    assert.equal(reviews[0]!.contentSha256, sha256E4Canonical(target));
    const artifact = (path: string) => ({ path, sha256: HASH, bytes: 1 });
    const closure = buildE4PatientIdentityClosure({
      baseQualityRecord: base,
      journeyIndex: index,
      publicJourney: journey.publicEvidence,
      runtimeSurfaceScan: scan,
      reviewTarget: target,
      reviews,
      bindings: {
        baseQualityRecord: artifact("share/versions/e4-patient-identity-quality-record.v1.json"),
        journeyIndex: artifact("model/evaluation/phase8/e4-test/e4-cross-layer-evidence-index.v1.json"),
        publicJourney: artifact("model/evaluation/phase8/e4-test/public/e4-cross-layer-journey.v1.json"),
        runtimeSurfaceScan: artifact("model/evaluation/phase8/e4-test/public/e4-runtime-surface-scan.v4.json"),
        scannerImplementation: artifact(SCANNER_IMPLEMENTATION.path),
        reviewTarget: artifact("model/evaluation/phase8/e4-test/private/e4-closure-review-target.v4.json"),
        aiReviews: [
          artifact("model/evaluation/phase8/e4-test/private/contract_projection_reviewer.v2.json"),
          artifact("model/evaluation/phase8/e4-test/private/hidden_data_leakage_reviewer.v2.json"),
        ],
      },
      generatedAt: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(closure.decision, "passed");
    assert.equal(closure.metrics.crossLayerCases, 30);
    assert.equal(closure.aiCrossReview.reviews.length, 2);
    assert.equal(closure.aiCrossReview.reviews[0]!.attemptedAt, "2026-09-03T01:02:03.456Z");
    const visibilityTamper = structuredClone(closure.bindings);
    visibilityTamper.reviewTarget.path =
      "model/evaluation/phase8/e4-test/public/e4-closure-review-target.v4.json";
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews,
        bindings: visibilityTamper,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /not canonical/u,
    );
    const invocationTamper = structuredClone(reviews);
    invocationTamper[1]!.invocationId = invocationTamper[0]!.invocationId;
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews: invocationTamper,
        bindings: closure.bindings,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /two isolated AI reviews/u,
    );
    const scannerBindingTamper = structuredClone(closure.bindings);
    scannerBindingTamper.scannerImplementation.sha256 = "b".repeat(64);
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews,
        bindings: scannerBindingTamper,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /scanner implementation/u,
    );
    const timestampTamper = structuredClone(reviews);
    timestampTamper[0]!.attemptedAt = "2026-09-03 01:02:03Z";
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews: timestampTamper,
        bindings: closure.bindings,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /identity or isolation/u,
    );
    const notRunReview = await runE4IndependentAiReview({
      reviewerId: "contract_projection_reviewer",
      reviewTarget: target,
      transport: {
        ...fakeTransport("contract_projection_reviewer"),
        async create() { throw new Error("fixture provider outage"); },
      },
      modelId: "review-model",
      invocationId: "invocation.contract.not-run",
    });
    assert.equal(notRunReview.runStatus, "failed_to_run");
    assert.equal(notRunReview.decision, "not_run");
    const reportedClosure = buildE4PatientIdentityClosure({
      baseQualityRecord: base,
      journeyIndex: index,
      publicJourney: journey.publicEvidence,
      runtimeSurfaceScan: scan,
      reviewTarget: target,
      reviews: [notRunReview, reviews[1]!],
      bindings: closure.bindings,
      generatedAt: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(reportedClosure.decision, "reported_with_failures");
    assert.equal(reportedClosure.metrics.completedAiReviews, 1);
    assert.equal(reportedClosure.aiCrossReview.reviews[0]!.status, "not_run");
    const incompleteReview = structuredClone(reviews);
    incompleteReview[0]!.assessedControls.pop();
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews: incompleteReview,
        bindings: closure.bindings,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /required control/u,
    );
    const criticalPassedReview = structuredClone(reviews);
    criticalPassedReview[0]!.findings.push({
      code: "CRITICAL_FIXTURE",
      severity: "critical",
      message: "Critical fixture finding.",
    });
    assert.throws(
      () => buildE4PatientIdentityClosure({
        baseQualityRecord: base,
        journeyIndex: index,
        publicJourney: journey.publicEvidence,
        runtimeSurfaceScan: scan,
        reviewTarget: target,
        reviews: criticalPassedReview,
        bindings: closure.bindings,
        generatedAt: "2026-09-03T00:00:00.000Z",
      }),
      /critical findings/u,
    );
  });
});
