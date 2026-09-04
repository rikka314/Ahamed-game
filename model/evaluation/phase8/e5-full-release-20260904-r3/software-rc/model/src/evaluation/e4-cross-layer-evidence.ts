import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import type { CaseSummaryV1, TurnCompletedV1 } from "@ahamed/doctor-game-share";

import { createHeadlessModelService } from "../application/create-headless-model-service.js";
import type { IdGenerator } from "../application/model-service.js";
import { toCreateSessionResponseV1, toTurnCompletedV1 } from "../adapters/share-v1-adapter.js";
import type { SupportedCasePackage } from "../domain/case-package.js";

export const E4_CROSS_LAYER_JOURNEY_VERSION =
  "e4-cross-layer-journey-v1" as const;
export const E4_PRIVATE_JOURNEY_VERSION =
  "e4-private-cross-layer-journey-v1" as const;
export const E4_EVIDENCE_INDEX_VERSION = "e4-cross-layer-evidence-index-v1" as const;
export const E4_RUNTIME_SURFACE_SCAN_VERSION =
  "e4-runtime-surface-scan-v4" as const;
export const E4_GAME_SOURCE_SNAPSHOT_VERSION =
  "e4-game-source-snapshot-v1" as const;
export const E4_BROWSER_RUNTIME_SNAPSHOT_VERSION =
  "e4-browser-runtime-snapshot-v1" as const;

export const E4_PATIENT_ACTOR_SLOTS = [
  "npc.patient.graybox-01",
  "npc.patient.graybox-02",
] as const;

const SENSITIVE_PATTERNS = [
  { category: "server_confidential_field", pattern: /personaTemplateId|behaviorInstructions|answerKey|rubric|targetDiagnosis|patientFacts|medicalTests|releaseReview|systemPrompt/iu },
  { category: "credential", pattern: /api[_-]?key|authorization|bearer\s+[A-Za-z0-9._~-]+|password|passwd|secret|access[_-]?token|refresh[_-]?token|set-cookie|\bsk-[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/iu },
  { category: "direct_identifier", pattern: /身份证|手机号|家庭住址|电子邮箱|真实姓名|patient[_-]?(?:name|email|phone|address)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dX](?!\d)/iu },
] as const;

function sensitiveCategories(value: string): string[] {
  return SENSITIVE_PATTERNS
    .filter(({ pattern }) => pattern.test(value))
    .map(({ category }) => category);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function sha256E4(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256E4Canonical(value: unknown): string {
  return sha256E4(JSON.stringify(canonicalValue(value)));
}

class SequentialEvidenceIds implements IdGenerator {
  private nextId = 0;

  next(prefix: string): string {
    this.nextId += 1;
    return `${prefix}.e4.${String(this.nextId).padStart(4, "0")}`;
  }
}

export interface E4PublicJourneyCase {
  ordinal: number;
  shiftId: string;
  actorSlotId: string;
  summary: CaseSummaryV1;
  turn: TurnCompletedV1;
}

export interface E4PublicCrossLayerJourney {
  schemaVersion: typeof E4_CROSS_LAYER_JOURNEY_VERSION;
  generatedAt: string;
  reviewPolicy: "non_blocking";
  manifest: { path: string; sha256: string; caseCount: 30 };
  metrics: {
    caseCount: 30;
    shiftCount: 15;
    actorSlotCount: 2;
    createSessionCalls: 30;
    askPatientCalls: 30;
    completedTurns: 30;
    sensitiveMatches: 0;
  };
  shifts: Array<{
    shiftId: string;
    cases: [E4PublicJourneyCase, E4PublicJourneyCase];
  }>;
}

export interface E4PrivateCrossLayerJourney {
  schemaVersion: typeof E4_PRIVATE_JOURNEY_VERSION;
  generatedAt: string;
  manifestSha256: string;
  operations: Array<{
    ordinal: number;
    internalCaseId: string;
    publicCaseId: string;
    caseVersion: string;
    patientRoleId: string;
    actorSlotId: string;
    sessionId: string;
    clientRequestId: string;
    clientTurnId: string;
    operationStatus: "committed";
  }>;
}

export interface E4CrossLayerEvidenceIndex {
  schemaVersion: typeof E4_EVIDENCE_INDEX_VERSION;
  generatedAt: string;
  manifest: { path: string; sha256: string };
  artifacts: Array<{ path: string; sha256: string; bytes: number; visibility: "public" | "private" }>;
  artifactSetSha256: string;
}

function assertThirtyFinalCases(cases: readonly SupportedCasePackage[]): void {
  if (cases.length !== 30) throw new Error(`E4 requires exactly 30 cases; found ${cases.length}.`);
  const publicIds = new Set(cases.map(({ publicCaseId }) => publicCaseId));
  const roleIds = new Set(
    cases.map((casePackage) =>
      casePackage.schemaVersion === "case-package-v2-rc1"
        ? casePackage.patientIdentity.patientRoleId
        : "",
    ),
  );
  if (
    cases.some(({ schemaVersion }) => schemaVersion !== "case-package-v2-rc1") ||
    publicIds.size !== 30 ||
    roleIds.size !== 30 ||
    roleIds.has("")
  ) {
    throw new Error("E4 requires 30 unique CasePackage v2 publicCaseId and patientRoleId bindings.");
  }
}

export async function buildE4CrossLayerJourney(input: {
  cases: readonly SupportedCasePackage[];
  manifestPath: string;
  manifestSha256: string;
  generatedAt?: string;
}): Promise<{ publicEvidence: E4PublicCrossLayerJourney; privateEvidence: E4PrivateCrossLayerJourney }> {
  assertThirtyFinalCases(input.cases);
  if (!/^[a-f0-9]{64}$/u.test(input.manifestSha256)) {
    throw new Error("E4 manifest SHA-256 is invalid.");
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const service = createHeadlessModelService({
    cases: [...input.cases],
    ids: new SequentialEvidenceIds(),
  });
  const publicCases: E4PublicJourneyCase[] = [];
  const operations: E4PrivateCrossLayerJourney["operations"] = [];
  try {
    for (const [index, casePackage] of input.cases.entries()) {
      const ordinal = index + 1;
      const actorSlotId = E4_PATIENT_ACTOR_SLOTS[index % 2]!;
      const shiftId = `shift.e4.${String(Math.floor(index / 2) + 1).padStart(2, "0")}`;
      const clientRequestId = `request.e4.create.${String(ordinal).padStart(2, "0")}`;
      const clientTurnId = `turn.e4.ask.${String(ordinal).padStart(2, "0")}`;
      const created = await service.createSession({
        clientRequestId,
        publicCaseId: casePackage.publicCaseId,
        patientNpcId: actorSlotId,
      });
      const turn = await service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId,
        text: casePackage.locale.startsWith("zh") ? "请说说你现在主要哪里不舒服？" : "What is bothering you today?",
      });
      const publicCreated = toCreateSessionResponseV1(created);
      const publicTurn = toTurnCompletedV1(turn);
      publicCases.push({ ordinal, shiftId, actorSlotId, summary: publicCreated.session, turn: publicTurn });
      operations.push({
        ordinal,
        internalCaseId: casePackage.internalCaseId,
        publicCaseId: casePackage.publicCaseId,
        caseVersion: casePackage.caseVersion,
        patientRoleId: publicCreated.session.patientRoleId,
        actorSlotId,
        sessionId: publicCreated.session.sessionId,
        clientRequestId,
        clientTurnId,
        operationStatus: "committed",
      });
    }
  } finally {
    service.close();
  }
  const shifts: E4PublicCrossLayerJourney["shifts"] = [];
  for (let index = 0; index < publicCases.length; index += 2) {
    const first = publicCases[index];
    const second = publicCases[index + 1];
    if (first === undefined || second === undefined || first.shiftId !== second.shiftId) {
      throw new Error("E4 15×2 shift construction failed.");
    }
    shifts.push({ shiftId: first.shiftId, cases: [first, second] });
  }
  const publicEvidence: E4PublicCrossLayerJourney = {
    schemaVersion: E4_CROSS_LAYER_JOURNEY_VERSION,
    generatedAt,
    reviewPolicy: "non_blocking",
    manifest: { path: input.manifestPath, sha256: input.manifestSha256, caseCount: 30 },
    metrics: {
      caseCount: 30,
      shiftCount: 15,
      actorSlotCount: 2,
      createSessionCalls: 30,
      askPatientCalls: 30,
      completedTurns: 30,
      sensitiveMatches: 0,
    },
    shifts,
  };
  if (sensitiveCategories(JSON.stringify(publicEvidence)).length > 0) {
    throw new Error("E4 public journey contains a server-confidential field token.");
  }
  return {
    publicEvidence,
    privateEvidence: {
      schemaVersion: E4_PRIVATE_JOURNEY_VERSION,
      generatedAt,
      manifestSha256: input.manifestSha256,
      operations,
    },
  };
}

export function buildE4EvidenceIndex(input: {
  generatedAt: string;
  manifestPath: string;
  manifestSha256: string;
  publicPath: string;
  publicContent: string;
  privatePath: string;
  privateContent: string;
}): E4CrossLayerEvidenceIndex {
  const artifacts: E4CrossLayerEvidenceIndex["artifacts"] = [
    { path: input.publicPath, sha256: sha256E4(input.publicContent), bytes: Buffer.byteLength(input.publicContent), visibility: "public" },
    { path: input.privatePath, sha256: sha256E4(input.privateContent), bytes: Buffer.byteLength(input.privateContent), visibility: "private" },
  ];
  return {
    schemaVersion: E4_EVIDENCE_INDEX_VERSION,
    generatedAt: input.generatedAt,
    manifest: { path: input.manifestPath, sha256: input.manifestSha256 },
    artifacts,
    artifactSetSha256: sha256E4Canonical(
      artifacts.map(({ path, sha256, bytes, visibility }) => ({ path, sha256, bytes, visibility })),
    ),
  };
}

export type E4RuntimeSurfaceName =
  | "console"
  | "indexedDB"
  | "localStorage"
  | "sessionStorage"
  | "cacheStorage"
  | "saveExport";

export interface E4RuntimeSurfaceObservation {
  surface: E4RuntimeSurfaceName;
  availability: "observed" | "not_available" | "scan_failed";
  serializedValues: readonly string[];
  reason?: string;
}

export interface E4RuntimeSurfaceValueDigest {
  valueIndex: number;
  sha256: string;
  utf8Bytes: number;
}

export interface E4RuntimeSurfaceSensitiveMatch extends E4RuntimeSurfaceValueDigest {
  category: string;
}

export interface E4RuntimeSurfaceScanObservation {
  surface: E4RuntimeSurfaceName;
  availability: "observed" | "not_available" | "scan_failed";
  valueCount: number;
  utf8Bytes: number;
  valueDigests: E4RuntimeSurfaceValueDigest[];
  sensitiveMatches: E4RuntimeSurfaceSensitiveMatch[];
  reason?: string;
}

export interface E4GameSourceSnapshot {
  schemaVersion: typeof E4_GAME_SOURCE_SNAPSHOT_VERSION;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  sourceTreeSha256: string;
}

export interface E4BrowserRuntimeSnapshot {
  schemaVersion: typeof E4_BROWSER_RUNTIME_SNAPSHOT_VERSION;
  browserName: "chromium";
  freshWebServerRequired: true;
  pagePath: string;
  artifacts: Array<{
    path: string;
    status: number;
    contentType: string;
    sha256: string;
    bytes: number;
  }>;
  artifactSetSha256: string;
}

const E4_GAME_SOURCE_DIRECTORIES = [
  "app",
  "assets",
  "components",
  "public",
  "scripts",
  "src",
  "tests",
] as const;
const E4_GAME_SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "playwright.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "vitest.config.ts",
  ".npmrc",
] as const;

export function buildE4GameSourceSnapshot(
  gameDirectory: string,
): E4GameSourceSnapshot {
  const root = realpathSync(gameDirectory);
  const paths: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("E4 game source snapshot refuses symbolic links.");
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error("E4 game source snapshot found an unsupported entry.");
    }
  };
  for (const directory of E4_GAME_SOURCE_DIRECTORIES) {
    const path = resolve(root, directory);
    if (!lstatSync(path).isDirectory()) {
      throw new Error(`E4 game source directory is invalid: ${directory}`);
    }
    walk(path);
  }
  for (const file of E4_GAME_SOURCE_FILES) {
    const path = resolve(root, file);
    if (!lstatSync(path).isFile()) {
      throw new Error(`E4 game source file is invalid: ${file}`);
    }
    paths.push(path);
  }
  const files = paths.map((path) => {
    const portableRelative = relative(root, path).split(sep).join("/");
    if (
      portableRelative.length === 0 || portableRelative === ".." ||
      portableRelative.startsWith("../")
    ) {
      throw new Error("E4 game source snapshot path escaped the game directory.");
    }
    const bytes = readFileSync(path);
    return {
      path: `game/${portableRelative}`,
      sha256: sha256E4(bytes),
      bytes: bytes.byteLength,
    };
  }).filter(({ path }) =>
    !(path.startsWith("game/assets/source/") && path.includes("/review/"))
  ).sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: E4_GAME_SOURCE_SNAPSHOT_VERSION,
    files,
    sourceTreeSha256: sha256E4Canonical(files),
  };
}

export function assertE4RuntimeScanSubject(subject: E4RuntimeSurfaceScan["subject"]): void {
  const sourcePaths = new Set(subject.gameSource.files.map(({ path }) => path));
  const runtimePaths = new Set(subject.browserRuntime.artifacts.map(({ path }) => path));
  if (
    subject.gameSource.schemaVersion !== E4_GAME_SOURCE_SNAPSHOT_VERSION ||
    subject.gameSource.files.length === 0 ||
    sourcePaths.size !== subject.gameSource.files.length ||
    subject.gameSource.files.some(({ path, sha256, bytes }) =>
      !path.startsWith("game/") || path.includes("\\") ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      !Number.isSafeInteger(bytes) || bytes < 0) ||
    subject.gameSource.sourceTreeSha256 !==
      sha256E4Canonical(subject.gameSource.files) ||
    subject.browserRuntime.schemaVersion !== E4_BROWSER_RUNTIME_SNAPSHOT_VERSION ||
    subject.browserRuntime.browserName !== "chromium" ||
    subject.browserRuntime.freshWebServerRequired !== true ||
    !subject.browserRuntime.pagePath.startsWith("/") ||
    subject.browserRuntime.artifacts.length === 0 ||
    runtimePaths.size !== subject.browserRuntime.artifacts.length ||
    subject.browserRuntime.artifacts.some(({ path, status, contentType, sha256, bytes }) =>
      !path.startsWith("/") || path.includes("\\") ||
      !Number.isSafeInteger(status) || status < 200 || status >= 400 ||
      typeof contentType !== "string" ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      !Number.isSafeInteger(bytes) || bytes < 0) ||
    subject.browserRuntime.artifactSetSha256 !==
      sha256E4Canonical(subject.browserRuntime.artifacts)
  ) {
    throw new Error("E4 runtime scan subject binding is invalid.");
  }
}

export interface E4RuntimeSurfaceScan {
  schemaVersion: typeof E4_RUNTIME_SURFACE_SCAN_VERSION;
  generatedAt: string;
  status: "pass" | "fail";
  scannerImplementation: {
    path: string;
    sha256: string;
    bytes: number;
  };
  subject: {
    gameSource: E4GameSourceSnapshot;
    browserRuntime: E4BrowserRuntimeSnapshot;
  };
  observations: E4RuntimeSurfaceScanObservation[];
  metrics: { observedSurfaces: number; unavailableSurfaces: number; failedSurfaces: number; sensitiveMatches: number };
}

export function buildE4RuntimeSurfaceScan(input: {
  generatedAt?: string;
  scannerImplementation: E4RuntimeSurfaceScan["scannerImplementation"];
  subject: E4RuntimeSurfaceScan["subject"];
  observations: readonly E4RuntimeSurfaceObservation[];
}): E4RuntimeSurfaceScan {
  const expected = new Set<E4RuntimeSurfaceName>([
    "console", "indexedDB", "localStorage", "sessionStorage", "cacheStorage", "saveExport",
  ]);
  if (
    input.scannerImplementation.path.trim().length === 0 ||
    !/^[a-f0-9]{64}$/u.test(input.scannerImplementation.sha256) ||
    !Number.isSafeInteger(input.scannerImplementation.bytes) ||
    input.scannerImplementation.bytes <= 0 ||
    input.observations.length !== expected.size ||
    new Set(input.observations.map(({ surface }) => surface)).size !== expected.size ||
    input.observations.some(({ surface, availability, serializedValues, reason }) =>
      !expected.has(surface) || !Array.isArray(serializedValues) ||
      (availability !== "observed" && (reason === undefined || reason.trim().length === 0)))
  ) {
    throw new Error("E4 runtime scan must truthfully cover each required surface exactly once.");
  }
  assertE4RuntimeScanSubject(input.subject);
  const observations = input.observations.map((observation) => {
    const valueDigests = observation.serializedValues.map((value, valueIndex) => ({
      valueIndex,
      sha256: createHash("sha256").update(value).digest("hex"),
      utf8Bytes: Buffer.byteLength(value, "utf8"),
    }));
    const sensitiveMatches = observation.serializedValues.flatMap((value, valueIndex) =>
      sensitiveCategories(value).map((category) => ({
        ...valueDigests[valueIndex]!,
        category,
      })));
    return {
      surface: observation.surface,
      availability: observation.availability,
      valueCount: valueDigests.length,
      utf8Bytes: valueDigests.reduce((total, value) => total + value.utf8Bytes, 0),
      valueDigests,
      sensitiveMatches,
      ...(observation.reason === undefined ? {} : { reason: observation.reason }),
    };
  });
  const sensitiveMatches = observations.reduce((total, item) => total + item.sensitiveMatches.length, 0);
  return {
    schemaVersion: E4_RUNTIME_SURFACE_SCAN_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: sensitiveMatches === 0 && observations.every(({ availability }) => availability !== "scan_failed") ? "pass" : "fail",
    scannerImplementation: { ...input.scannerImplementation },
    subject: structuredClone(input.subject),
    observations,
    metrics: {
      observedSurfaces: observations.filter(({ availability }) => availability === "observed").length,
      unavailableSurfaces: observations.filter(({ availability }) => availability === "not_available").length,
      failedSurfaces: observations.filter(({ availability }) => availability === "scan_failed").length,
      sensitiveMatches,
    },
  };
}
