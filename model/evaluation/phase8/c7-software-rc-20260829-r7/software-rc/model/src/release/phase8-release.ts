import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const PHASE8_CASE_VALIDATION_SCHEMA_VERSION =
  "ai-case-cross-validation-v2" as const;
export const RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION =
  "runtime-release-manifest-v1" as const;

const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const CASE_VALIDATION_CHECKS = [
  "clinicalConsistency",
  "diagnosisSolvability",
  "redFlagExclusions",
  "rubricConsistency",
  "regressionCoverage",
  "hiddenTruthSafety",
] as const;

export type Phase8CaseValidationRole =
  | "clinical_safety"
  | "diagnostic_quality";

export interface Phase8CaseValidationEntryV2 {
  validatorId: string;
  role: Phase8CaseValidationRole;
  modelId: string;
  promptVersion: string;
  validationRunId: string;
  isolation: {
    independentInvocation: boolean;
    counterpartOutputVisible: boolean;
  };
  decision: "approved" | "rejected";
  validatedAt: string;
  checks: Record<(typeof CASE_VALIDATION_CHECKS)[number], "pass" | "fail">;
  findings: string[];
}

export interface Phase8CaseValidationV2 {
  schemaVersion: typeof PHASE8_CASE_VALIDATION_SCHEMA_VERSION;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  decision: "approved" | "rejected";
  validations: Phase8CaseValidationEntryV2[];
}

export interface Phase8CaseValidationBinding {
  caseId: string;
  caseVersion: string;
  contentHash: string;
}

export interface RuntimeReleaseProviderIdentityV1 {
  providerName: string;
  protocol: "openai-responses" | "anthropic-messages";
  endpointSha256: string;
  configuredModelId: string;
  actualModelId: string;
  approvedAt: string;
}

export interface RuntimeReleaseArtifactV1 {
  path: string;
  sha256: string;
  size: number;
}

export interface RuntimeReleaseManifestV1 {
  schemaVersion: typeof RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION;
  artifactRoot?: "model" | "game";
  buildVersion: string;
  generatedAt: string;
  goNoGoDecisionRef: string;
  approvedProviders: RuntimeReleaseProviderIdentityV1[];
  remoteInteractiveEnabled: false;
  shareContract: {
    release: string;
    status: "retained_release_candidate" | "promoted_stable";
    reason: string;
  };
  artifacts: RuntimeReleaseArtifactV1[];
  manifestSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

export function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function phase8ValidationIssues(
  validation: Phase8CaseValidationV2,
  binding: Phase8CaseValidationBinding,
): string[] {
  const issues: string[] = [];
  if (validation.schemaVersion !== PHASE8_CASE_VALIDATION_SCHEMA_VERSION) {
    issues.push("schemaVersion must be ai-case-cross-validation-v2");
  }
  if (
    validation.caseId !== binding.caseId ||
    validation.caseVersion !== binding.caseVersion ||
    validation.contentHash !== binding.contentHash
  ) {
    issues.push("case ID, version, and content hash must match the published case");
  }
  if (!CONTENT_HASH_PATTERN.test(validation.contentHash)) {
    issues.push("contentHash must be sha256:<64 lowercase hex>");
  }
  if (validation.decision !== "approved") {
    issues.push("cross-validation decision must be approved");
  }
  if (!Array.isArray(validation.validations) || validation.validations.length !== 2) {
    issues.push("exactly two validation roles are required");
    return issues;
  }

  const roles = new Set<Phase8CaseValidationRole>();
  const validatorIds = new Set<string>();
  const promptVersions = new Set<string>();
  const validationRunIds = new Set<string>();
  for (const [index, entry] of validation.validations.entries()) {
    const path = `validations[${index}]`;
    if (!STABLE_ID_PATTERN.test(entry.validatorId)) {
      issues.push(`${path}.validatorId must be a stable ID`);
    }
    if (validatorIds.has(entry.validatorId)) {
      issues.push(`${path}.validatorId must be unique`);
    }
    validatorIds.add(entry.validatorId);
    if (entry.role !== "clinical_safety" && entry.role !== "diagnostic_quality") {
      issues.push(`${path}.role is invalid`);
    } else {
      roles.add(entry.role);
    }
    if (!nonEmptyString(entry.modelId)) {
      issues.push(`${path}.modelId is required`);
    }
    if (!nonEmptyString(entry.promptVersion)) {
      issues.push(`${path}.promptVersion is required`);
    } else {
      promptVersions.add(entry.promptVersion);
      const expectedPromptRole = entry.role.replace("_", "-");
      if (!entry.promptVersion.includes(expectedPromptRole)) {
        issues.push(`${path}.promptVersion must be role-specific`);
      }
    }
    if (!STABLE_ID_PATTERN.test(entry.validationRunId)) {
      issues.push(`${path}.validationRunId must be a stable ID`);
    }
    if (validationRunIds.has(entry.validationRunId)) {
      issues.push(`${path}.validationRunId must be unique`);
    }
    validationRunIds.add(entry.validationRunId);
    if (
      entry.isolation.independentInvocation !== true ||
      entry.isolation.counterpartOutputVisible !== false
    ) {
      issues.push(`${path}.isolation must prove a blind independent invocation`);
    }
    if (entry.decision !== "approved") {
      issues.push(`${path}.decision must be approved`);
    }
    if (Number.isNaN(Date.parse(entry.validatedAt))) {
      issues.push(`${path}.validatedAt must be an ISO date-time`);
    }
    for (const check of CASE_VALIDATION_CHECKS) {
      if (entry.checks[check] !== "pass") {
        issues.push(`${path}.checks.${check} must pass`);
      }
    }
    if (
      !Array.isArray(entry.findings) ||
      entry.findings.length === 0 ||
      !entry.findings.every(nonEmptyString)
    ) {
      issues.push(`${path}.findings must contain at least one finding`);
    }
  }
  if (!roles.has("clinical_safety") || !roles.has("diagnostic_quality")) {
    issues.push("clinical_safety and diagnostic_quality roles are both required");
  }
  if (promptVersions.size !== 2) {
    issues.push("the two validators must use different role-specific promptVersion values");
  }
  if (validationRunIds.size !== 2) {
    issues.push("the two validators must use different validationRunId values");
  }
  return issues;
}

export function assertPhase8CaseValidation(
  validation: Phase8CaseValidationV2,
  binding: Phase8CaseValidationBinding,
): void {
  const issues = phase8ValidationIssues(validation, binding);
  if (issues.length > 0) {
    throw new Error(`Phase 8 case validation failed: ${issues.join("; ")}`);
  }
}

function resolveArtifactPath(rootDirectory: string, artifactPath: string): string {
  if (!nonEmptyString(artifactPath) || isAbsolute(artifactPath)) {
    throw new Error("runtime release artifact path must be relative");
  }
  const root = resolve(rootDirectory);
  const resolvedPath = resolve(root, artifactPath);
  const relativePath = relative(root, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("runtime release artifact path must stay inside the release root");
  }
  return resolvedPath;
}

function normalizeArtifactPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function hashArtifact(rootDirectory: string, artifactPath: string): RuntimeReleaseArtifactV1 {
  const resolvedPath = resolveArtifactPath(rootDirectory, artifactPath);
  const stat = statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`runtime release artifact is not a file: ${artifactPath}`);
  }
  const bytes = readFileSync(resolvedPath);
  return {
    path: normalizeArtifactPath(artifactPath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

function manifestHashPayload(
  manifest: Omit<RuntimeReleaseManifestV1, "manifestSha256">,
): string {
  return sha256Canonical(manifest);
}

export function buildRuntimeReleaseManifest(input: {
  rootDirectory: string;
  artifactRoot?: "model" | "game";
  buildVersion: string;
  goNoGoDecisionRef: string;
  provider: RuntimeReleaseProviderIdentityV1;
  remoteInteractiveEnabled: false;
  shareDecision: RuntimeReleaseManifestV1["shareContract"];
  artifactPaths: string[];
  generatedAt?: string;
}): RuntimeReleaseManifestV1 {
  if (!nonEmptyString(input.buildVersion)) throw new Error("buildVersion is required");
  if (!STABLE_ID_PATTERN.test(input.goNoGoDecisionRef)) {
    throw new Error("goNoGoDecisionRef must be a stable ID");
  }
  if (input.remoteInteractiveEnabled !== false) {
    throw new Error("remote interactive mode must remain disabled for the Software RC");
  }
  if (
    !nonEmptyString(input.provider.providerName) ||
    !nonEmptyString(input.provider.configuredModelId) ||
    !nonEmptyString(input.provider.actualModelId) ||
    !HEX_SHA256_PATTERN.test(input.provider.endpointSha256) ||
    Number.isNaN(Date.parse(input.provider.approvedAt))
  ) {
    throw new Error("approved Provider/model identity is invalid");
  }
  if (input.artifactPaths.length === 0) {
    throw new Error("at least one runtime release artifact is required");
  }
  const uniquePaths = new Set(input.artifactPaths.map(normalizeArtifactPath));
  if (uniquePaths.size !== input.artifactPaths.length) {
    throw new Error("runtime release artifact paths must be unique");
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("generatedAt is invalid");
  const withoutHash: Omit<RuntimeReleaseManifestV1, "manifestSha256"> = {
    schemaVersion: RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION,
    ...(input.artifactRoot === undefined ? {} : { artifactRoot: input.artifactRoot }),
    buildVersion: input.buildVersion,
    generatedAt,
    goNoGoDecisionRef: input.goNoGoDecisionRef,
    approvedProviders: [structuredClone(input.provider)],
    remoteInteractiveEnabled: false,
    shareContract: structuredClone(input.shareDecision),
    artifacts: input.artifactPaths
      .map((path) => hashArtifact(input.rootDirectory, path))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  return {
    ...withoutHash,
    manifestSha256: manifestHashPayload(withoutHash),
  };
}

export function verifyRuntimeReleaseManifest(
  manifest: RuntimeReleaseManifestV1,
  rootDirectory: string,
): {
  artifactCount: number;
  providerCount: number;
  remoteInteractiveEnabled: false;
} {
  if (manifest.schemaVersion !== RUNTIME_RELEASE_MANIFEST_SCHEMA_VERSION) {
    throw new Error("runtime release manifest schemaVersion is invalid");
  }
  if (manifest.remoteInteractiveEnabled !== false) {
    throw new Error("runtime release manifest must disable remote interactive mode");
  }
  if (manifest.approvedProviders.length !== 1) {
    throw new Error("runtime release manifest must contain exactly one approved Provider");
  }
  const { manifestSha256, ...withoutHash } = manifest;
  if (manifestHashPayload(withoutHash) !== manifestSha256) {
    throw new Error("runtime release manifest self hash mismatch");
  }
  const seenPaths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (seenPaths.has(artifact.path)) {
      throw new Error(`runtime release artifact is duplicated: ${artifact.path}`);
    }
    seenPaths.add(artifact.path);
    const actual = hashArtifact(rootDirectory, artifact.path);
    if (actual.sha256 !== artifact.sha256 || actual.size !== artifact.size) {
      throw new Error(`runtime release artifact hash mismatch: ${artifact.path}`);
    }
  }
  return {
    artifactCount: manifest.artifacts.length,
    providerCount: manifest.approvedProviders.length,
    remoteInteractiveEnabled: false,
  };
}
