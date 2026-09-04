import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  assertAiCaseCrossReviewV3,
  type AiCaseCrossReviewV3,
} from "../domain/case-package.js";
import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
  OpenAITransportResponse,
} from "../providers/openai-model-provider.js";
import { sha256Canonical } from "../release/phase8-release.js";

const CHECK_COUNT = 6;
const CASE_SCHEMA_PREFIX = "ahamed_phase8_case_";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return error instanceof Error ? error.name : "UNKNOWN_PROVIDER_ERROR";
}

export interface CaseReviewCallAttemptV1 {
  operationId: string;
  clientRequestId: string;
  attempt: number;
  publicCaseId: string;
  role: "clinical_safety" | "diagnostic_quality";
  providerName: string;
  configuredModelId: string;
  actualModelId?: string;
  promptSha256: string;
  inputSha256: string;
  schemaSha256: string;
  caseContentHash: string;
  store: false;
  status: "completed" | "failed_response" | "failed_to_run";
  providerRequestId?: string;
  failureCode?: string;
}

function caseRequestIdentity(request: OpenAITransportRequest): {
  publicCaseId: string;
  role: CaseReviewCallAttemptV1["role"];
  caseContentHash: string;
} | undefined {
  if (!request.schema.name.startsWith(CASE_SCHEMA_PREFIX)) return undefined;
  const role = request.schema.name.includes("clinical_safety")
    ? "clinical_safety"
    : request.schema.name.includes("diagnostic_quality")
      ? "diagnostic_quality"
      : undefined;
  if (role === undefined) return undefined;
  const value = JSON.parse(request.input) as {
    caseContentHash?: unknown;
    casePackage?: { publicCaseId?: unknown };
  };
  if (
    typeof value.caseContentHash !== "string" ||
    typeof value.casePackage?.publicCaseId !== "string"
  ) {
    throw new Error("case review request identity is missing");
  }
  return {
    publicCaseId: value.casePackage.publicCaseId,
    role,
    caseContentHash: value.caseContentHash,
  };
}

export class ObservedCaseReviewTransport implements OpenAIResponsesTransport {
  readonly protocol = "openai-responses";
  readonly providerName: string;
  readonly endpointSha256: string;
  readonly attempts: CaseReviewCallAttemptV1[] = [];
  private readonly attemptsByOperation = new Map<string, number>();

  constructor(private readonly delegate: OpenAIResponsesTransport) {
    this.providerName = delegate.providerName;
    this.endpointSha256 = delegate.endpointSha256;
  }

  async create(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
    const identity = caseRequestIdentity(request);
    if (identity === undefined) return await this.delegate.create(request);
    const attempt = (this.attemptsByOperation.get(request.operationId) ?? 0) + 1;
    this.attemptsByOperation.set(request.operationId, attempt);
    const common = {
      operationId: request.operationId,
      clientRequestId: request.clientRequestId,
      attempt,
      ...identity,
      providerName: this.providerName,
      configuredModelId: request.modelId,
      promptSha256: sha256(request.instructions),
      inputSha256: sha256(request.input),
      schemaSha256: sha256Canonical(request.schema),
      store: false as const,
    };
    try {
      const response = await this.delegate.create(request);
      const completed = response.status === "completed" &&
        response.failureCode === undefined && response.outputText.trim().length > 0;
      this.attempts.push({
        ...common,
        actualModelId: response.modelId,
        status: completed ? "completed" : "failed_response",
        ...(response.requestId === undefined
          ? {}
          : { providerRequestId: response.requestId }),
        ...(completed
          ? {}
          : {
              failureCode:
                response.failureCode ?? "INVALID_PROVIDER_RESPONSE_STATUS",
            }),
      });
      return response;
    } catch (error) {
      this.attempts.push({
        ...common,
        status: "failed_to_run",
        failureCode: errorCode(error),
      });
      throw error;
    }
  }
}

export interface CaseReviewSidecarArtifactV1 {
  publicCaseId: string;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  path: string;
  sha256: string;
}

export interface CaseReviewEvidenceV1 {
  schemaVersion: "case-ai-cross-review-evidence-v1";
  expectedCaseCount: number;
  expectedCompletedCalls: number;
  expectedCheckAssertions: number;
  caseCount: number;
  completedCalls: number;
  checkAssertions: number;
  failedOrSkippedCalls: number;
  status: "complete" | "incomplete";
  configuredModelId: string;
  actualModelId?: string;
  attempts: CaseReviewCallAttemptV1[];
  attemptsSha256: string;
  sidecars: CaseReviewSidecarArtifactV1[];
  sidecarSetSha256: string;
}

function normalizeCaseReviewAttempts(input: {
  attempts: readonly CaseReviewCallAttemptV1[];
  sidecars: readonly CaseReviewSidecarArtifactV1[];
  reviews: readonly AiCaseCrossReviewV3[];
}): CaseReviewCallAttemptV1[] {
  const reviewsByCaseId = new Map(input.reviews.map((review) => [review.caseId, review] as const));
  const validationsByOwner = new Map<string, AiCaseCrossReviewV3["validations"][number]>();
  for (const sidecar of input.sidecars) {
    const review = reviewsByCaseId.get(sidecar.caseId);
    if (
      review === undefined || review.caseVersion !== sidecar.caseVersion ||
      review.contentHash !== sidecar.contentHash
    ) {
      throw new Error(`case review sidecar does not match review: ${sidecar.publicCaseId}`);
    }
    for (const validation of review.validations) {
      validationsByOwner.set(`${sidecar.publicCaseId}:${validation.role}`, validation);
    }
  }
  return input.attempts.map((attempt) => {
    const validation = validationsByOwner.get(`${attempt.publicCaseId}:${attempt.role}`);
    if (validation?.runStatus !== "failed_to_run" || attempt.status !== "completed") {
      return structuredClone(attempt);
    }
    return {
      ...structuredClone(attempt),
      status: "failed_response",
      failureCode: "INVALID_PROVIDER_REVIEW_RESPONSE",
    };
  });
}

export function buildCaseReviewEvidence(input: {
  expectedCaseCount: number;
  configuredModelId: string;
  attempts: readonly CaseReviewCallAttemptV1[];
  sidecars: readonly CaseReviewSidecarArtifactV1[];
  reviews: readonly AiCaseCrossReviewV3[];
}): CaseReviewEvidenceV1 {
  if (
    !Number.isInteger(input.expectedCaseCount) || input.expectedCaseCount < 1 ||
    input.sidecars.length !== input.reviews.length
  ) {
    throw new Error("case review evidence coverage is invalid");
  }
  const completed = input.reviews.flatMap(({ validations }) => validations)
    .filter(({ runStatus }) => runStatus === "completed");
  const completedCalls = completed.length;
  const checkAssertions = completed.reduce(
    (sum, validation) => sum + (validation.checks === undefined ? 0 : CHECK_COUNT),
    0,
  );
  const expectedCompletedCalls = input.expectedCaseCount * 2;
  const expectedCheckAssertions = expectedCompletedCalls * CHECK_COUNT;
  const attempts = normalizeCaseReviewAttempts(input);
  const actualModelIds = new Set(
    attempts
      .filter(({ status }) => status === "completed" || status === "failed_response")
      .map(({ actualModelId }) => actualModelId)
      .filter((modelId): modelId is string => modelId !== undefined),
  );
  return {
    schemaVersion: "case-ai-cross-review-evidence-v1",
    expectedCaseCount: input.expectedCaseCount,
    expectedCompletedCalls,
    expectedCheckAssertions,
    caseCount: input.reviews.length,
    completedCalls,
    checkAssertions,
    failedOrSkippedCalls: input.reviews.flatMap(({ validations }) => validations)
      .filter(({ runStatus }) => runStatus !== "completed").length,
    status:
      input.reviews.length === input.expectedCaseCount &&
        completedCalls === expectedCompletedCalls &&
        checkAssertions === expectedCheckAssertions &&
        actualModelIds.size === 1
        ? "complete"
        : "incomplete",
    configuredModelId: input.configuredModelId,
    ...(actualModelIds.size === 1
      ? { actualModelId: [...actualModelIds][0]! }
      : {}),
    attempts,
    attemptsSha256: sha256Canonical(attempts),
    sidecars: structuredClone([...input.sidecars]),
    sidecarSetSha256: sha256Canonical(input.sidecars),
  };
}

function resolveArtifact(rootDirectory: string, artifactPath: string): string {
  if (isAbsolute(artifactPath)) throw new Error("case review artifact path must be relative");
  const root = realpathSync(rootDirectory);
  const candidate = resolve(root, artifactPath);
  const lexical = relative(root, candidate);
  if (
    lexical === "" || lexical === ".." || lexical.startsWith(`..${sep}`) ||
    isAbsolute(lexical)
  ) {
    throw new Error("case review artifact path escapes the model root");
  }
  const actual = realpathSync(candidate);
  const actualRelative = relative(root, actual);
  if (
    actualRelative === "" || actualRelative === ".." ||
    actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative) ||
    !statSync(actual).isFile()
  ) {
    throw new Error("case review artifact realpath escapes the model root");
  }
  return actual;
}

export function verifyCaseReviewEvidence(
  evidence: CaseReviewEvidenceV1,
  modelRoot: string,
): { caseCount: number; completedCalls: number; checkAssertions: number; status: "complete" | "incomplete" } {
  if (evidence.schemaVersion !== "case-ai-cross-review-evidence-v1") {
    throw new Error("case review evidence schemaVersion is invalid");
  }
  if (sha256Canonical(evidence.attempts) !== evidence.attemptsSha256) {
    throw new Error("case review attempt set hash drifted");
  }
  if (sha256Canonical(evidence.sidecars) !== evidence.sidecarSetSha256) {
    throw new Error("case review sidecar set hash drifted");
  }
  const seenSidecars = new Set<string>();
  const reviews: AiCaseCrossReviewV3[] = [];
  const reviewsByPublicCaseId = new Map<string, AiCaseCrossReviewV3>();
  for (const artifact of evidence.sidecars) {
    if (seenSidecars.has(artifact.publicCaseId) || seenSidecars.has(artifact.path)) {
      throw new Error("case review sidecar identity is duplicated");
    }
    seenSidecars.add(artifact.publicCaseId);
    seenSidecars.add(artifact.path);
    const path = resolveArtifact(modelRoot, artifact.path);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== artifact.sha256) {
      throw new Error(`case review sidecar hash drifted: ${artifact.publicCaseId}`);
    }
    const review = JSON.parse(bytes.toString("utf8")) as AiCaseCrossReviewV3;
    assertAiCaseCrossReviewV3(review, {
      caseId: artifact.caseId,
      caseVersion: artifact.caseVersion,
      contentHash: artifact.contentHash,
    });
    reviews.push(review);
    reviewsByPublicCaseId.set(artifact.publicCaseId, review);
  }
  const rebuilt = buildCaseReviewEvidence({
    expectedCaseCount: evidence.expectedCaseCount,
    configuredModelId: evidence.configuredModelId,
    attempts: evidence.attempts,
    sidecars: evidence.sidecars,
    reviews,
  });
  for (const key of [
    "expectedCompletedCalls", "expectedCheckAssertions", "caseCount",
    "completedCalls", "checkAssertions", "failedOrSkippedCalls", "status",
  ] as const) {
    if (rebuilt[key] !== evidence[key]) {
      throw new Error(`case review evidence metric drifted: ${key}`);
    }
  }
  if (rebuilt.actualModelId !== evidence.actualModelId) {
    throw new Error("case review actual model ID drifted");
  }

  const logicalCalls = new Map<string, CaseReviewCallAttemptV1[]>();
  const clientRequestOwners = new Map<string, string>();
  const operationByOwner = new Map<string, string>();
  const artifactByPublicCaseId = new Map(
    evidence.sidecars.map((artifact) => [artifact.publicCaseId, artifact] as const),
  );
  const promptHashesByRole = new Map<CaseReviewCallAttemptV1["role"], Set<string>>();
  const schemaHashesByRole = new Map<CaseReviewCallAttemptV1["role"], Set<string>>();
  for (const attempt of evidence.attempts) {
    if (
      !["completed", "failed_response", "failed_to_run"].includes(attempt.status) ||
      !Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1 ||
      (attempt.actualModelId !== undefined && attempt.actualModelId.trim().length === 0) ||
      (attempt.failureCode !== undefined && attempt.failureCode.trim().length === 0) ||
      (attempt.status === "completed" &&
        (attempt.actualModelId === undefined || attempt.failureCode !== undefined)) ||
      (attempt.status === "failed_response" &&
        (attempt.actualModelId === undefined || attempt.failureCode === undefined)) ||
      (attempt.status === "failed_to_run" &&
        (attempt.actualModelId !== undefined || attempt.failureCode === undefined))
    ) {
      throw new Error("case review attempt status or response fields are invalid");
    }
    const owner = `${attempt.publicCaseId}:${attempt.role}`;
    const artifact = artifactByPublicCaseId.get(attempt.publicCaseId);
    if (artifact === undefined || artifact.contentHash !== attempt.caseContentHash) {
      throw new Error("case review invocation content hash drifted");
    }
    const existingOperation = operationByOwner.get(owner);
    if (existingOperation !== undefined && existingOperation !== attempt.operationId) {
      throw new Error("case review role was invoked more than once");
    }
    operationByOwner.set(owner, attempt.operationId);
    const existingOwner = clientRequestOwners.get(attempt.clientRequestId);
    if (existingOwner !== undefined && existingOwner !== owner) {
      throw new Error("case review client request ID is duplicated");
    }
    clientRequestOwners.set(attempt.clientRequestId, owner);
    const existing = logicalCalls.get(attempt.operationId) ?? [];
    if (existing.length > 0) {
      const first = existing[0]!;
      if (
        first.publicCaseId !== attempt.publicCaseId || first.role !== attempt.role ||
        first.clientRequestId !== attempt.clientRequestId
      ) {
        throw new Error("case review invocation ID is duplicated");
      }
    }
    existing.push(attempt);
    logicalCalls.set(attempt.operationId, existing);
    if (
      attempt.store !== false || attempt.providerName.trim().length === 0 ||
      attempt.configuredModelId !== evidence.configuredModelId
    ) {
      throw new Error("case review Provider binding drifted");
    }
    const promptHashes = promptHashesByRole.get(attempt.role) ?? new Set<string>();
    promptHashes.add(attempt.promptSha256);
    promptHashesByRole.set(attempt.role, promptHashes);
    const schemaHashes = schemaHashesByRole.get(attempt.role) ?? new Set<string>();
    schemaHashes.add(attempt.schemaSha256);
    schemaHashesByRole.set(attempt.role, schemaHashes);
  }
  if (
    [...promptHashesByRole.values()].some((hashes) => hashes.size !== 1) ||
    [...schemaHashesByRole.values()].some((hashes) => hashes.size !== 1)
  ) {
    throw new Error("case review prompt or response schema drifted");
  }
  const responseModels = new Set(
    evidence.attempts
      .filter(({ status }) => status === "completed" || status === "failed_response")
      .map(({ actualModelId }) => actualModelId),
  );
  if (
    responseModels.has(undefined) || responseModels.size > 1 ||
    (responseModels.size === 1
      ? !responseModels.has(evidence.actualModelId)
      : evidence.actualModelId !== undefined)
  ) {
    throw new Error("case review Provider actual model drifted");
  }
  for (const attempts of logicalCalls.values()) {
    const ordered = attempts.map(({ attempt }) => attempt);
    if (
      attempts.length > 2 ||
      ordered.some((attempt, index) => attempt !== index + 1) ||
      attempts.filter(({ status }) => status === "completed").length > 1
    ) {
      throw new Error("case review retry or invocation sequence is invalid");
    }
  }
  if (operationByOwner.size !== evidence.expectedCompletedCalls) {
    throw new Error("case review invocation coverage drifted");
  }
  for (const artifact of evidence.sidecars) {
    const review = reviewsByPublicCaseId.get(artifact.publicCaseId)!;
    for (const role of ["clinical_safety", "diagnostic_quality"] as const) {
      const validation = review.validations.find((candidate) => candidate.role === role);
      if (validation === undefined) {
        throw new Error("case review sidecar role coverage drifted");
      }
      const operationId = operationByOwner.get(`${artifact.publicCaseId}:${role}`);
      const attempts = operationId === undefined ? [] : logicalCalls.get(operationId) ?? [];
      const completedAttempts = attempts.filter(({ status }) => status === "completed");
      if (validation.runStatus === "completed") {
        if (
          completedAttempts.length !== 1 ||
          completedAttempts[0]!.actualModelId !== validation.modelId
        ) {
          throw new Error("case review completed invocation coverage drifted");
        }
      } else if (
        completedAttempts.length !== 0 ||
        attempts.every(({ status }) => status === "completed")
      ) {
        throw new Error("case review failed invocation coverage drifted");
      }
    }
  }
  return {
    caseCount: evidence.caseCount,
    completedCalls: evidence.completedCalls,
    checkAssertions: evidence.checkAssertions,
    status: evidence.status,
  };
}
