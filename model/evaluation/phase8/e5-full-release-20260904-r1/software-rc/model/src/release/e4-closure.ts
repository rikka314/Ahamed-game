import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import { loadPhase6CaseBundlesFromManifest } from "../cases/phase6-case-production.js";

import {
  E4_CROSS_LAYER_JOURNEY_VERSION,
  E4_EVIDENCE_INDEX_VERSION,
  E4_PRIVATE_JOURNEY_VERSION,
  E4_PATIENT_ACTOR_SLOTS,
  E4_RUNTIME_SURFACE_SCAN_VERSION,
  assertE4RuntimeScanSubject,
  buildE4GameSourceSnapshot,
  sha256E4,
  sha256E4Canonical,
  type E4CrossLayerEvidenceIndex,
  type E4PrivateCrossLayerJourney,
  type E4PublicCrossLayerJourney,
  type E4RuntimeSurfaceScan,
} from "../evaluation/e4-cross-layer-evidence.js";
import {
  E4_INDEPENDENT_AI_REVIEW_VERSION,
  E4_REVIEWER_IDS,
  assertE4IndependentAiReview,
  type E4IndependentAiReview,
} from "../evaluation/e4-independent-ai-review.js";

export const E4_CLOSURE_REVIEW_TARGET_VERSION =
  "e4-closure-review-target-v4" as const;
export const E4_PATIENT_IDENTITY_CLOSURE_VERSION =
  "e4-patient-identity-e5-closure-v4" as const;

export interface E4ArtifactBinding {
  path: string;
  sha256: string;
  bytes: number;
}

export interface E4ClosureReviewTarget {
  schemaVersion: typeof E4_CLOSURE_REVIEW_TARGET_VERSION;
  baseQualityRecord: unknown;
  publicJourney: E4PublicCrossLayerJourney;
  runtimeSurfaceScan: E4RuntimeSurfaceScan;
  evidenceSeparation: {
    sourceManifest: E4CrossLayerEvidenceIndex["manifest"];
    journeyArtifacts: E4CrossLayerEvidenceIndex["artifacts"];
  };
}

export interface E4PatientIdentityClosure {
  schemaVersion: typeof E4_PATIENT_IDENTITY_CLOSURE_VERSION;
  generatedAt: string;
  reviewPolicy: "non_blocking";
  decision: "passed" | "reported_with_failures";
  bindings: {
    baseQualityRecord: E4ArtifactBinding;
    journeyIndex: E4ArtifactBinding;
    publicJourney: E4ArtifactBinding;
    runtimeSurfaceScan: E4ArtifactBinding;
    scannerImplementation: E4ArtifactBinding;
    reviewTarget: E4ArtifactBinding;
    aiReviews: [E4ArtifactBinding, E4ArtifactBinding];
  };
  metrics: {
    publicPatientRoles: 30;
    crossLayerCases: 30;
    shifts: 15;
    reusableNpcSlots: 2;
    createSessionCalls: 30;
    askPatientCalls: 30;
    completedTurns: 30;
    observedRuntimeSurfaces: number;
    unavailableRuntimeSurfaces: number;
    failedRuntimeSurfaces: number;
    sensitiveMatches: number;
    completedAiReviews: number;
  };
  checks: Array<{
    checkId:
      | "thirty_case_live_cross_layer_journey"
      | "runtime_storage_and_log_leakage_scan"
      | "independent_ai_cross_review";
    status: "pass" | "fail";
    details: string;
  }>;
  aiCrossReview: {
    status: "pass" | "fail";
    reviews: Array<{
      reviewerId: (typeof E4_REVIEWER_IDS)[number];
      status: "pass" | "fail" | "not_run";
      decision: "passed" | "failed" | "not_run";
      modelId: string;
      promptVersion: string;
      attemptedAt: string;
      independentInvocation: true;
      counterpartOutputVisible: false;
      evidencePath: string;
      evidenceSha256: string;
      findings: E4IndependentAiReview["findings"];
    }>;
  };
}

const E4_BASE_QUALITY_RECORD_PATH =
  "share/versions/e4-patient-identity-quality-record.v1.json";
const E4_REQUIRED_BASE_REUSE_PATHS = [
  "share/versions/contract-v1-rc2.json",
  "share/contracts/v1-rc2/cases.ts",
  "share/contracts/v1-rc2/index.ts",
  "share/schemas/v1-rc2/public-contracts.schema.json",
  "share/schemas/v1-rc2/schema-manifest.json",
  "share/fixtures/v1-rc2/fixture-manifest.json",
  "share/fixtures/v1-rc2/public-fixtures.json",
  "share/tests/contract/contracts.test.ts",
  "share/tests/contract/hidden-fields.test.ts",
  "share/tests/contract/schema-fixtures.test.ts",
  "share/tests/helpers.ts",
  "model/src/adapters/share-v1-adapter.ts",
  "game/src/game/domain/patients/publicPatientIdentityCatalog.ts",
  "game/src/game/domain/patients/patientSessionBinding.ts",
  "game/tests/unit/patient-identity.test.ts",
  "game/components/GameCanvas.tsx",
  "game/src/game/bridge/gameBridge.ts",
  "game/src/game/domain/clinic-flow/clinicFlow.ts",
  "game/src/game/domain/clinic-flow/grayboxClinicContent.ts",
  "game/src/game/scenes/WorldScene.ts",
  "game/tests/unit/clinic-flow.test.ts",
  "game/tests/unit/gameBridge.test.ts",
] as const;

function resolveProjectFile(
  gameRoot: string,
  portablePath: string,
  label: string,
): string {
  if (
    isAbsolute(portablePath) ||
    portablePath.includes("\\") ||
    portablePath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} path is not a portable project-relative path.`);
  }
  const root = realpathSync(gameRoot);
  const candidate = resolve(root, ...portablePath.split("/"));
  const lexicalRelative = relative(root, candidate);
  if (
    lexicalRelative === "" || lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)
  ) {
    throw new Error(`${label} path escapes the project root.`);
  }
  const actual = realpathSync(candidate);
  const actualRelative = relative(root, actual);
  if (
    actualRelative === "" || actualRelative === ".." ||
    actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative) ||
    !statSync(actual).isFile()
  ) {
    throw new Error(`${label} binding is not a regular in-project file.`);
  }
  return actual;
}

function readBoundBytes(
  gameRoot: string,
  binding: E4ArtifactBinding,
  label: string,
): Buffer {
  const actual = resolveProjectFile(gameRoot, binding.path, label);
  if (statSync(actual).size !== binding.bytes) {
    throw new Error(`${label} binding size drifted.`);
  }
  const bytes = readFileSync(actual);
  if (sha256E4(bytes) !== binding.sha256) {
    throw new Error(`${label} binding hash drifted.`);
  }
  return bytes;
}

function readBoundJson<T>(
  gameRoot: string,
  binding: E4ArtifactBinding,
  label: string,
): T {
  return JSON.parse(readBoundBytes(gameRoot, binding, label).toString("utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function verifyBaseQualityReuseBindings(
  gameRoot: string,
  baseQualityRecord: unknown,
): void {
  if (
    !isRecord(baseQualityRecord) ||
    !isRecord(baseQualityRecord["reuseBindings"]) ||
    baseQualityRecord["reuseBindings"]["schemaVersion"] !==
      "e4-reuse-bindings-v1" ||
    !Array.isArray(baseQualityRecord["reuseBindings"]["files"]) ||
    baseQualityRecord["reuseBindings"]["files"].length !==
      E4_REQUIRED_BASE_REUSE_PATHS.length
  ) {
    throw new Error("E4 base quality reuse bindings are missing or invalid.");
  }
  const seenPaths = new Set<string>();
  for (const [index, value] of baseQualityRecord["reuseBindings"]["files"].entries()) {
    if (
      !isRecord(value) ||
      typeof value["path"] !== "string" ||
      typeof value["sha256"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value["sha256"]) ||
      seenPaths.has(value["path"])
    ) {
      throw new Error(`E4 base quality reuse binding ${index + 1} is invalid.`);
    }
    seenPaths.add(value["path"]);
    const path = resolveProjectFile(
      gameRoot,
      value["path"],
      `E4 base quality reuse binding ${index + 1}`,
    );
    if (sha256E4(readFileSync(path)) !== value["sha256"]) {
      throw new Error(`E4 base quality reuse binding drifted: ${value["path"]}`);
    }
  }
  if (E4_REQUIRED_BASE_REUSE_PATHS.some((path) => !seenPaths.has(path))) {
    throw new Error("E4 base quality reuse binding set is incomplete.");
  }
}

function assertCanonicalClosureBindings(input: {
  bindings: E4PatientIdentityClosure["bindings"];
  reviews: readonly E4IndependentAiReview[];
}): void {
  const match = /^model\/evaluation\/phase8\/([A-Za-z0-9._-]+)\/e4-cross-layer-evidence-index\.v1\.json$/u.exec(
    input.bindings.journeyIndex.path,
  );
  if (match === null) {
    throw new Error("E4 journey index binding path is not canonical.");
  }
  const evidenceRoot = `model/evaluation/phase8/${match[1]!}`;
  const expected = {
    baseQualityRecord: E4_BASE_QUALITY_RECORD_PATH,
    publicJourney: `${evidenceRoot}/public/e4-cross-layer-journey.v1.json`,
    runtimeSurfaceScan: `${evidenceRoot}/public/e4-runtime-surface-scan.v4.json`,
    scannerImplementation: "game/tests/e2e/e4-patient-identity-closure.spec.ts",
    reviewTarget: `${evidenceRoot}/private/e4-closure-review-target.v4.json`,
  } as const;
  for (const [name, path] of Object.entries(expected)) {
    if (input.bindings[name as keyof typeof expected].path !== path) {
      throw new Error(`E4 ${name} binding path is not canonical.`);
    }
  }
  for (const role of E4_REVIEWER_IDS) {
    const reviewIndex = input.reviews.findIndex(({ reviewerId }) => reviewerId === role);
    if (
      reviewIndex < 0 ||
      input.bindings.aiReviews[reviewIndex]?.path !==
        `${evidenceRoot}/private/${role}.v2.json`
    ) {
      throw new Error(`E4 ${role} evidence path is not canonical private evidence.`);
    }
  }
}

function indexedJourneyPath(
  journeyIndexPath: string,
  artifactPath: string,
): string {
  return [
    ...journeyIndexPath.split("/").slice(0, -1),
    ...artifactPath.split("/"),
  ].join("/");
}

export interface E4ExpectedJourneyCase {
  internalCaseId: string;
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  patientRoleId: string;
}

export function verifyE4JourneyIdentityBindings(input: {
  expectedCases: readonly E4ExpectedJourneyCase[];
  publicJourney: E4PublicCrossLayerJourney;
  privateJourney: E4PrivateCrossLayerJourney;
}): void {
  const publicCases = input.publicJourney.shifts.flatMap(({ cases }) => cases);
  if (
    input.expectedCases.length !== 30 || publicCases.length !== 30 ||
    input.privateJourney.operations.length !== 30 ||
    new Set(input.privateJourney.operations.map(({ ordinal }) => ordinal)).size !== 30 ||
    new Set(input.privateJourney.operations.map(({ publicCaseId }) => publicCaseId)).size !== 30 ||
    new Set(input.privateJourney.operations.map(({ patientRoleId }) => patientRoleId)).size !== 30 ||
    new Set(input.privateJourney.operations.map(({ sessionId }) => sessionId)).size !== 30 ||
    new Set(input.privateJourney.operations.map(({ clientRequestId }) => clientRequestId)).size !== 30 ||
    new Set(input.privateJourney.operations.map(({ clientTurnId }) => clientTurnId)).size !== 30
  ) {
    throw new Error("E4 public/private journey identity coverage is invalid.");
  }
  for (let index = 0; index < 30; index += 1) {
    const ordinal = index + 1;
    const expectedCase = input.expectedCases[index]!;
    const publicCase = publicCases[index]!;
    const operation = input.privateJourney.operations[index]!;
    const expectedSlot = E4_PATIENT_ACTOR_SLOTS[index % 2]!;
    const expectedShiftId = `shift.e4.${String(Math.floor(index / 2) + 1).padStart(2, "0")}`;
    if (
      operation.ordinal !== ordinal || publicCase.ordinal !== ordinal ||
      operation.operationStatus !== "committed" ||
      publicCase.shiftId !== expectedShiftId ||
      publicCase.actorSlotId !== expectedSlot || operation.actorSlotId !== expectedSlot ||
      operation.internalCaseId !== expectedCase.internalCaseId ||
      operation.publicCaseId !== expectedCase.publicCaseId ||
      operation.caseVersion !== expectedCase.caseVersion ||
      operation.patientRoleId !== expectedCase.patientRoleId ||
      publicCase.summary.caseId !== expectedCase.publicCaseId ||
      publicCase.summary.caseVersion !== expectedCase.caseVersion ||
      publicCase.summary.patientRoleId !== expectedCase.patientRoleId ||
      publicCase.summary.patientNpcId !== expectedSlot ||
      operation.sessionId !== publicCase.summary.sessionId ||
      publicCase.turn.sessionId !== operation.sessionId
    ) {
      throw new Error(`E4 journey identity/manifest binding drifted at ordinal ${ordinal}.`);
    }
  }
}

function verifyJourneySemantics(input: {
  gameRoot: string;
  journeyIndex: E4CrossLayerEvidenceIndex;
  journeyIndexPath: string;
  publicJourney: E4PublicCrossLayerJourney;
  publicJourneyBinding: E4ArtifactBinding;
}): { sourceManifestPath: string; sourceManifestSha256: string } {
  const indexedPublic = input.journeyIndex.artifacts.find(
    ({ visibility }) => visibility === "public",
  );
  const indexedPrivate = input.journeyIndex.artifacts.find(
    ({ visibility }) => visibility === "private",
  );
  if (indexedPublic === undefined || indexedPrivate === undefined) {
    throw new Error("E4 journey index is missing a public or private artifact.");
  }
  if (
    indexedPublic.path !== "public/e4-cross-layer-journey.v1.json" ||
    indexedPrivate.path !== "private/e4-cross-layer-journey.v1.json"
  ) {
    throw new Error("E4 journey visibility paths are not canonical.");
  }
  const indexedPublicPath = indexedJourneyPath(
    input.journeyIndexPath,
    indexedPublic.path,
  );
  const indexedPrivatePath = indexedJourneyPath(
    input.journeyIndexPath,
    indexedPrivate.path,
  );
  if (
    indexedPublicPath !== input.publicJourneyBinding.path ||
    indexedPublic.sha256 !== input.publicJourneyBinding.sha256 ||
    indexedPublic.bytes !== input.publicJourneyBinding.bytes
  ) {
    throw new Error("E4 public journey path/content is not exactly bound by its evidence index.");
  }
  const privateJourney = readBoundJson<E4PrivateCrossLayerJourney>(
    input.gameRoot,
    {
      path: indexedPrivatePath,
      sha256: indexedPrivate.sha256,
      bytes: indexedPrivate.bytes,
    },
    "E4 private journey",
  );
  if (
    privateJourney.schemaVersion !== E4_PRIVATE_JOURNEY_VERSION ||
    privateJourney.generatedAt !== input.publicJourney.generatedAt ||
    privateJourney.manifestSha256 !== input.journeyIndex.manifest.sha256 ||
    privateJourney.operations.length !== 30
  ) {
    throw new Error("E4 private journey header or coverage is invalid.");
  }

  const manifestPortablePath = `model/${input.journeyIndex.manifest.path}`;
  const manifestPath = resolveProjectFile(
    input.gameRoot,
    manifestPortablePath,
    "E4 source case manifest",
  );
  if (sha256E4(readFileSync(manifestPath)) !== input.journeyIndex.manifest.sha256) {
    throw new Error("E4 source case manifest hash drifted.");
  }
  const manifest = loadCaseManifestV2(manifestPath);
  const bundles = loadPhase6CaseBundlesFromManifest({
    casesDirectory: dirname(manifestPath),
    manifest,
  }).bundles;
  if (
    manifest.cases.length !== 30 || bundles.length !== 30
  ) {
    throw new Error("E4 source manifest case coverage is invalid.");
  }
  const expectedCases = manifest.cases.map((manifestEntry, index) => {
    const casePackage = bundles[index]!.casePackage;
    const patientRoleId = casePackage.schemaVersion === "case-package-v2-rc1"
      ? casePackage.patientIdentity.patientRoleId
      : undefined;
    if (
      manifestEntry.publicCaseId !== casePackage.publicCaseId ||
      manifestEntry.caseVersion !== casePackage.caseVersion ||
      manifestEntry.contentHash !== casePackage.provenance.contentHash ||
      manifestEntry.patientRoleId !== patientRoleId ||
      patientRoleId === undefined
    ) {
      throw new Error(`E4 source manifest/package binding drifted at case ${index + 1}.`);
    }
    return {
      internalCaseId: casePackage.internalCaseId,
      publicCaseId: manifestEntry.publicCaseId,
      caseVersion: manifestEntry.caseVersion,
      contentHash: manifestEntry.contentHash,
      patientRoleId,
    };
  });
  verifyE4JourneyIdentityBindings({
    expectedCases,
    publicJourney: input.publicJourney,
    privateJourney,
  });
  return {
    sourceManifestPath: input.journeyIndex.manifest.path,
    sourceManifestSha256: input.journeyIndex.manifest.sha256,
  };
}

export function buildE4ClosureReviewTarget(input: {
  baseQualityRecord: unknown;
  journeyIndex: E4CrossLayerEvidenceIndex;
  publicJourney: E4PublicCrossLayerJourney;
  runtimeSurfaceScan: E4RuntimeSurfaceScan;
}): E4ClosureReviewTarget {
  if (
    !isRecord(input.baseQualityRecord) ||
    input.baseQualityRecord["schemaVersion"] !== "e4-patient-identity-quality-record-v1" ||
    !isRecord(input.baseQualityRecord["metrics"]) ||
    input.baseQualityRecord["metrics"]["publicPatientRoles"] !== 30
  ) {
    throw new Error("E4 closure base quality record is invalid.");
  }
  const journeyCases = input.publicJourney.shifts.flatMap(({ cases }) => cases);
  if (
    input.publicJourney.schemaVersion !== E4_CROSS_LAYER_JOURNEY_VERSION ||
    input.publicJourney.metrics.caseCount !== 30 ||
    input.publicJourney.metrics.shiftCount !== 15 ||
    input.publicJourney.metrics.actorSlotCount !== 2 ||
    input.publicJourney.metrics.createSessionCalls !== 30 ||
    input.publicJourney.metrics.askPatientCalls !== 30 ||
    input.publicJourney.metrics.completedTurns !== 30 ||
    input.publicJourney.metrics.sensitiveMatches !== 0 ||
    input.publicJourney.shifts.length !== 15 ||
    journeyCases.length !== 30 ||
    new Set(journeyCases.map(({ summary }) => summary.sessionId)).size !== 30 ||
    new Set(journeyCases.map(({ summary }) => summary.patientRoleId)).size !== 30 ||
    journeyCases.some(({ actorSlotId, summary, turn }, index) =>
      actorSlotId !== E4_PATIENT_ACTOR_SLOTS[index % 2] ||
      summary.patientNpcId !== actorSlotId ||
      turn.sessionId !== summary.sessionId ||
      turn.sessionPhase !== "active")
  ) throw new Error("E4 closure public journey is incomplete.");
  if (input.runtimeSurfaceScan.schemaVersion !== E4_RUNTIME_SURFACE_SCAN_VERSION) {
    throw new Error("E4 runtime surface scan is invalid.");
  }
  assertE4RuntimeScanSubject(input.runtimeSurfaceScan.subject);
  const scannerImplementation = input.runtimeSurfaceScan.scannerImplementation;
  if (
    scannerImplementation.path !== "game/tests/e2e/e4-patient-identity-closure.spec.ts" ||
    !/^[a-f0-9]{64}$/u.test(scannerImplementation.sha256) ||
    !Number.isSafeInteger(scannerImplementation.bytes) ||
    scannerImplementation.bytes <= 0
  ) {
    throw new Error("E4 runtime surface scanner implementation binding is invalid.");
  }
  const expectedSurfaces = new Set([
    "console",
    "indexedDB",
    "localStorage",
    "sessionStorage",
    "cacheStorage",
    "saveExport",
  ]);
  const invalidScanObservation = input.runtimeSurfaceScan.observations.some(
    (observation) => {
      const digestByIndex = new Map(
        observation.valueDigests.map((digest) => [digest.valueIndex, digest] as const),
      );
      return !expectedSurfaces.has(observation.surface) ||
        !["observed", "not_available", "scan_failed"].includes(
          observation.availability,
        ) ||
        (observation.availability !== "observed" &&
          (observation.reason === undefined || observation.reason.trim().length === 0)) ||
        !Number.isSafeInteger(observation.valueCount) || observation.valueCount < 0 ||
        !Number.isSafeInteger(observation.utf8Bytes) || observation.utf8Bytes < 0 ||
        observation.valueDigests.length !== observation.valueCount ||
        digestByIndex.size !== observation.valueCount ||
        observation.valueDigests.some((digest, index) =>
          digest.valueIndex !== index ||
          !/^[a-f0-9]{64}$/u.test(digest.sha256) ||
          !Number.isSafeInteger(digest.utf8Bytes) || digest.utf8Bytes < 0) ||
        observation.valueDigests.reduce(
          (total, digest) => total + digest.utf8Bytes,
          0,
        ) !== observation.utf8Bytes ||
        observation.sensitiveMatches.some((match) => {
          const digest = digestByIndex.get(match.valueIndex);
          return match.category.trim().length === 0 || digest === undefined ||
            digest.sha256 !== match.sha256 || digest.utf8Bytes !== match.utf8Bytes;
        });
    },
  );
  const sensitiveMatches = input.runtimeSurfaceScan.observations.reduce(
    (total, observation) => total + observation.sensitiveMatches.length,
    0,
  );
  const observedSurfaces = input.runtimeSurfaceScan.observations.filter(
    ({ availability }) => availability === "observed",
  ).length;
  const unavailableSurfaces = input.runtimeSurfaceScan.observations.filter(
    ({ availability }) => availability === "not_available",
  ).length;
  const failedSurfaces = input.runtimeSurfaceScan.observations.filter(
    ({ availability }) => availability === "scan_failed",
  ).length;
  if (
    input.runtimeSurfaceScan.observations.length !== expectedSurfaces.size ||
    new Set(input.runtimeSurfaceScan.observations.map(({ surface }) => surface)).size !==
      expectedSurfaces.size ||
    invalidScanObservation ||
    input.runtimeSurfaceScan.metrics.observedSurfaces !== observedSurfaces ||
    input.runtimeSurfaceScan.metrics.unavailableSurfaces !== unavailableSurfaces ||
    input.runtimeSurfaceScan.metrics.failedSurfaces !== failedSurfaces ||
    input.runtimeSurfaceScan.metrics.sensitiveMatches !== sensitiveMatches ||
    input.runtimeSurfaceScan.status !==
      (sensitiveMatches === 0 && failedSurfaces === 0 ? "pass" : "fail")
  ) {
    throw new Error("E4 runtime surface scan metrics or findings are inconsistent.");
  }
  if (
    input.journeyIndex.schemaVersion !== E4_EVIDENCE_INDEX_VERSION ||
    input.journeyIndex.artifacts.length !== 2 ||
    new Set(input.journeyIndex.artifacts.map(({ visibility }) => visibility)).size !== 2 ||
    !input.journeyIndex.artifacts.some(({ visibility }) => visibility === "public") ||
    !input.journeyIndex.artifacts.some(({ visibility }) => visibility === "private")
  ) {
    throw new Error("E4 review target journey visibility evidence is invalid.");
  }
  return {
    schemaVersion: E4_CLOSURE_REVIEW_TARGET_VERSION,
    baseQualityRecord: input.baseQualityRecord,
    publicJourney: input.publicJourney,
    runtimeSurfaceScan: input.runtimeSurfaceScan,
    evidenceSeparation: {
      sourceManifest: structuredClone(input.journeyIndex.manifest),
      journeyArtifacts: structuredClone(input.journeyIndex.artifacts),
    },
  };
}

function assertBinding(binding: E4ArtifactBinding, label: string): void {
  if (
    binding.path.trim().length === 0 ||
    !/^[a-f0-9]{64}$/u.test(binding.sha256) ||
    !Number.isSafeInteger(binding.bytes) ||
    binding.bytes <= 0
  ) throw new Error(`${label} binding is invalid.`);
}

export function buildE4PatientIdentityClosure(input: {
  generatedAt?: string;
  baseQualityRecord: unknown;
  journeyIndex: E4CrossLayerEvidenceIndex;
  publicJourney: E4PublicCrossLayerJourney;
  runtimeSurfaceScan: E4RuntimeSurfaceScan;
  reviewTarget: E4ClosureReviewTarget;
  reviews: readonly E4IndependentAiReview[];
  bindings: {
    baseQualityRecord: E4ArtifactBinding;
    journeyIndex: E4ArtifactBinding;
    publicJourney: E4ArtifactBinding;
    runtimeSurfaceScan: E4ArtifactBinding;
    scannerImplementation: E4ArtifactBinding;
    reviewTarget: E4ArtifactBinding;
    aiReviews: readonly E4ArtifactBinding[];
  };
}): E4PatientIdentityClosure {
  const expectedTarget = buildE4ClosureReviewTarget({
    baseQualityRecord: input.baseQualityRecord,
    journeyIndex: input.journeyIndex,
    publicJourney: input.publicJourney,
    runtimeSurfaceScan: input.runtimeSurfaceScan,
  });
  if (sha256E4Canonical(expectedTarget) !== sha256E4Canonical(input.reviewTarget)) {
    throw new Error("E4 review target does not bind the supplied closure evidence.");
  }
  if (input.journeyIndex.schemaVersion !== E4_EVIDENCE_INDEX_VERSION) {
    throw new Error("E4 journey index is invalid.");
  }
  const reviewerIds = new Set(input.reviews.map(({ reviewerId }) => reviewerId));
  const targetSha256 = sha256E4Canonical(input.reviewTarget);
  input.reviews.forEach((review) =>
    assertE4IndependentAiReview(review, targetSha256));
  if (
    input.reviews.length !== 2 ||
    reviewerIds.size !== 2 ||
    new Set(input.reviews.map(({ invocationId }) => invocationId)).size !== 2 ||
    E4_REVIEWER_IDS.some((role) => !reviewerIds.has(role)) ||
    input.reviews.some((review) =>
      review.schemaVersion !== E4_INDEPENDENT_AI_REVIEW_VERSION ||
      review.independentInvocation !== true ||
      review.counterpartOutputVisible !== false ||
      review.contentSha256 !== targetSha256 ||
      review.modelId.trim().length === 0 ||
      review.promptVersion.trim().length === 0 ||
      !["passed", "failed", "not_run"].includes(review.decision))
  ) throw new Error("E4 requires two isolated AI reviews bound to the same review target.");
  assertCanonicalClosureBindings({
    bindings: input.bindings as E4PatientIdentityClosure["bindings"],
    reviews: input.reviews,
  });
  const allBindings = [
    input.bindings.baseQualityRecord,
    input.bindings.journeyIndex,
    input.bindings.publicJourney,
    input.bindings.runtimeSurfaceScan,
    input.bindings.scannerImplementation,
    input.bindings.reviewTarget,
    ...input.bindings.aiReviews,
  ];
  if (allBindings.length !== 8) throw new Error("E4 closure binding count is invalid.");
  allBindings.forEach((binding, index) => assertBinding(binding, `E4 artifact ${index + 1}`));
  if (
    input.bindings.scannerImplementation.path !== input.runtimeSurfaceScan.scannerImplementation.path ||
    input.bindings.scannerImplementation.sha256 !== input.runtimeSurfaceScan.scannerImplementation.sha256 ||
    input.bindings.scannerImplementation.bytes !== input.runtimeSurfaceScan.scannerImplementation.bytes
  ) {
    throw new Error("E4 runtime scanner implementation is not exactly bound by the closure.");
  }
  const orderedReviews = E4_REVIEWER_IDS.map((role) => input.reviews.find(({ reviewerId }) => reviewerId === role)!);
  const orderedReviewBindings = E4_REVIEWER_IDS.map((role) => {
    const index = input.reviews.findIndex(({ reviewerId }) => reviewerId === role);
    return input.bindings.aiReviews[index]!;
  }) as [E4ArtifactBinding, E4ArtifactBinding];
  const livePassed = input.publicJourney.metrics.sensitiveMatches === 0;
  const storagePassed = input.runtimeSurfaceScan.status === "pass";
  const reviewsPassed = orderedReviews.every(({ decision }) => decision === "passed");
  const completedAiReviews = orderedReviews.filter(
    ({ runStatus }) => (runStatus ?? "completed") === "completed",
  ).length;
  const checks: E4PatientIdentityClosure["checks"] = [
    {
      checkId: "thirty_case_live_cross_layer_journey",
      status: livePassed ? "pass" : "fail",
      details: "30 CasePackage v2 records completed ModelService create-session and ask-patient calls in 15 two-slot shifts.",
    },
    {
      checkId: "runtime_storage_and_log_leakage_scan",
      status: storagePassed ? "pass" : "fail",
      details: `${input.runtimeSurfaceScan.metrics.observedSurfaces} browser surfaces observed; ${input.runtimeSurfaceScan.metrics.unavailableSurfaces} unavailable surfaces recorded without fabrication; ${input.runtimeSurfaceScan.metrics.failedSurfaces} surface scans failed; ${input.runtimeSurfaceScan.metrics.sensitiveMatches} sensitive matches.`,
    },
    {
      checkId: "independent_ai_cross_review",
      status: reviewsPassed ? "pass" : "fail",
      details: `${completedAiReviews} of 2 isolated Contract Projection / Hidden-data Leakage AI reviews completed.`,
    },
  ];
  return {
    schemaVersion: E4_PATIENT_IDENTITY_CLOSURE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    reviewPolicy: "non_blocking",
    decision: checks.every(({ status }) => status === "pass") ? "passed" : "reported_with_failures",
    bindings: {
      baseQualityRecord: input.bindings.baseQualityRecord,
      journeyIndex: input.bindings.journeyIndex,
      publicJourney: input.bindings.publicJourney,
      runtimeSurfaceScan: input.bindings.runtimeSurfaceScan,
      scannerImplementation: input.bindings.scannerImplementation,
      reviewTarget: input.bindings.reviewTarget,
      aiReviews: orderedReviewBindings,
    },
    metrics: {
      publicPatientRoles: 30,
      crossLayerCases: 30,
      shifts: 15,
      reusableNpcSlots: 2,
      createSessionCalls: 30,
      askPatientCalls: 30,
      completedTurns: 30,
      observedRuntimeSurfaces: input.runtimeSurfaceScan.metrics.observedSurfaces,
      unavailableRuntimeSurfaces: input.runtimeSurfaceScan.metrics.unavailableSurfaces,
      failedRuntimeSurfaces: input.runtimeSurfaceScan.metrics.failedSurfaces,
      sensitiveMatches: input.runtimeSurfaceScan.metrics.sensitiveMatches,
      completedAiReviews,
    },
    checks,
    aiCrossReview: {
      status: reviewsPassed ? "pass" : "fail",
      reviews: orderedReviews.map((review, index) => ({
        reviewerId: review.reviewerId,
        status: review.decision === "passed"
          ? "pass"
          : review.decision === "not_run" ? "not_run" : "fail",
        decision: review.decision,
        modelId: review.modelId,
        promptVersion: review.promptVersion,
        attemptedAt: review.attemptedAt,
        independentInvocation: true,
        counterpartOutputVisible: false,
        evidencePath: orderedReviewBindings[index]!.path,
        evidenceSha256: orderedReviewBindings[index]!.sha256,
        findings: review.findings.map((finding) => ({ ...finding })),
      })),
    },
  };
}

export function verifyE4PatientIdentityClosure(input: {
  gameRoot: string;
  closure: E4PatientIdentityClosure;
}): {
  decision: E4PatientIdentityClosure["decision"];
  crossLayerCases: number;
  completedAiReviews: number;
  sensitiveMatches: number;
  sourceManifestPath: string;
  sourceManifestSha256: string;
} {
  const { closure, gameRoot } = input;
  if (
    closure.schemaVersion !== E4_PATIENT_IDENTITY_CLOSURE_VERSION ||
    closure.reviewPolicy !== "non_blocking" ||
    !["passed", "reported_with_failures"].includes(closure.decision)
  ) {
    throw new Error("E4 patient identity closure header is invalid.");
  }
  const baseQualityRecord = readBoundJson<unknown>(
    gameRoot,
    closure.bindings.baseQualityRecord,
    "E4 base quality record",
  );
  const journeyIndex = readBoundJson<E4CrossLayerEvidenceIndex>(
    gameRoot,
    closure.bindings.journeyIndex,
    "E4 journey index",
  );
  const publicJourney = readBoundJson<E4PublicCrossLayerJourney>(
    gameRoot,
    closure.bindings.publicJourney,
    "E4 public journey",
  );
  const runtimeSurfaceScan = readBoundJson<E4RuntimeSurfaceScan>(
    gameRoot,
    closure.bindings.runtimeSurfaceScan,
    "E4 runtime surface scan",
  );
  assertE4RuntimeScanSubject(runtimeSurfaceScan.subject);
  const currentGameSource = buildE4GameSourceSnapshot(resolve(gameRoot, "game"));
  if (
    sha256E4Canonical(currentGameSource) !==
      sha256E4Canonical(runtimeSurfaceScan.subject.gameSource)
  ) {
    throw new Error("E4 runtime scan game source subject drifted from the current application.");
  }
  readBoundBytes(
    gameRoot,
    closure.bindings.scannerImplementation,
    "E4 runtime scanner implementation",
  );
  if (
    closure.bindings.scannerImplementation.path !== runtimeSurfaceScan.scannerImplementation.path ||
    closure.bindings.scannerImplementation.sha256 !== runtimeSurfaceScan.scannerImplementation.sha256 ||
    closure.bindings.scannerImplementation.bytes !== runtimeSurfaceScan.scannerImplementation.bytes
  ) {
    throw new Error("E4 runtime scanner implementation binding drifted.");
  }
  const reviewTarget = readBoundJson<E4ClosureReviewTarget>(
    gameRoot,
    closure.bindings.reviewTarget,
    "E4 closure review target",
  );
  const reviews = closure.bindings.aiReviews.map((binding, index) =>
    readBoundJson<E4IndependentAiReview>(
      gameRoot,
      binding,
      `E4 independent AI review ${index + 1}`,
    ),
  );
  verifyBaseQualityReuseBindings(gameRoot, baseQualityRecord);

  if (
    journeyIndex.schemaVersion !== E4_EVIDENCE_INDEX_VERSION ||
    journeyIndex.artifacts.length !== 2 ||
    new Set(journeyIndex.artifacts.map(({ visibility }) => visibility)).size !== 2 ||
    !journeyIndex.artifacts.some(({ visibility }) => visibility === "public") ||
    !journeyIndex.artifacts.some(({ visibility }) => visibility === "private") ||
    journeyIndex.artifactSetSha256 !== sha256E4Canonical(
      journeyIndex.artifacts.map(({ path, sha256, bytes, visibility }) => ({
        path,
        sha256,
        bytes,
        visibility,
      })),
    )
  ) {
    throw new Error("E4 journey index binding set is invalid.");
  }
  if (
    journeyIndex.manifest.path !== publicJourney.manifest.path ||
    journeyIndex.manifest.sha256 !== publicJourney.manifest.sha256 ||
    publicJourney.manifest.caseCount !== publicJourney.metrics.caseCount
  ) {
    throw new Error("E4 journey manifest bindings are inconsistent.");
  }
  for (const [index, artifact] of journeyIndex.artifacts.entries()) {
    readBoundJson<unknown>(gameRoot, {
      path: indexedJourneyPath(closure.bindings.journeyIndex.path, artifact.path),
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    }, `E4 indexed journey artifact ${index + 1}`);
  }
  const journeyBinding = verifyJourneySemantics({
    gameRoot,
    journeyIndex,
    journeyIndexPath: closure.bindings.journeyIndex.path,
    publicJourney,
    publicJourneyBinding: closure.bindings.publicJourney,
  });

  const rebuilt = buildE4PatientIdentityClosure({
    generatedAt: closure.generatedAt,
    baseQualityRecord,
    journeyIndex,
    publicJourney,
    runtimeSurfaceScan,
    reviewTarget,
    reviews,
    bindings: closure.bindings,
  });
  if (sha256E4Canonical(rebuilt) !== sha256E4Canonical(closure)) {
    throw new Error("E4 patient identity closure is internally inconsistent.");
  }
  return {
    decision: closure.decision,
    crossLayerCases: closure.metrics.crossLayerCases,
    completedAiReviews: closure.metrics.completedAiReviews,
    sensitiveMatches: closure.metrics.sensitiveMatches,
    sourceManifestPath: journeyBinding.sourceManifestPath,
    sourceManifestSha256: journeyBinding.sourceManifestSha256,
  };
}
