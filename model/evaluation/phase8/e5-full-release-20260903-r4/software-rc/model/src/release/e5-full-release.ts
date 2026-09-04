import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const E5_FULL_ACCEPTANCE_REPORT_SCHEMA_VERSION =
  "e5-full-acceptance-report-v1" as const;
export const E5_RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION =
  "e5-runtime-release-manifest-v1" as const;

export const E5_MINIMUM_TARGET_COUNTS = {
  cases: 30,
  trajectories: 120,
  goldenVectors: 180,
  dialogueSamples: 600,
  newDomainSafetySamples: 36,
  caseAiReviewCalls: 60,
  personaRuleAssertions: 72,
  personaLiveTurns: 72,
  releaseDialogueTurns: 360,
  patientRoles: 30,
} as const;

export const E5_REQUIRED_LOCAL_COMMAND_NAMES = [
  "share.build",
  "share.typecheck",
  "share.test:contract",
  "share.test:coverage",
  "model.build",
  "model.typecheck",
  "model.test",
  "model.test:coverage",
  "model.test:contract",
  "model.cases:validate:launch-policy",
  "model.cases:validate:manifest",
  "model.cases:validate",
  "model.eval:phase7:offline",
  "model.eval:e3:persona-verify",
  "game.lint",
  "game.typecheck",
  "game.test",
  "game.test:contract",
  "game.build",
  "game.test:e2e",
] as const;

export const E5_REQUIRED_EVIDENCE_BINDING_NAMES = [
  "launch-content-policy",
  "current-case-manifest",
  "scoring-golden-vector-test",
  "e3-persona-report",
  "case-ai-review-set",
  "e4-patient-identity-quality-record",
] as const;

export type E5CountName = keyof typeof E5_MINIMUM_TARGET_COUNTS;
export type E5TargetCounts = Record<E5CountName, number>;
export type E5ObservedCounts = Record<E5CountName, number>;
export type E5ObservationStatus = "passed" | "failed" | "not_run" | "stale";
export type E5AcceptanceDecision =
  | "passed"
  | "incomplete"
  | "reported_with_failures";
export type E5FindingStatus = "incomplete" | "stale" | "not_run" | "failed";

export interface E5Finding {
  code: string;
  status: E5FindingStatus;
  scope: string;
  message: string;
  expected?: number | string;
  actual?: number | string;
}

export interface E5LocalCommandReport {
  name: string;
  command: string;
  exitCode: number;
  stdoutSha256?: string;
  stderrSha256?: string;
}

export interface E5StatusWithMetrics {
  status: E5ObservationStatus;
  metrics: Record<string, number>;
}

export interface E5E4ObservationStatuses {
  live: E5ObservationStatus;
  storage: E5ObservationStatus;
  aiReviews: readonly E5ObservationStatus[];
}

export interface E5StaticClientScanResult {
  status: "passed" | "failed" | "not_run";
  scannedFiles: number;
  sensitiveMatches: number;
}

export interface E5EvidenceBinding {
  name: string;
  path: string;
  sha256: string;
  status: "current" | "missing" | "stale";
}

export interface E5AcceptanceReportV1 {
  schemaVersion: typeof E5_FULL_ACCEPTANCE_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  reviewPolicy: "non_blocking";
  decision: E5AcceptanceDecision;
  targetCounts: E5TargetCounts;
  observedCounts: E5ObservedCounts;
  localCommandReports: E5LocalCommandReport[];
  provider: E5ObservationStatus;
  e3: E5StatusWithMetrics;
  e4: {
    live: E5ObservationStatus;
    storage: E5ObservationStatus;
    aiReviews: E5ObservationStatus[];
  };
  staticClientScan: E5StaticClientScanResult;
  evidenceBindings: E5EvidenceBinding[];
  findings: E5Finding[];
}

export interface E5SourceState {
  headCommit: string | null;
  dirty: boolean;
  statusSha256: string;
  trackedChanges: number;
  untrackedChanges: number;
}

export interface E5ProviderObservation {
  status: "observed" | "not_run" | "failed";
  providerName?: string;
  configuredModelId?: string;
  actualModelId?: string;
  findings: string[];
}

export interface E5ReleaseArtifactBinding {
  path: string;
  sha256: string;
  size: number;
}

export interface E5AcceptanceReportBinding extends E5ReleaseArtifactBinding {
  decision: E5AcceptanceDecision;
}

export interface E5RuntimeReleaseManifestV1 {
  schemaVersion: typeof E5_RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION;
  generatedAt: string;
  sourceState: E5SourceState;
  acceptanceReport: E5AcceptanceReportBinding;
  providerObservation: E5ProviderObservation;
  quality: {
    reviewPolicy: "non_blocking";
    findings: E5Finding[];
  };
  artifacts: E5ReleaseArtifactBinding[];
  artifactSetSha256: string;
  manifestSha256: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function assertObservationStatus(
  value: unknown,
  field: string,
): asserts value is E5ObservationStatus {
  if (!["passed", "failed", "not_run", "stale"].includes(String(value))) {
    throw new Error(`${field} is invalid`);
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function sha256E5Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function assertIsoDate(value: string, field: string): void {
  if (!nonEmptyString(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO date-time`);
  }
}

function assertCountRecord(
  value: E5TargetCounts | E5ObservedCounts,
  field: string,
  enforceMinimum: boolean,
): void {
  for (const [name, minimum] of Object.entries(E5_MINIMUM_TARGET_COUNTS) as Array<
    [E5CountName, number]
  >) {
    const count = value[name];
    if (!isNonNegativeInteger(count)) {
      throw new Error(`${field}.${name} must be a non-negative integer`);
    }
    if (enforceMinimum && count < minimum) {
      throw new Error(`${field}.${name} must be at least ${minimum}`);
    }
  }
}

function observationFinding(
  scope: string,
  status: E5ObservationStatus,
): E5Finding | undefined {
  if (status === "passed") return undefined;
  const findingStatus: E5FindingStatus = status;
  return {
    code: `E5_${scope.replaceAll(/[^A-Za-z0-9]+/gu, "_").toUpperCase()}_${status.toUpperCase()}`,
    status: findingStatus,
    scope,
    message:
      status === "not_run"
        ? `${scope} was not run.`
        : status === "stale"
          ? `${scope} is bound to stale evidence.`
          : `${scope} reported a failure.`,
    expected: "passed",
    actual: status,
  };
}

function assertFinding(finding: E5Finding, field: string): void {
  if (
    !nonEmptyString(finding.code) ||
    !nonEmptyString(finding.scope) ||
    !nonEmptyString(finding.message) ||
    !["incomplete", "stale", "not_run", "failed"].includes(finding.status)
  ) {
    throw new Error(`${field} is invalid`);
  }
}

export function buildE5AcceptanceReport(input: {
  targetCounts: E5TargetCounts;
  observedCounts: E5ObservedCounts;
  localCommandReports: readonly E5LocalCommandReport[];
  provider: E5ObservationStatus;
  e3: E5StatusWithMetrics;
  e4: E5E4ObservationStatuses;
  staticClientScan: E5StaticClientScanResult;
  evidenceBindings: readonly E5EvidenceBinding[];
  generatedAt: string;
}): E5AcceptanceReportV1 {
  assertIsoDate(input.generatedAt, "generatedAt");
  assertCountRecord(input.targetCounts, "targetCounts", true);
  assertCountRecord(input.observedCounts, "observedCounts", false);
  assertObservationStatus(input.provider, "provider");
  assertObservationStatus(input.e3.status, "e3.status");
  assertObservationStatus(input.e4.live, "e4.live");
  assertObservationStatus(input.e4.storage, "e4.storage");
  input.e4.aiReviews.forEach((status, index) =>
    assertObservationStatus(status, `e4.aiReviews[${index}]`),
  );
  if (!["passed", "failed", "not_run"].includes(input.staticClientScan.status)) {
    throw new Error("staticClientScan.status is invalid");
  }

  const findings: E5Finding[] = [];
  for (const name of Object.keys(E5_MINIMUM_TARGET_COUNTS) as E5CountName[]) {
    const expected = input.targetCounts[name];
    const actual = input.observedCounts[name];
    if (actual < expected) {
      findings.push({
        code: `E5_${name.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_BELOW_TARGET`,
        status: "incomplete",
        scope: `count:${name}`,
        message: `${name} coverage is below the E5 target.`,
        expected,
        actual,
      });
    }
  }

  const commandNames = new Set<string>();
  for (const report of input.localCommandReports) {
    if (
      !nonEmptyString(report.name) ||
      !nonEmptyString(report.command) ||
      !Number.isInteger(report.exitCode)
    ) {
      throw new Error("local command report is invalid");
    }
    if (commandNames.has(report.name)) {
      throw new Error(`local command report is duplicated: ${report.name}`);
    }
    commandNames.add(report.name);
    if (report.stdoutSha256 !== undefined && !SHA256_PATTERN.test(report.stdoutSha256)) {
      throw new Error("local command stdoutSha256 is invalid");
    }
    if (report.stderrSha256 !== undefined && !SHA256_PATTERN.test(report.stderrSha256)) {
      throw new Error("local command stderrSha256 is invalid");
    }
    if (report.exitCode !== 0) {
      findings.push({
        code: "E5_LOCAL_COMMAND_FAILED",
        status: "failed",
        scope: `command:${report.name}`,
        message: `${report.command} exited with code ${report.exitCode}.`,
        expected: 0,
        actual: report.exitCode,
      });
    }
  }
  for (const requiredName of E5_REQUIRED_LOCAL_COMMAND_NAMES) {
    if (!commandNames.has(requiredName)) {
      findings.push({
        code: "E5_REQUIRED_LOCAL_COMMAND_MISSING",
        status: "incomplete",
        scope: `command:${requiredName}`,
        message: `${requiredName} was not reported.`,
        expected: "reported",
        actual: "missing",
      });
    }
  }

  const providerFinding = observationFinding("provider", input.provider);
  if (providerFinding !== undefined) findings.push(providerFinding);

  const e3Finding = observationFinding("e3", input.e3.status);
  if (e3Finding !== undefined) findings.push(e3Finding);
  for (const [key, metric] of Object.entries(input.e3.metrics)) {
    if (!nonEmptyString(key) || !Number.isFinite(metric)) {
      throw new Error("E3 metrics must contain finite numeric values");
    }
  }

  for (const [scope, status] of [
    ["e4:live", input.e4.live],
    ["e4:storage", input.e4.storage],
    ...input.e4.aiReviews.map(
      (status, index) => [`e4:ai-review:${index + 1}`, status] as const,
    ),
  ] as const) {
    const finding = observationFinding(scope, status);
    if (finding !== undefined) findings.push(finding);
  }
  if (input.e4.aiReviews.length < 2) {
    findings.push({
      code: "E5_E4_AI_REVIEW_COVERAGE_INCOMPLETE",
      status: "incomplete",
      scope: "e4:ai-reviews",
      message: "E4 requires two isolated AI review observations.",
      expected: 2,
      actual: input.e4.aiReviews.length,
    });
  }

  if (
    !isNonNegativeInteger(input.staticClientScan.scannedFiles) ||
    !isNonNegativeInteger(input.staticClientScan.sensitiveMatches)
  ) {
    throw new Error("static client scan counts must be non-negative integers");
  }
  if (input.staticClientScan.status === "not_run") {
    findings.push({
      code: "E5_STATIC_CLIENT_SCAN_NOT_RUN",
      status: "not_run",
      scope: "static-client-scan",
      message: "Static client scanning was not run.",
      expected: "passed",
      actual: "not_run",
    });
  } else if (
    input.staticClientScan.status === "failed" ||
    input.staticClientScan.sensitiveMatches > 0
  ) {
    findings.push({
      code: "E5_STATIC_CLIENT_SCAN_FAILED",
      status: "failed",
      scope: "static-client-scan",
      message: "Static client scanning failed or found sensitive content.",
      expected: 0,
      actual: input.staticClientScan.sensitiveMatches,
    });
  } else if (input.staticClientScan.scannedFiles < 1) {
    findings.push({
      code: "E5_STATIC_CLIENT_SCAN_EMPTY",
      status: "incomplete",
      scope: "static-client-scan",
      message: "Static client scanning reported no inspected files.",
      expected: 1,
      actual: input.staticClientScan.scannedFiles,
    });
  }

  const bindingNames = new Set<string>();
  for (const binding of input.evidenceBindings) {
    if (
      !nonEmptyString(binding.name) ||
      !nonEmptyString(binding.path) ||
      !SHA256_PATTERN.test(binding.sha256) ||
      !["current", "missing", "stale"].includes(binding.status) ||
      bindingNames.has(binding.name)
    ) {
      throw new Error("evidence binding is invalid or duplicated");
    }
    bindingNames.add(binding.name);
    if (binding.status === "missing") {
      findings.push({
        code: "E5_EVIDENCE_BINDING_MISSING",
        status: "incomplete",
        scope: `evidence:${binding.name}`,
        message: `${binding.name} evidence is missing.`,
        expected: "current",
        actual: "missing",
      });
    } else if (binding.status === "stale") {
      findings.push({
        code: "E5_EVIDENCE_BINDING_STALE",
        status: "stale",
        scope: `evidence:${binding.name}`,
        message: `${binding.name} evidence binding is stale.`,
        expected: "current",
        actual: "stale",
      });
    }
  }
  for (const requiredName of E5_REQUIRED_EVIDENCE_BINDING_NAMES) {
    if (!bindingNames.has(requiredName)) {
      findings.push({
        code: "E5_REQUIRED_EVIDENCE_BINDING_MISSING",
        status: "incomplete",
        scope: `evidence:${requiredName}`,
        message: `${requiredName} evidence binding was not reported.`,
        expected: "reported",
        actual: "missing",
      });
    }
  }

  const decision: E5AcceptanceDecision = findings.some(
    ({ status }) => status === "failed",
  )
    ? "reported_with_failures"
    : findings.length > 0
      ? "incomplete"
      : "passed";

  return {
    schemaVersion: E5_FULL_ACCEPTANCE_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    reviewPolicy: "non_blocking",
    decision,
    targetCounts: structuredClone(input.targetCounts),
    observedCounts: structuredClone(input.observedCounts),
    localCommandReports: structuredClone([...input.localCommandReports]),
    provider: input.provider,
    e3: structuredClone(input.e3),
    e4: {
      live: input.e4.live,
      storage: input.e4.storage,
      aiReviews: [...input.e4.aiReviews],
    },
    staticClientScan: structuredClone(input.staticClientScan),
    evidenceBindings: structuredClone([...input.evidenceBindings]),
    findings,
  };
}

function assertAcceptanceReport(value: unknown): asserts value is E5AcceptanceReportV1 {
  if (!isRecord(value)) throw new Error("E5 acceptance report must be an object");
  if (value.schemaVersion !== E5_FULL_ACCEPTANCE_REPORT_SCHEMA_VERSION) {
    throw new Error("E5 acceptance report schemaVersion is invalid");
  }
  if (value.reviewPolicy !== "non_blocking") {
    throw new Error("E5 acceptance report reviewPolicy is invalid");
  }
  if (!["passed", "incomplete", "reported_with_failures"].includes(String(value.decision))) {
    throw new Error("E5 acceptance report decision is invalid");
  }
  assertIsoDate(String(value.generatedAt), "acceptance report generatedAt");
  if (!isRecord(value.targetCounts) || !isRecord(value.observedCounts)) {
    throw new Error("E5 acceptance report counts are invalid");
  }
  assertCountRecord(value.targetCounts as E5TargetCounts, "targetCounts", true);
  assertCountRecord(value.observedCounts as E5ObservedCounts, "observedCounts", false);
  if (!Array.isArray(value.findings)) throw new Error("E5 acceptance findings are invalid");
  value.findings.forEach((finding, index) => {
    if (!isRecord(finding)) throw new Error(`acceptance findings[${index}] is invalid`);
    assertFinding(finding as unknown as E5Finding, `acceptance findings[${index}]`);
  });
  if (
    !Array.isArray(value.localCommandReports) ||
    !isRecord(value.e3) ||
    !isRecord(value.e4) ||
    !Array.isArray(value.e4.aiReviews) ||
    !isRecord(value.staticClientScan) ||
    !Array.isArray(value.evidenceBindings)
  ) {
    throw new Error("E5 acceptance report evidence sections are invalid");
  }
  const reconstructed = buildE5AcceptanceReport({
    targetCounts: value.targetCounts as E5TargetCounts,
    observedCounts: value.observedCounts as E5ObservedCounts,
    localCommandReports: value.localCommandReports as unknown as E5LocalCommandReport[],
    provider: value.provider as E5ObservationStatus,
    e3: value.e3 as unknown as E5StatusWithMetrics,
    e4: value.e4 as unknown as E5E4ObservationStatuses,
    staticClientScan: value.staticClientScan as unknown as E5StaticClientScanResult,
    evidenceBindings: value.evidenceBindings as unknown as E5EvidenceBinding[],
    generatedAt: String(value.generatedAt),
  });
  if (sha256E5Canonical(reconstructed) !== sha256E5Canonical(value)) {
    throw new Error("E5 acceptance report is internally inconsistent");
  }
}

function normalizeArtifactPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function resolveSafeExistingFile(rootDirectory: string, artifactPath: string): string {
  if (!nonEmptyString(artifactPath) || isAbsolute(artifactPath)) {
    throw new Error("E5 release artifact path must be relative");
  }
  const root = realpathSync(resolve(rootDirectory));
  const candidate = resolve(root, artifactPath);
  const lexicalRelative = relative(root, candidate);
  if (
    lexicalRelative === "" ||
    lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new Error("E5 release artifact path must stay inside the release root");
  }
  const realCandidate = realpathSync(candidate);
  const realRelative = relative(root, realCandidate);
  if (
    realRelative === "" ||
    realRelative === ".." ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative)
  ) {
    throw new Error("E5 release artifact path must stay inside the release root");
  }
  if (!statSync(realCandidate).isFile()) {
    throw new Error(`E5 release artifact is not a file: ${artifactPath}`);
  }
  return realCandidate;
}

function bindArtifact(
  rootDirectory: string,
  artifactPath: string,
): E5ReleaseArtifactBinding {
  const resolvedPath = resolveSafeExistingFile(rootDirectory, artifactPath);
  const bytes = readFileSync(resolvedPath);
  return {
    path: normalizeArtifactPath(artifactPath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

function assertSourceState(sourceState: E5SourceState): void {
  if (
    (sourceState.headCommit !== null && !COMMIT_PATTERN.test(sourceState.headCommit)) ||
    typeof sourceState.dirty !== "boolean" ||
    !SHA256_PATTERN.test(sourceState.statusSha256) ||
    !isNonNegativeInteger(sourceState.trackedChanges) ||
    !isNonNegativeInteger(sourceState.untrackedChanges)
  ) {
    throw new Error("E5 sourceState is invalid");
  }
}

function assertProviderObservation(observation: E5ProviderObservation): void {
  if (!Array.isArray(observation.findings) || !observation.findings.every(nonEmptyString)) {
    throw new Error("E5 provider observation findings are invalid");
  }
  if (!['observed', 'not_run', 'failed'].includes(observation.status)) {
    throw new Error("E5 provider observation status is invalid");
  }
  if (
    observation.status === "observed" &&
    (!nonEmptyString(observation.providerName) ||
      !nonEmptyString(observation.configuredModelId) ||
      !nonEmptyString(observation.actualModelId))
  ) {
    throw new Error("observed E5 provider identity is incomplete");
  }
}

export function buildE5RuntimeReleaseManifest(input: {
  rootDirectory: string;
  artifactPaths: readonly string[];
  acceptanceReportPath: string;
  sourceState: E5SourceState;
  providerObservation: E5ProviderObservation;
  qualityFindings: readonly E5Finding[];
  generatedAt: string;
}): E5RuntimeReleaseManifestV1 {
  assertIsoDate(input.generatedAt, "generatedAt");
  assertSourceState(input.sourceState);
  assertProviderObservation(input.providerObservation);
  input.qualityFindings.forEach((finding, index) =>
    assertFinding(finding, `qualityFindings[${index}]`),
  );

  const normalizedPaths = [
    ...input.artifactPaths.map(normalizeArtifactPath),
    normalizeArtifactPath(input.acceptanceReportPath),
  ];
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    const unique = new Set(input.artifactPaths.map(normalizeArtifactPath));
    if (unique.size !== input.artifactPaths.length || unique.has(normalizeArtifactPath(input.acceptanceReportPath))) {
      throw new Error("E5 release artifact paths must be unique");
    }
  }

  const acceptanceArtifact = bindArtifact(input.rootDirectory, input.acceptanceReportPath);
  let acceptanceValue: unknown;
  try {
    acceptanceValue = JSON.parse(
      readFileSync(resolveSafeExistingFile(input.rootDirectory, input.acceptanceReportPath), "utf8"),
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("E5 acceptance report JSON is invalid");
    throw error;
  }
  assertAcceptanceReport(acceptanceValue);
  if (
    sha256E5Canonical(input.qualityFindings) !==
    sha256E5Canonical(acceptanceValue.findings)
  ) {
    throw new Error("E5 manifest quality findings do not match acceptance findings");
  }

  const artifacts = [
    ...input.artifactPaths.map((path) => bindArtifact(input.rootDirectory, path)),
    acceptanceArtifact,
  ].sort((left, right) => left.path.localeCompare(right.path));
  const artifactSetSha256 = sha256E5Canonical(artifacts);
  const withoutSelfHash: Omit<E5RuntimeReleaseManifestV1, "manifestSha256"> = {
    schemaVersion: E5_RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    sourceState: structuredClone(input.sourceState),
    acceptanceReport: {
      ...acceptanceArtifact,
      decision: acceptanceValue.decision,
    },
    providerObservation: structuredClone(input.providerObservation),
    quality: {
      reviewPolicy: "non_blocking",
      findings: structuredClone([...input.qualityFindings]),
    },
    artifacts,
    artifactSetSha256,
  };
  return {
    ...withoutSelfHash,
    manifestSha256: sha256E5Canonical(withoutSelfHash),
  };
}

function assertArtifactBinding(
  artifact: E5ReleaseArtifactBinding,
  field: string,
): void {
  if (
    !nonEmptyString(artifact.path) ||
    !SHA256_PATTERN.test(artifact.sha256) ||
    !isNonNegativeInteger(artifact.size)
  ) {
    throw new Error(`${field} is invalid`);
  }
}

export function verifyE5RuntimeReleaseManifest(
  manifest: E5RuntimeReleaseManifestV1,
  rootDirectory: string,
): {
  artifactCount: number;
  acceptanceDecision: E5AcceptanceDecision;
  providerObservationStatus: E5ProviderObservation["status"];
} {
  if (!isRecord(manifest) || manifest.schemaVersion !== E5_RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION) {
    throw new Error("E5 runtime release manifest schemaVersion is invalid");
  }
  if (Object.hasOwn(manifest, "approvedProviders")) {
    throw new Error("E5 runtime release manifest must not contain approvedProviders");
  }
  assertIsoDate(manifest.generatedAt, "manifest generatedAt");
  assertSourceState(manifest.sourceState);
  assertProviderObservation(manifest.providerObservation);
  if (manifest.quality.reviewPolicy !== "non_blocking") {
    throw new Error("E5 runtime release quality reviewPolicy is invalid");
  }
  manifest.quality.findings.forEach((finding, index) =>
    assertFinding(finding, `quality.findings[${index}]`),
  );
  assertArtifactBinding(manifest.acceptanceReport, "acceptanceReport");
  if (!["passed", "incomplete", "reported_with_failures"].includes(manifest.acceptanceReport.decision)) {
    throw new Error("E5 acceptance report binding decision is invalid");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error("E5 runtime release artifacts are required");
  }
  manifest.artifacts.forEach((artifact, index) =>
    assertArtifactBinding(artifact, `artifacts[${index}]`),
  );

  const { manifestSha256, ...withoutSelfHash } = manifest;
  if (!SHA256_PATTERN.test(manifestSha256) || sha256E5Canonical(withoutSelfHash) !== manifestSha256) {
    throw new Error("E5 runtime release manifest self hash mismatch");
  }
  if (sha256E5Canonical(manifest.artifacts) !== manifest.artifactSetSha256) {
    throw new Error("E5 runtime release artifact set hash mismatch");
  }

  const actualAcceptance = bindArtifact(rootDirectory, manifest.acceptanceReport.path);
  if (
    actualAcceptance.sha256 !== manifest.acceptanceReport.sha256 ||
    actualAcceptance.size !== manifest.acceptanceReport.size
  ) {
    throw new Error("E5 acceptance report binding mismatch");
  }
  let acceptanceValue: unknown;
  try {
    acceptanceValue = JSON.parse(
      readFileSync(resolveSafeExistingFile(rootDirectory, manifest.acceptanceReport.path), "utf8"),
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("E5 acceptance report JSON is invalid");
    throw error;
  }
  assertAcceptanceReport(acceptanceValue);
  if (acceptanceValue.decision !== manifest.acceptanceReport.decision) {
    throw new Error("E5 acceptance report decision binding mismatch");
  }
  if (
    sha256E5Canonical(manifest.quality.findings) !==
    sha256E5Canonical(acceptanceValue.findings)
  ) {
    throw new Error("E5 manifest quality findings binding mismatch");
  }

  const seenPaths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (seenPaths.has(artifact.path)) {
      throw new Error(`E5 release artifact is duplicated: ${artifact.path}`);
    }
    seenPaths.add(artifact.path);
    const actual = bindArtifact(rootDirectory, artifact.path);
    if (actual.sha256 !== artifact.sha256 || actual.size !== artifact.size) {
      throw new Error(`E5 release artifact hash mismatch: ${artifact.path}`);
    }
  }
  if (!seenPaths.has(manifest.acceptanceReport.path)) {
    throw new Error("E5 acceptance report must be included in artifacts");
  }

  return {
    artifactCount: manifest.artifacts.length,
    acceptanceDecision: manifest.acceptanceReport.decision,
    providerObservationStatus: manifest.providerObservation.status,
  };
}
