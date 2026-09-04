import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  createRequestFingerprintMaterialV1,
  PUBLIC_ID_PATTERN_V1,
  type IdempotencyOperationV1,
  type SessionPhaseV1,
} from "@ahamed/doctor-game-share";

import type {
  MedicalTestDefinition,
  SupportedCasePackage,
} from "../domain/case-package.js";
import {
  ModelServiceError,
  type ModelServiceErrorCode,
} from "../domain/errors.js";
import {
  assertSessionAcceptsWrites,
  createSessionAggregate,
  expireSessionIfNeeded,
  IDEMPOTENCY_RETENTION_MS,
  SystemClock,
  transitionSession,
  type Clock,
  type SessionAggregate,
  type StoredDisclosedFact,
  type StoredPatientInteractionKind,
  type StoredTestResult,
  type StoredTurnEffect,
} from "../domain/session.js";
import type { EventSink, ModelEvent } from "../observability/event-sink.js";
import { InMemoryModelPersistence } from "../persistence/memory/in-memory-model-persistence.js";
import type {
  IdempotencyRecord,
  ModelPersistence,
  OperationJournalRecord,
  PersistenceTransaction,
} from "../persistence/ports.js";
import type {
  ControllerDecision,
  EvaluationInput,
  MedicalEvaluation,
  ModelProvider,
  PatientAgentOutput,
  ProviderCallRecord,
} from "../providers/model-provider.js";
import {
  ModelProviderIdentityError,
  ModelProviderOutputError,
  ModelProviderRequestError,
} from "../providers/model-provider.js";
import type { CommunicationAssessment } from "../evaluation/scoring-policy-v1.js";
import type { CaseRepository } from "../repositories/case-repository.js";
import { validateEvaluationOutputV1 } from "../safety/evaluation-output-gate.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
  MedicalSafetyPolicyV1,
  type MedicalSafetyInputV1,
  type MedicalSafetyResultV1,
} from "../safety/medical-safety-policy-v1.js";
import { validatePatientOutputV1 } from "../safety/patient-output-gate.js";
import { buildSafePatientCaseView } from "../domain/safe-patient-case-view.js";
import {
  isPromptInjection,
  type PromptInjectionSurfaceV1,
} from "../safety/prompt-injection-policy.js";
import { KeyedSerialExecutor } from "./keyed-serial-executor.js";
import {
  operationBufferHmacMatchesV1,
  operationBufferHmacSha256V1,
  operationBufferSha256V1,
} from "./operation-buffer-integrity.js";
import {
  decryptTurnOperationRequestV1,
  encryptTurnOperationRequestV1,
  type TurnRequestCryptoIdentityV1,
} from "./turn-request-crypto.js";

export interface PublicTestResult extends StoredTestResult {}

export interface PublicSessionView {
  contractVersion: "1";
  sessionId: string;
  caseId: string;
  caseVersion: string;
  patientNpcId: string;
  patientRoleId: string;
  chiefComplaint: string;
  patientDisplay: {
    displayName: string;
    ageBand?: string;
    genderDisplay?: string;
  };
  allowedActions: Array<
    "ask_patient" | "order_test" | "submit_diagnosis"
  >;
  sessionPhase: SessionPhaseV1;
}

export interface PublicSessionProjection {
  sessionId: string;
  caseVersion: string;
  initialPresentation: string;
  disclosedFacts: StoredDisclosedFact[];
  completedTests: PublicTestResult[];
  turnCount: number;
  turnLimit: number;
  sessionPhase: SessionPhaseV1;
}

export interface TurnCompleted {
  sessionId: string;
  turnId: string;
  reply: string;
  disclosedFactIds: string[];
  effects: TurnEffect[];
  turnNumber: number;
  sessionPhase: "active";
  diagnosisSubmission?: {
    primaryDiagnosis: string;
    differentials: string[];
  };
}

export type TurnEffect = StoredTurnEffect;

export type EvaluationCompleted = Omit<MedicalEvaluation, "scores"> & {
  scores: Omit<MedicalEvaluation["scores"], "communication" | "total"> & {
    communication: number;
    total: number;
  };
  sessionId: string;
  caseVersion: string;
  sessionPhase: "completed";
  completedAt: string;
};

export interface IdGenerator {
  next(prefix: string): string;
}

export interface ModelServiceOptions {
  persistence?: ModelPersistence;
  clock?: Clock;
  recoverOnStartup?: boolean;
  defaultIdempotencyScopeId?: string;
  medicalSafetyPolicy?: {
    evaluate(input: {
      text: string;
      context?: MedicalSafetyInputV1["context"];
    }): MedicalSafetyResultV1;
  };
  safetyAuditHmacKey?: string;
  onEventSinkError?: (
    error: unknown,
    event: ModelEvent,
  ) => void | Promise<void>;
}

export type RecoveryAction =
  | "commit-buffered"
  | "retry-same-provider"
  | "fail";

interface TurnBufferPayload {
  text: string;
  action: "ask_patient" | "repeat" | "other";
  requestedFactIds: string[];
  createdAt: string;
  disclosedFacts: StoredDisclosedFact[];
  response: TurnCompleted;
  patientAgentOutput?: PatientAgentOutput;
  legacyV3Shape?: true;
  legacyPreEffectsShape?: true;
}

interface EvaluationBufferPayload {
  response: EvaluationCompleted;
  communicationAssessment: CommunicationAssessment;
}

interface DispatchFence {
  leaseToken: string;
  attemptCount: number;
}

class UuidGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

function publicTestResult(
  testId: string,
  definition: MedicalTestDefinition,
): PublicTestResult {
  return {
    testId,
    status: definition.status,
    ...(definition.report === undefined ? {} : { report: definition.report }),
    ...(definition.assetId === undefined ? {} : { assetId: definition.assetId }),
    ...(definition.reasonCode === undefined
      ? {}
      : { reasonCode: definition.reasonCode }),
  };
}

interface DeterministicTestExecution {
  result: PublicTestResult;
  effect: TurnEffect;
}

function deterministicTestExecution(
  testId: string,
  definition: MedicalTestDefinition | undefined,
): DeterministicTestExecution {
  if (definition === undefined) {
    const reasonCode = "TEST_NOT_AVAILABLE";
    return {
      result: { testId, status: "unavailable", reasonCode },
      effect: { type: "test_unavailable", testId, reasonCode },
    };
  }
  const result = publicTestResult(testId, definition);
  return result.status === "completed"
    ? {
        result,
        effect: { type: "test_completed", result: structuredClone(result) },
      }
    : {
        result,
        effect: {
          type: "test_unavailable",
          testId,
          reasonCode: result.reasonCode ?? "TEST_UNAVAILABLE",
        },
      };
}

function applyCompletedTestResult(
  session: SessionAggregate,
  result: StoredTestResult,
): void {
  if (result.status !== "completed") return;
  const index = session.completedTests.findIndex(
    ({ testId }) => testId === result.testId,
  );
  if (index >= 0) session.completedTests[index] = structuredClone(result);
  else session.completedTests.push(structuredClone(result));
}

function turnEffectsForPatientOutput(
  output: PatientAgentOutput,
  casePackage: SupportedCasePackage,
): TurnEffect[] {
  return output.requestedTestId === undefined
    ? []
    : [
        deterministicTestExecution(
          output.requestedTestId,
          casePackage.medicalTests[output.requestedTestId],
        ).effect,
      ];
}

function diagnosisSubmissionForPatientOutput(
  output: PatientAgentOutput,
): TurnCompleted["diagnosisSubmission"] {
  const intent = output.diagnosisIntent;
  return intent?.decision === "submit_diagnosis"
    ? {
        primaryDiagnosis: intent.primaryDiagnosis,
        differentials: [...intent.differentialDiagnoses],
      }
    : undefined;
}

function normalizeSafetyText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function requestFingerprint(
  operation: IdempotencyOperationV1,
  scopeId: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(createRequestFingerprintMaterialV1(operation, scopeId, payload))
    .digest("hex");
}

function safetyRequestFingerprint(
  operation: IdempotencyOperationV1,
  scopeId: string,
  payload: unknown,
  key: string,
): string {
  return `hmac-sha256:${createHmac("sha256", key)
    .update(createRequestFingerprintMaterialV1(operation, scopeId, payload))
    .digest("hex")}`;
}

function asServiceError(error: unknown): ModelServiceError {
  if (error instanceof ModelServiceError) {
    return error;
  }
  if (error instanceof ModelProviderOutputError) {
    return new ModelServiceError(
      "MODEL_OUTPUT_REJECTED",
      "The model provider returned invalid output.",
    );
  }
  if (error instanceof ModelProviderIdentityError) {
    return new ModelServiceError(
      "OPERATION_RECOVERY_REQUIRED",
      "The configured provider identity changed during the operation.",
    );
  }
  if (error instanceof ModelProviderRequestError) {
    return new ModelServiceError(
      "MODEL_UNAVAILABLE",
      "The model provider is unavailable.",
      { retryable: error.retryable },
    );
  }
  return new ModelServiceError(
    "MODEL_UNAVAILABLE",
    "The model provider is unavailable.",
    { retryable: true },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeHistoricalTurnCompleted(
  value: TurnCompleted,
): TurnCompleted {
  if (!Object.hasOwn(value, "effects")) {
    return {
      ...structuredClone(value),
      effects: [],
    };
  }
  return value;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isUniqueStringArray(value: unknown): value is string[] {
  return isStringArray(value) && new Set(value).size === value.length;
}

function readTurnDiagnosisSubmission(
  value: unknown,
): TurnCompleted["diagnosisSubmission"] {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["primaryDiagnosis", "differentials"]) ||
    typeof value["primaryDiagnosis"] !== "string" ||
    value["primaryDiagnosis"].trim().length === 0 ||
    value["primaryDiagnosis"].length > 200 ||
    !isUniqueStringArray(value["differentials"]) ||
    value["differentials"].length > 5 ||
    value["differentials"].some(
      (item) => item.trim().length === 0 || item.length > 200,
    )
  ) {
    corruptOperation("Turn diagnosis submission is invalid.");
  }
  return {
    primaryDiagnosis: value["primaryDiagnosis"],
    differentials: [...value["differentials"]],
  };
}

const MAX_ID_LENGTH = 256;
const MAX_TURN_TEXT_LENGTH = 1_000;
const MAX_MEDICAL_TURNS = 20;
const MAX_SESSION_INTERACTIONS = MAX_MEDICAL_TURNS + 5;
const MAX_DIAGNOSIS_LENGTH = 256;
const MAX_DIFFERENTIALS = 10;
const OPERATION_LEASE_MS = 5 * 60 * 1_000;

function assertBoundedString(
  value: string,
  field: string,
  maxLength: number,
): void {
  if (value.trim().length === 0 || value.length > maxLength) {
    throw new ModelServiceError(
      "INVALID_REQUEST",
      `${field} must contain between 1 and ${maxLength} characters.`,
    );
  }
}

const PUBLIC_ID_PATTERN = new RegExp(PUBLIC_ID_PATTERN_V1, "u");

function assertPublicId(value: string, field: string): void {
  if (!PUBLIC_ID_PATTERN.test(value)) {
    throw new ModelServiceError(
      "INVALID_REQUEST",
      `${field} must match the shared v1 public ID contract.`,
    );
  }
}

interface LocalSafetyInterruption {
  code:
    | "SAFETY_PROMPT_INJECTION"
    | "SAFETY_REAL_HEALTH_INPUT"
    | "SAFETY_INTERRUPTED";
  decision: Exclude<MedicalSafetyResultV1["decision"], "ALLOW_GAME">;
  policyVersion: string;
  ruleIds: string[];
  templateId: string;
  responseText: string;
}

class ProviderSafetyInterruptionError extends ModelServiceError {
  constructor(
    readonly interruption: LocalSafetyInterruption,
    readonly audit: { textLength: number; inputHmac: string },
  ) {
    super(interruption.code, interruption.responseText);
  }
}

function promptInjectionInterruption(): LocalSafetyInterruption {
  return {
    code: "SAFETY_PROMPT_INJECTION",
    decision: "EXIT_FAIL_CLOSED",
    policyVersion: "prompt-injection-policy-v1",
    ruleIds: ["security.prompt_injection.v1"],
    templateId: "security.prompt-injection.zh-CN.v1",
    responseText: "该输入尝试改变角色或索要受保护内容，本次不会进入病例模拟或外部模型。请继续询问虚构患者的病史。",
  };
}

function providerSafetyInterruption(
  code: "SAFETY_PROMPT_INJECTION" | "SAFETY_REAL_HEALTH_INPUT",
): LocalSafetyInterruption {
  if (code === "SAFETY_PROMPT_INJECTION") {
    return promptInjectionInterruption();
  }
  const template = MEDICAL_SAFETY_TEMPLATES_V1.EXIT_REAL_HEALTH;
  return {
    code,
    decision: "EXIT_REAL_HEALTH",
    policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
    ruleIds: ["safety.provider_controller.real_health_fallback"],
    templateId: template.templateId,
    responseText: template.text,
  };
}

function failClosedMedicalSafetyResult(): MedicalSafetyResultV1 {
  const template = MEDICAL_SAFETY_TEMPLATES_V1.EXIT_FAIL_CLOSED;
  return {
    decision: "EXIT_FAIL_CLOSED",
    policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
    ruleIds: ["safety.policy.invalid_result"],
    templateId: template.templateId,
    responseText: template.text,
  };
}

function isValidMedicalSafetyResult(
  value: unknown,
): value is MedicalSafetyResultV1 {
  if (!isRecord(value)) return false;
  const decision = value["decision"];
  if (
    ![
      "ALLOW_GAME",
      "EXIT_SELF_HARM_CRISIS",
      "EXIT_URGENT_RED_FLAG",
      "EXIT_OUT_OF_SCOPE",
      "EXIT_REAL_HEALTH",
      "EXIT_FAIL_CLOSED",
    ].includes(String(decision)) ||
    value["policyVersion"] !== MEDICAL_SAFETY_POLICY_VERSION_V1 ||
    !isUniqueStringArray(value["ruleIds"]) ||
    value["ruleIds"].length === 0 ||
    value["ruleIds"].some((ruleId) => ruleId.trim().length === 0) ||
    typeof value["templateId"] !== "string" ||
    typeof value["responseText"] !== "string"
  ) {
    return false;
  }
  const template = MEDICAL_SAFETY_TEMPLATES_V1[
    decision as MedicalSafetyResultV1["decision"]
  ];
  return (
    value["templateId"] === template.templateId &&
    value["responseText"] === template.text
  );
}

function localSafetyInterruption(
  text: string,
  policy: {
    evaluate(input: {
      text: string;
      context?: MedicalSafetyInputV1["context"];
    }): MedicalSafetyResultV1;
  },
  surface: PromptInjectionSurfaceV1 = "turn",
): LocalSafetyInterruption | undefined {
  let medicalResult: MedicalSafetyResultV1;
  try {
    const candidate: unknown = policy.evaluate({
      text,
      context: surface === "diagnosis_submission"
        ? "fictional_diagnosis_submission"
        : "fictional_case_session",
    });
    medicalResult = isValidMedicalSafetyResult(candidate)
      ? candidate
      : failClosedMedicalSafetyResult();
  } catch {
    medicalResult = failClosedMedicalSafetyResult();
  }
  if (medicalResult.decision !== "ALLOW_GAME") {
    return {
      code: medicalResult.decision === "EXIT_REAL_HEALTH"
        ? "SAFETY_REAL_HEALTH_INPUT"
        : "SAFETY_INTERRUPTED",
      decision: medicalResult.decision,
      policyVersion: medicalResult.policyVersion,
      ruleIds: [...medicalResult.ruleIds],
      templateId: medicalResult.templateId,
      responseText: medicalResult.responseText,
    };
  }
  if (isPromptInjection(text, surface)) {
    return promptInjectionInterruption();
  }
  return undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readTurnEffects(value: unknown): TurnEffect[] {
  if (!Array.isArray(value)) {
    corruptOperation("Turn effects must be an array.");
  }
  return value.map((effect): TurnEffect => {
    if (!isRecord(effect) || typeof effect["type"] !== "string") {
      corruptOperation("Turn effect is invalid.");
    }
    if (effect["type"] === "test_unavailable") {
      if (
        !hasExactKeys(effect, ["type", "testId", "reasonCode"]) ||
        typeof effect["testId"] !== "string" ||
        typeof effect["reasonCode"] !== "string" ||
        effect["reasonCode"].trim().length === 0
      ) {
        corruptOperation("Unavailable test effect is invalid.");
      }
      return {
        type: "test_unavailable",
        testId: effect["testId"],
        reasonCode: effect["reasonCode"],
      };
    }
    if (
      effect["type"] !== "test_completed" ||
      !hasExactKeys(effect, ["type", "result"]) ||
      !isRecord(effect["result"])
    ) {
      corruptOperation("Completed test effect is invalid.");
    }
    const result = effect["result"];
    if (
      !hasExactKeys(
        result,
        ["testId", "status"],
        ["report", "assetId", "reasonCode"],
      ) ||
      typeof result["testId"] !== "string" ||
      result["status"] !== "completed" ||
      (result["report"] !== undefined && typeof result["report"] !== "string") ||
      (result["assetId"] !== undefined && typeof result["assetId"] !== "string") ||
      (result["reasonCode"] !== undefined &&
        typeof result["reasonCode"] !== "string")
    ) {
      corruptOperation("Completed test result is invalid.");
    }
    return {
      type: "test_completed",
      result: {
        testId: result["testId"],
        status: "completed",
        ...(result["report"] === undefined
          ? {}
          : { report: result["report"] as string }),
        ...(result["assetId"] === undefined
          ? {}
          : { assetId: result["assetId"] as string }),
        ...(result["reasonCode"] === undefined
          ? {}
          : { reasonCode: result["reasonCode"] as string }),
      },
    };
  });
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function corruptOperation(message: string): never {
  throw new ModelServiceError("OPERATION_RECOVERY_REQUIRED", message);
}

function turnRequestCryptoIdentity(
  operation: OperationJournalRecord,
): TurnRequestCryptoIdentityV1 {
  return {
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    idempotencyKey: operation.idempotencyKey,
    requestHash: operation.requestHash,
    providerName: operation.providerName,
    modelId: operation.modelId,
    promptVersion: operation.promptVersion,
    caseVersion: operation.caseVersion,
  };
}

function readTurnOperationRequest(
  operation: OperationJournalRecord,
  key: string,
): { text: string; clientTurnId: string } {
  try {
    return decryptTurnOperationRequestV1(
      turnRequestCryptoIdentity(operation),
      operation.request,
      key,
    );
  } catch {
    corruptOperation("Turn operation request is invalid.");
  }
}

function readTurnBufferPayload(
  value: unknown,
  operation: OperationJournalRecord,
  session: SessionAggregate,
): TurnBufferPayload {
  if (!isRecord(value) || !isRecord(value["response"])) {
    corruptOperation("Turn buffer payload is invalid.");
  }
  const response = value["response"];
  const diagnosisSubmission = readTurnDiagnosisSubmission(
    response["diagnosisSubmission"],
  );
  const legacyPreEffectsShape = !Object.hasOwn(response, "effects");
  const effects = legacyPreEffectsShape
    ? []
    : readTurnEffects(response["effects"]);
  let action = value["action"];
  let requestedFactIds = value["requestedFactIds"];
  let legacyV3Shape = false;
  if (
    action === undefined &&
    requestedFactIds === undefined &&
    isUniqueStringArray(response["disclosedFactIds"])
  ) {
    legacyV3Shape = true;
    const legacyRequestedFactIds = [...response["disclosedFactIds"]];
    requestedFactIds = legacyRequestedFactIds;
    const disclosedBefore = new Set(
      session.disclosedFacts.map(({ factId }) => factId),
    );
    action = legacyRequestedFactIds.length === 0
      // Phase 3 committed every accepted turn, including an empty fact match.
      // Preserve that persisted result when recovering a legacy validated buffer.
      ? "ask_patient"
      : legacyRequestedFactIds.every((factId) => disclosedBefore.has(factId))
        ? "repeat"
        : "ask_patient";
  }
  const facts = value["disclosedFacts"];
  if (
    typeof value["text"] !== "string" ||
    !["ask_patient", "repeat", "other"].includes(String(action)) ||
    !isUniqueStringArray(requestedFactIds) ||
    !isValidDateString(value["createdAt"]) ||
    !Array.isArray(facts) ||
    !facts.every(
      (fact) =>
        isRecord(fact) &&
        typeof fact["factId"] === "string" &&
        typeof fact["displayText"] === "string" &&
        Number.isSafeInteger(fact["disclosedAtTurn"]) &&
        Number(fact["disclosedAtTurn"]) > 0,
    ) ||
    response["sessionId"] !== operation.sessionId ||
    typeof response["turnId"] !== "string" ||
    typeof response["reply"] !== "string" ||
    !isStringArray(response["disclosedFactIds"]) ||
    !Number.isSafeInteger(response["turnNumber"]) ||
    response["turnNumber"] !== session.turnCount + 1 ||
    response["sessionPhase"] !== "active"
  ) {
    corruptOperation("Turn buffer payload is invalid.");
  }
  return {
    text: value["text"],
    action: action as TurnBufferPayload["action"],
    requestedFactIds: [...requestedFactIds],
    createdAt: value["createdAt"],
    disclosedFacts: facts.map((fact) => ({
      factId: fact["factId"] as string,
      displayText: fact["displayText"] as string,
      disclosedAtTurn: fact["disclosedAtTurn"] as number,
    })),
    response: {
      sessionId: response["sessionId"] as string,
      turnId: response["turnId"] as string,
      reply: response["reply"] as string,
      disclosedFactIds: [...(response["disclosedFactIds"] as string[])],
      effects,
      turnNumber: response["turnNumber"] as number,
      sessionPhase: "active",
      ...(diagnosisSubmission === undefined ? {} : { diagnosisSubmission }),
    },
    ...(isRecord(value["patientAgentOutput"])
      ? {
          patientAgentOutput: structuredClone(
            value["patientAgentOutput"],
          ) as unknown as PatientAgentOutput,
        }
      : {}),
    ...(legacyV3Shape ? { legacyV3Shape: true } : {}),
    ...(legacyPreEffectsShape ? { legacyPreEffectsShape: true } : {}),
  };
}

function assertTurnOperationRequestMatches(
  operation: OperationJournalRecord,
  payload: TurnBufferPayload,
  key: string,
): void {
  const request = readTurnOperationRequest(operation, key);
  const hmacFingerprint = safetyRequestFingerprint(
    "submit_turn",
    operation.sessionId,
    { text: request.text },
    key,
  );
  if (
    request.clientTurnId !== operation.idempotencyKey ||
    payload.text !== request.text ||
    operation.requestHash !== hmacFingerprint
  ) {
    corruptOperation("Turn buffer does not match the immutable request.");
  }
}

function assertEvaluationOperationRequestMatches(
  operation: OperationJournalRecord,
  session: SessionAggregate,
): void {
  const request = operation.request;
  const submission = session.diagnosisSubmission;
  if (
    !isRecord(request) ||
    !hasExactKeys(request, ["primaryDiagnosis", "differentials"]) ||
    typeof request["primaryDiagnosis"] !== "string" ||
    !isStringArray(request["differentials"]) ||
    submission === undefined ||
    request["primaryDiagnosis"] !== submission.primaryDiagnosis ||
    !isDeepStrictEqual(request["differentials"], submission.differentials) ||
    operation.requestHash !== submission.fingerprint ||
    operation.requestHash !==
      requestFingerprint("submit_diagnosis", operation.sessionId, {
        primaryDiagnosis: request["primaryDiagnosis"],
        differentials: request["differentials"],
      })
  ) {
    corruptOperation("Evaluation buffer does not match the immutable request.");
  }
}

function validateAndRebuildTurnBufferPayload(
  payload: TurnBufferPayload,
  session: SessionAggregate,
  casePackage: SupportedCasePackage,
): TurnBufferPayload {
  const askableFactIds = new Set(
    Object.entries(casePackage.patientFacts)
      .filter(([, fact]) =>
        fact.disclosure === "if_asked" || fact.disclosure === "spontaneous"
      )
      .map(([factId]) => factId),
  );
  const disclosedBefore = new Set(
    session.disclosedFacts.map(({ factId }) => factId),
  );
  if (
    session.disclosedFacts.some((fact) => {
      const source = casePackage.patientFacts[fact.factId];
      return (
        !askableFactIds.has(fact.factId) ||
        source === undefined ||
        source.value !== fact.displayText
      );
    })
  ) {
    corruptOperation(
      "Stored disclosed facts no longer match the immutable case package.",
    );
  }
  const factsUsed = payload.response.disclosedFactIds;
  const hasInvalidFactReference =
    payload.requestedFactIds.some((factId) => !askableFactIds.has(factId)) ||
    !isUniqueStringArray(factsUsed) ||
    factsUsed.some(
      (factId) =>
        !askableFactIds.has(factId) ||
        !payload.requestedFactIds.includes(factId),
    );
  if (hasInvalidFactReference) {
    corruptOperation(
      "Validated turn buffer references facts outside the current case allowlist.",
    );
  }
  const expectedNewFacts = factsUsed
    .filter((factId) => !disclosedBefore.has(factId))
    .map((factId) => ({
      factId,
      displayText: casePackage.patientFacts[factId]!.value,
      disclosedAtTurn: payload.response.turnNumber,
    }));
  if (payload.patientAgentOutput !== undefined) {
    const safeCaseView = buildSafePatientCaseView(
      casePackage,
      session.completedTests,
    );
    let validatedOutput: PatientAgentOutput;
    try {
      validatedOutput = validatePatientOutputV1(payload.patientAgentOutput, {
        casePackage,
        safeCaseView,
        userText: payload.text,
      });
    } catch {
      corruptOperation(
        "Validated Patient Agent output no longer passes the safe case gate.",
      );
    }
    const expectedPatientAction: TurnBufferPayload["action"] =
      validatedOutput.interactionKind === "social_chat"
        ? "other"
        : validatedOutput.factIdsUsed.length > 0 &&
            validatedOutput.factIdsUsed.every((factId) =>
              disclosedBefore.has(factId)
            )
          ? "repeat"
          : "ask_patient";
    const expectedEffects = payload.legacyPreEffectsShape === true
      ? []
      : turnEffectsForPatientOutput(validatedOutput, casePackage);
    const expectedDiagnosisSubmission =
      diagnosisSubmissionForPatientOutput(validatedOutput);
    if (
      payload.action !== expectedPatientAction ||
      !isDeepStrictEqual(
        payload.requestedFactIds,
        validatedOutput.factIdsUsed,
      ) ||
      !isDeepStrictEqual(factsUsed, validatedOutput.factIdsUsed) ||
      !isDeepStrictEqual(payload.disclosedFacts, expectedNewFacts) ||
      payload.response.reply !== validatedOutput.reply ||
      !isDeepStrictEqual(payload.response.effects, expectedEffects) ||
      !isDeepStrictEqual(
        payload.response.diagnosisSubmission,
        expectedDiagnosisSubmission,
      )
    ) {
      corruptOperation(
        "Validated turn buffer no longer matches its Patient Agent output.",
      );
    }
    return {
      ...payload,
      action: expectedPatientAction,
      requestedFactIds: [...validatedOutput.factIdsUsed],
      disclosedFacts: expectedNewFacts,
      patientAgentOutput: validatedOutput,
      response: {
        ...payload.response,
        reply: validatedOutput.reply,
        disclosedFactIds: [...validatedOutput.factIdsUsed],
        effects: structuredClone(expectedEffects),
        ...(expectedDiagnosisSubmission === undefined
          ? {}
          : {
              diagnosisSubmission: structuredClone(
                expectedDiagnosisSubmission,
              ),
            }),
      },
    };
  }
  corruptOperation(
    "Legacy turn buffers without a validated Patient Agent output cannot be replayed.",
  );
}

function assertEvaluationBufferPayload(
  value: unknown,
  operation: OperationJournalRecord,
  session: SessionAggregate,
  casePackage: SupportedCasePackage,
): asserts value is EvaluationBufferPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["response", "communicationAssessment"]) ||
    !isRecord(value["response"]) ||
    !isRecord(value["communicationAssessment"])
  ) {
    corruptOperation("Evaluation buffer payload is invalid.");
  }
  const response = value["response"];
  if (
    !hasExactKeys(response, [
      "diagnosis",
      "scores",
      "evidence",
      "summary",
      "evaluationVersion",
      "sessionId",
      "caseVersion",
      "sessionPhase",
      "completedAt",
    ]) ||
    response["sessionId"] !== operation.sessionId ||
    response["caseVersion"] !== session.caseVersion ||
    response["sessionPhase"] !== "completed" ||
    !isValidDateString(response["completedAt"])
  ) {
    corruptOperation("Evaluation buffer payload is invalid.");
  }
  const candidate = {
    diagnosis: response["diagnosis"],
    scores: response["scores"],
    evidence: response["evidence"],
    summary: response["summary"],
    evaluationVersion: response["evaluationVersion"],
    communicationAssessment: value["communicationAssessment"],
  };
  try {
    const validated = validateEvaluationOutputV1(
      candidate,
      evaluationInputForSession(session, casePackage),
      session.evaluationVersion,
    );
    const { communicationAssessment, ...candidateEvaluation } = candidate;
    if (
      !isDeepStrictEqual(candidateEvaluation, validated.evaluation) ||
      !isDeepStrictEqual(
        communicationAssessment,
        validated.communicationAssessment,
      )
    ) {
      corruptOperation("Evaluation buffer payload is invalid.");
    }
  } catch {
    corruptOperation("Evaluation buffer payload is invalid.");
  }
}

function assertCompletedEvaluationForRead(
  value: unknown,
  session: SessionAggregate,
): asserts value is EvaluationCompleted {
  if (!isRecord(value)) {
    throw new ModelServiceError(
      "INVALID_SESSION_STATE",
      "The completed evaluation is unavailable.",
    );
  }
  const diagnosis = value["diagnosis"];
  const scores = value["scores"];
  const evidence = value["evidence"];
  const scoreKeys = [
    "diagnosis",
    "historyCoverage",
    "differentialReasoning",
    "testSelection",
    "efficiency",
    "communication",
    "total",
  ] as const;
  if (
    !hasExactKeys(value, [
      "diagnosis",
      "scores",
      "evidence",
      "summary",
      "evaluationVersion",
      "sessionId",
      "caseVersion",
      "sessionPhase",
      "completedAt",
    ]) ||
    !isRecord(diagnosis) ||
    !hasExactKeys(
      diagnosis,
      ["correct", "explanation"],
      ["matchType"],
    ) ||
    typeof diagnosis["correct"] !== "boolean" ||
    typeof diagnosis["explanation"] !== "string" ||
    (diagnosis["matchType"] !== undefined &&
      diagnosis["matchType"] !== "exact" &&
      diagnosis["matchType"] !== "synonym" &&
      diagnosis["matchType"] !== "semantic") ||
    !isRecord(scores) ||
    !hasExactKeys(scores, scoreKeys) ||
    scoreKeys.some(
      (key) =>
        typeof scores[key] !== "number" ||
        !Number.isInteger(scores[key]) ||
        Number(scores[key]) < 0 ||
        Number(scores[key]) > 100,
    ) ||
    !Array.isArray(evidence) ||
    !evidence.every(
      (item) =>
        isRecord(item) &&
        typeof item["criterionId"] === "string" &&
        (item["outcome"] === "met" ||
          item["outcome"] === "partial" ||
          item["outcome"] === "missed" ||
          item["outcome"] === "not_applicable") &&
        typeof item["explanation"] === "string" &&
        (item["supportingTurnIds"] === undefined ||
          isStringArray(item["supportingTurnIds"])) &&
        (item["supportingTestIds"] === undefined ||
          isStringArray(item["supportingTestIds"])),
    ) ||
    typeof value["summary"] !== "string" ||
    value["evaluationVersion"] !== session.evaluationVersion ||
    value["sessionId"] !== session.sessionId ||
    value["caseVersion"] !== session.caseVersion ||
    value["sessionPhase"] !== "completed" ||
    !isValidDateString(value["completedAt"])
  ) {
    throw new ModelServiceError(
      "INVALID_SESSION_STATE",
      "The completed evaluation is invalid.",
    );
  }
}

function assertControllerDecision(
  value: unknown,
): asserts value is ControllerDecision {
  if (!isRecord(value) || !isUniqueStringArray(value["requestedFactIds"])) {
    throw new ModelServiceError(
      "MODEL_OUTPUT_REJECTED",
      "Controller output failed validation.",
    );
  }
  const valid =
    (value["action"] === "ask_patient" &&
      hasExactKeys(value, ["action", "requestedFactIds"])) ||
    (value["action"] === "other" &&
      value["requestedFactIds"].length === 0 &&
      hasExactKeys(value, ["action", "requestedFactIds"])) ||
    (value["action"] === "unsafe" &&
      value["requestedFactIds"].length === 0 &&
      ["SAFETY_PROMPT_INJECTION", "SAFETY_REAL_HEALTH_INPUT"].includes(
        String(value["safetyCode"]),
      ) &&
      hasExactKeys(value, ["action", "requestedFactIds", "safetyCode"]));
  if (!valid) {
    throw new ModelServiceError(
      "MODEL_OUTPUT_REJECTED",
      "Controller output failed validation.",
    );
  }
}

function evaluationInputForSession(
  session: SessionAggregate,
  casePackage: SupportedCasePackage,
): EvaluationInput {
  if (session.diagnosisSubmission === undefined) {
    corruptOperation("Evaluation session is missing its diagnosis submission.");
  }
  return {
    casePackage,
    primaryDiagnosis: session.diagnosisSubmission.primaryDiagnosis,
    differentials: [...session.diagnosisSubmission.differentials],
    disclosedFactIds: session.disclosedFacts.map(({ factId }) => factId),
    completedTestIds: session.completedTests.map(({ testId }) => testId),
    turnIds: session.turns.map(({ turnId }) => turnId),
    turns: session.turns.map(({ turnId, text, reply }) => ({
      turnId,
      text,
      reply,
    })),
    completedTests: session.completedTests.map((test) => structuredClone(test)),
    medicalTurnCount: session.medicalTurnCount,
    repeatTurnCount: session.repeatTurnCount,
    otherTurnCount: session.otherTurnCount,
  };
}

function validateAndNormalizeMedicalEvaluation(
  value: unknown,
  input: EvaluationInput,
  session: SessionAggregate,
): ReturnType<typeof validateEvaluationOutputV1> {
  return validateEvaluationOutputV1(
    value,
    input,
    session.evaluationVersion,
  );
}

function publicPatientRoleIdForCase(casePackage: SupportedCasePackage): string {
  if (casePackage.schemaVersion === "case-package-v2-rc1") {
    return casePackage.patientIdentity.patientRoleId;
  }

  const launchCaseCode = /^case_c(?<sequence>\d{2})_/u.exec(
    casePackage.publicCaseId,
  )?.groups?.sequence;
  if (launchCaseCode !== undefined) {
    return `patient-role.public-c${launchCaseCode}`;
  }

  const legacyDigest = createHash("sha256")
    .update(casePackage.publicCaseId, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `patient-role.legacy-${legacyDigest}`;
}

export class ModelService {
  private readonly ids: IdGenerator;
  private readonly persistence: ModelPersistence;
  private readonly clock: Clock;
  private readonly providerName: string;
  private readonly modelId: string;
  private readonly promptVersion: string;
  private readonly defaultIdempotencyScopeId: string | undefined;
  private readonly medicalSafetyPolicy: {
    evaluate(input: {
      text: string;
      context?: MedicalSafetyInputV1["context"];
    }): MedicalSafetyResultV1;
  };
  private readonly safetyAuditHmacKey: string;
  private readonly onEventSinkError:
    | ((error: unknown, event: ModelEvent) => void | Promise<void>)
    | undefined;
  private readonly serial = new KeyedSerialExecutor();

  constructor(
    private readonly cases: CaseRepository,
    private readonly provider: ModelProvider,
    private readonly eventSink: EventSink,
    ids: IdGenerator = new UuidGenerator(),
    options: ModelServiceOptions = {},
  ) {
    this.ids = ids;
    this.persistence = options.persistence ?? new InMemoryModelPersistence();
    this.clock = options.clock ?? new SystemClock();
    let providerName: string;
    let modelId: string;
    let promptVersion: string;
    try {
      const identity = provider.identity;
      const rawProviderName = identity?.providerName;
      const rawModelId = identity?.modelId;
      const rawPromptVersion = identity?.promptVersion;
      if (
        typeof rawProviderName !== "string" ||
        typeof rawModelId !== "string" ||
        typeof rawPromptVersion !== "string" ||
        rawProviderName.trim().length === 0 ||
        rawModelId.trim().length === 0 ||
        rawPromptVersion.trim().length === 0
      ) {
        throw new ModelServiceError(
          "INVALID_REQUEST",
          "The model provider must declare a complete immutable identity.",
        );
      }
      providerName = rawProviderName;
      modelId = rawModelId;
      promptVersion = rawPromptVersion;
    } catch (error) {
      try {
        this.persistence.close();
      } catch {
        // Preserve the provider identity error.
      }
      throw error;
    }
    this.providerName = providerName;
    this.modelId = modelId;
    this.promptVersion = promptVersion;
    this.defaultIdempotencyScopeId = options.defaultIdempotencyScopeId;
    this.medicalSafetyPolicy = options.medicalSafetyPolicy ?? new MedicalSafetyPolicyV1();
    const configuredIntegrityKey = options.safetyAuditHmacKey?.trim();
    if (
      (this.persistence.requiresStableIntegrityKey &&
        configuredIntegrityKey === undefined) ||
      (configuredIntegrityKey !== undefined &&
        configuredIntegrityKey.length < 32)
    ) {
      this.persistence.close();
      throw new ModelServiceError(
        "INVALID_REQUEST",
        "Persistent model storage requires a stable safetyAuditHmacKey of at least 32 characters.",
      );
    }
    this.safetyAuditHmacKey = configuredIntegrityKey ??
      randomBytes(32).toString("hex");
    this.onEventSinkError = options.onEventSinkError;
    if (options.recoverOnStartup !== false) {
      try {
        this.recoverOnStartup();
      } catch (error) {
        this.persistence.close();
        throw error;
      }
    }
  }

  async createSession(input: {
    clientRequestId: string;
    idempotencyScopeId?: string;
    publicCaseId: string;
    patientNpcId: string;
  }): Promise<{
    session: PublicSessionView;
    projection: PublicSessionProjection;
  }> {
    assertPublicId(input.clientRequestId, "clientRequestId");
    const scopeId =
      input.idempotencyScopeId ?? this.defaultIdempotencyScopeId;
    if (scopeId === undefined) {
      throw new ModelServiceError(
        "INVALID_REQUEST",
        "A trusted idempotencyScopeId is required.",
      );
    }
    assertPublicId(scopeId, "idempotencyScopeId");
    assertPublicId(input.publicCaseId, "publicCaseId");
    assertPublicId(input.patientNpcId, "patientNpcId");
    const fingerprint = requestFingerprint("create_session", scopeId, {
      publicCaseId: input.publicCaseId,
      patientNpcId: input.patientNpcId,
    });
    return this.transact((transaction, stagedEvents) => {
      const repeated = this.replayIdempotency<{
        session: PublicSessionView;
        projection: PublicSessionProjection;
      }>(transaction, scopeId, "create_session", input.clientRequestId, fingerprint);
      if (repeated !== undefined) {
        return repeated;
      }

      const casePackage = this.cases.findByPublicId(input.publicCaseId);
      if (!casePackage) {
        throw new ModelServiceError("CASE_NOT_FOUND", "Case was not found.");
      }
      const now = this.clock.now();
      const session = createSessionAggregate({
        sessionId: this.ids.next("session"),
        patientNpcId: input.patientNpcId,
        userId: scopeId,
        publicCaseId: casePackage.publicCaseId,
        caseVersion: casePackage.caseVersion,
        providerName: this.providerName,
        modelId: this.modelId,
        promptVersion: this.promptVersion,
        evaluationVersion: casePackage.evaluationVersion,
        now,
      });
      transaction.sessions.save(session);
      this.emit(
        transaction,
        session,
        "session.created",
        { sessionPhase: "created" },
        stagedEvents,
      );
      const from = session.sessionPhase;
      transitionSession(session, "active");
      this.emitStateChanged(transaction, session, from, stagedEvents);
      transaction.sessions.save(session);

      const response = {
        session: this.sessionView(session, casePackage),
        projection: this.projection(session, casePackage),
      };
      transaction.idempotency.save({
        scopeId,
        operation: "create_session",
        idempotencyKey: input.clientRequestId,
        requestHash: fingerprint,
        status: "committed",
        response,
        createdAt: now.toISOString(),
        retainUntil: new Date(
          now.getTime() + IDEMPOTENCY_RETENTION_MS,
        ).toISOString(),
      });
      return structuredClone(response);
    });
  }

  getSession(
    sessionId: string,
    idempotencyScopeId?: string,
  ): PublicSessionProjection {
    return this.getSessionSnapshot(sessionId, idempotencyScopeId).projection;
  }

  getSessionSnapshot(
    sessionId: string,
    idempotencyScopeId?: string,
  ): {
    session: PublicSessionView;
    projection: PublicSessionProjection;
  } {
    assertPublicId(sessionId, "sessionId");
    if (idempotencyScopeId !== undefined) {
      assertPublicId(idempotencyScopeId, "idempotencyScopeId");
    }
    return this.transact((transaction, stagedEvents) => {
      const session = this.requireSession(
        transaction,
        sessionId,
        stagedEvents,
      );
      this.assertSessionScope(session, idempotencyScopeId);
      const casePackage = this.requireCase(session);
      return {
        session: this.sessionView(session, casePackage),
        projection: this.projection(session, casePackage),
      };
    });
  }

  getResult(
    sessionId: string,
    idempotencyScopeId?: string,
  ): EvaluationCompleted {
    assertPublicId(sessionId, "sessionId");
    if (idempotencyScopeId !== undefined) {
      assertPublicId(idempotencyScopeId, "idempotencyScopeId");
    }
    return this.transact((transaction, stagedEvents) => {
      const session = this.requireSession(
        transaction,
        sessionId,
        stagedEvents,
      );
      this.assertSessionScope(session, idempotencyScopeId);
      if (session.sessionPhase !== "completed") {
        throw new ModelServiceError(
          "INVALID_SESSION_STATE",
          "The session does not have a completed result.",
        );
      }
      assertCompletedEvaluationForRead(session.evaluation, session);
      return structuredClone(session.evaluation);
    });
  }

  private persistSafetyInterruption(input: {
    sessionId: string;
    operation: IdempotencyOperationV1;
    idempotencyKey: string;
    fingerprint: string;
    textLength: number;
    safetyInterruption: LocalSafetyInterruption;
  }): ModelServiceError {
    return this.transact((transaction, stagedEvents) => {
      const session = this.requireSession(
        transaction,
        input.sessionId,
        stagedEvents,
      );
      assertSessionAcceptsWrites(session);
      const existing = transaction.idempotency.get(
        input.sessionId,
        input.operation,
        input.idempotencyKey,
      );
      if (existing !== undefined) {
        this.replayIdempotency<never>(
          transaction,
          input.sessionId,
          input.operation,
          input.idempotencyKey,
          input.fingerprint,
        );
      }
      const error = new ModelServiceError(
        input.safetyInterruption.code,
        input.safetyInterruption.responseText,
      );
      const now = this.clock.now();
      transaction.idempotency.save({
        scopeId: input.sessionId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.fingerprint,
        status: "failed",
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        createdAt: now.toISOString(),
        retainUntil: new Date(
          now.getTime() + IDEMPOTENCY_RETENTION_MS,
        ).toISOString(),
      });
      this.emit(
        transaction,
        session,
        "safety.interrupted",
        {
          decision: input.safetyInterruption.decision,
          templateId: input.safetyInterruption.templateId,
          policyVersion: input.safetyInterruption.policyVersion,
          ruleIds: [...input.safetyInterruption.ruleIds],
          textLength: input.textLength,
          inputHmac: input.fingerprint,
        },
        stagedEvents,
      );
      transaction.sessions.save(session);
      return error;
    });
  }

  async askPatient(input: {
    sessionId: string;
    clientTurnId: string;
    text: string;
  }): Promise<TurnCompleted> {
    return this.serial.run(input.sessionId, async () => {
      assertPublicId(input.sessionId, "sessionId");
      assertPublicId(input.clientTurnId, "clientTurnId");
      assertBoundedString(input.text, "text", MAX_TURN_TEXT_LENGTH);
      const safetyInterruption = localSafetyInterruption(
        input.text,
        this.medicalSafetyPolicy,
      );
      const providerSafetyFingerprint = safetyRequestFingerprint(
        "submit_turn",
        input.sessionId,
        { text: input.text },
        this.safetyAuditHmacKey,
      );
      const legacyFingerprint = requestFingerprint(
        "submit_turn",
        input.sessionId,
        { text: input.text },
      );
      const fingerprint = providerSafetyFingerprint;
      if (safetyInterruption !== undefined) {
        throw this.persistSafetyInterruption({
          sessionId: input.sessionId,
          operation: "submit_turn",
          idempotencyKey: input.clientTurnId,
          fingerprint,
          textLength: input.text.length,
          safetyInterruption,
        });
      }
      const prepared = this.transact((transaction, stagedEvents) => {
        const session = this.requireSession(
          transaction,
          input.sessionId,
          stagedEvents,
        );
        this.assertTerminalSessionDoesNotReplay(session);
        const repeated = this.replayIdempotency<TurnCompleted>(
          transaction,
          input.sessionId,
          "submit_turn",
          input.clientTurnId,
          fingerprint,
          [legacyFingerprint],
        );
        if (repeated !== undefined) {
          return {
            repeated: normalizeHistoricalTurnCompleted(repeated),
          } as const;
        }
        assertSessionAcceptsWrites(session);
        if (session.medicalTurnCount >= MAX_MEDICAL_TURNS) {
          throw new ModelServiceError(
            "TURN_LIMIT_REACHED",
            "The medical turn limit has been reached.",
          );
        }
        if (session.turnAttemptCount >= MAX_SESSION_INTERACTIONS) {
          throw new ModelServiceError(
            "TURN_LIMIT_REACHED",
            "The session interaction limit has been reached.",
          );
        }
        session.turnAttemptCount += 1;
        const now = this.clock.now();
        const operationId = this.ids.next("operation");
        const from = session.sessionPhase;
        transitionSession(session, "awaiting_model");
        session.activeOperationId = operationId;
        this.emitStateChanged(transaction, session, from, stagedEvents);
        this.emit(
          transaction,
          session,
          "turn.accepted",
          { clientTurnId: input.clientTurnId, acceptedAt: now.toISOString() },
          stagedEvents,
        );
        transaction.sessions.save(session);
        transaction.idempotency.save(
          this.inProgressIdempotency(
            input.sessionId,
            "submit_turn",
            input.clientTurnId,
            fingerprint,
            operationId,
            now,
          ),
        );
        const operation: OperationJournalRecord = {
          operationId,
          sessionId: session.sessionId,
          idempotencyKey: input.clientTurnId,
          requestHash: fingerprint,
          kind: "turn",
          status: "prepared",
          request: {},
          attemptCount: 0,
          providerName: session.providerName,
          modelId: session.modelId,
          promptVersion: session.promptVersion,
          caseVersion: session.caseVersion,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(
            now.getTime() + OPERATION_LEASE_MS,
          ).toISOString(),
        };
        operation.request = encryptTurnOperationRequestV1(
          turnRequestCryptoIdentity(operation),
          input.text,
          this.safetyAuditHmacKey,
        );
        transaction.operations.save(operation);
        return { operationId } as const;
      });
      if ("repeated" in prepared) return prepared.repeated;
      return this.executeTurnOperation(prepared.operationId);
    });
  }

  async orderTest(input: {
    sessionId: string;
    clientRequestId: string;
    testId: string;
  }): Promise<PublicTestResult> {
    return this.serial.run(input.sessionId, async () => {
      assertPublicId(input.sessionId, "sessionId");
      assertPublicId(input.clientRequestId, "clientRequestId");
      assertPublicId(input.testId, "testId");
      const fingerprint = requestFingerprint("order_test", input.sessionId, {
        testId: input.testId,
      });
      return this.transact((transaction, stagedEvents) => {
        const session = this.requireSession(
          transaction,
          input.sessionId,
          stagedEvents,
        );
        this.assertTerminalSessionDoesNotReplay(session);
        const repeated = this.replayIdempotency<PublicTestResult>(
          transaction,
          input.sessionId,
          "order_test",
          input.clientRequestId,
          fingerprint,
        );
        if (repeated !== undefined) return repeated;
        assertSessionAcceptsWrites(session);
        const definition = this.requireCase(session).medicalTests[input.testId];
        const execution = deterministicTestExecution(input.testId, definition);
        if (definition === undefined) {
          throw new ModelServiceError(
            "TEST_NOT_AVAILABLE",
            "The requested test is not available for this case.",
          );
        }
        const result = execution.result;
        applyCompletedTestResult(session, result);
        if (session.pendingTestSuggestionId === input.testId) {
          delete session.pendingTestSuggestionId;
        }
        session.revision += 1;
        const now = this.clock.now();
        transaction.idempotency.save({
          scopeId: input.sessionId,
          operation: "order_test",
          idempotencyKey: input.clientRequestId,
          requestHash: fingerprint,
          status: "committed",
          response: result,
          createdAt: now.toISOString(),
          retainUntil: new Date(
            now.getTime() + IDEMPOTENCY_RETENTION_MS,
          ).toISOString(),
        });
        this.emit(
          transaction,
          session,
          "test.completed",
          { testId: input.testId, status: result.status },
          stagedEvents,
        );
        transaction.sessions.save(session);
        return structuredClone(result);
      });
    });
  }

  async submitDiagnosis(input: {
    sessionId: string;
    clientRequestId: string;
    primaryDiagnosis: string;
    differentials: string[];
  }): Promise<EvaluationCompleted> {
    return this.serial.run(input.sessionId, async () => {
      assertPublicId(input.sessionId, "sessionId");
      assertPublicId(input.clientRequestId, "clientRequestId");
      assertBoundedString(
        input.primaryDiagnosis,
        "primaryDiagnosis",
        MAX_DIAGNOSIS_LENGTH,
      );
      if (input.differentials.length > MAX_DIFFERENTIALS) {
        throw new ModelServiceError(
          "INVALID_REQUEST",
          `differentials may contain at most ${MAX_DIFFERENTIALS} items.`,
        );
      }
      for (const differential of input.differentials) {
        assertBoundedString(
          differential,
          "differential",
          MAX_DIAGNOSIS_LENGTH,
        );
      }
      const diagnosisPayload = {
        primaryDiagnosis: input.primaryDiagnosis,
        differentials: input.differentials,
      };
      const diagnosisSafetyText = [
        input.primaryDiagnosis,
        ...input.differentials,
      ].join("\n");
      const safetyInterruption = localSafetyInterruption(
        diagnosisSafetyText,
        this.medicalSafetyPolicy,
        "diagnosis_submission",
      );
      const fingerprint = safetyInterruption === undefined
        ? requestFingerprint(
            "submit_diagnosis",
            input.sessionId,
            diagnosisPayload,
          )
        : safetyRequestFingerprint(
            "submit_diagnosis",
            input.sessionId,
            diagnosisPayload,
            this.safetyAuditHmacKey,
          );
      if (safetyInterruption !== undefined) {
        throw this.persistSafetyInterruption({
          sessionId: input.sessionId,
          operation: "submit_diagnosis",
          idempotencyKey: input.clientRequestId,
          fingerprint,
          textLength: diagnosisSafetyText.length,
          safetyInterruption,
        });
      }
      const prepared = this.transact((transaction, stagedEvents) => {
        const session = this.requireSession(
          transaction,
          input.sessionId,
          stagedEvents,
        );
        if (
          session.sessionPhase === "expired" ||
          session.sessionPhase === "cancelled"
        ) {
          assertSessionAcceptsWrites(session);
        }
        const repeated = this.replayIdempotency<EvaluationCompleted>(
          transaction,
          input.sessionId,
          "submit_diagnosis",
          input.clientRequestId,
          fingerprint,
        );
        if (repeated !== undefined) return { repeated } as const;
        const now = this.clock.now();
        if (session.diagnosisSubmission) {
          if (session.diagnosisSubmission.fingerprint !== fingerprint) {
            throw new ModelServiceError(
              "IDEMPOTENCY_CONFLICT",
              "A different diagnosis was already accepted for this session.",
            );
          }
          if (session.sessionPhase !== "diagnosis_submitted") {
            throw new ModelServiceError(
              "INVALID_SESSION_STATE",
              "Diagnosis evaluation cannot start in the current session state.",
            );
          }
        } else {
          assertSessionAcceptsWrites(session);
          session.diagnosisSubmission = {
            submissionId: this.ids.next("submission"),
            fingerprint,
            primaryDiagnosis: input.primaryDiagnosis,
            differentials: [...input.differentials],
            acceptedAt: now.toISOString(),
          };
          const from = session.sessionPhase;
          transitionSession(session, "diagnosis_submitted");
          this.emitStateChanged(transaction, session, from, stagedEvents);
          this.emit(
            transaction,
            session,
            "diagnosis.accepted",
            {
              submissionId: session.diagnosisSubmission.submissionId,
              sessionPhase: "diagnosis_submitted",
            },
            stagedEvents,
          );
        }
        const operationId = this.ids.next("operation");
        const from = session.sessionPhase;
        transitionSession(session, "evaluating");
        session.activeOperationId = operationId;
        this.emitStateChanged(transaction, session, from, stagedEvents);
        transaction.sessions.save(session);
        transaction.idempotency.save(
          this.inProgressIdempotency(
            input.sessionId,
            "submit_diagnosis",
            input.clientRequestId,
            fingerprint,
            operationId,
            now,
          ),
        );
        transaction.operations.save({
          operationId,
          sessionId: session.sessionId,
          idempotencyKey: input.clientRequestId,
          requestHash: fingerprint,
          kind: "evaluation",
          status: "prepared",
          request: {
            primaryDiagnosis: session.diagnosisSubmission.primaryDiagnosis,
            differentials: [...session.diagnosisSubmission.differentials],
          },
          attemptCount: 0,
          providerName: session.providerName,
          modelId: session.modelId,
          promptVersion: session.promptVersion,
          caseVersion: session.caseVersion,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(
            now.getTime() + OPERATION_LEASE_MS,
          ).toISOString(),
        });
        return { operationId } as const;
      });
      if ("repeated" in prepared) return prepared.repeated;
      return this.executeEvaluationOperation(prepared.operationId);
    });
  }

  async cancelSession(input: {
    sessionId: string;
    clientRequestId: string;
  }): Promise<{
    sessionId: string;
    sessionPhase: "cancelled";
    cancelledAt: string;
  }> {
    return this.serial.run(input.sessionId, async () => {
      assertPublicId(input.sessionId, "sessionId");
      assertPublicId(input.clientRequestId, "clientRequestId");
      const fingerprint = requestFingerprint(
        "cancel_session",
        input.sessionId,
        {},
      );
      return this.transact((transaction, stagedEvents) => {
        const repeated = this.replayIdempotency<{
          sessionId: string;
          sessionPhase: "cancelled";
          cancelledAt: string;
        }>(
          transaction,
          input.sessionId,
          "cancel_session",
          input.clientRequestId,
          fingerprint,
        );
        if (repeated !== undefined) return repeated;
        const session = this.requireSession(
          transaction,
          input.sessionId,
          stagedEvents,
        );
        assertSessionAcceptsWrites(session);
        const now = this.clock.now();
        const from = session.sessionPhase;
        transitionSession(session, "cancelled");
        this.emitStateChanged(transaction, session, from, stagedEvents);
        transaction.sessions.save(session);
        const response = {
          sessionId: session.sessionId,
          sessionPhase: "cancelled" as const,
          cancelledAt: now.toISOString(),
        };
        transaction.idempotency.save({
          scopeId: session.sessionId,
          operation: "cancel_session",
          idempotencyKey: input.clientRequestId,
          requestHash: fingerprint,
          status: "committed",
          response,
          createdAt: now.toISOString(),
          retainUntil: new Date(
            now.getTime() + IDEMPOTENCY_RETENTION_MS,
          ).toISOString(),
        });
        return response;
      });
    });
  }

  inspectOperation(operationId: string): OperationJournalRecord {
    assertPublicId(operationId, "operationId");
    return this.persistence.transaction((transaction) => {
      const operation = transaction.operations.get(operationId);
      if (!operation) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Operation was not found.",
        );
      }
      return operation;
    });
  }

  async recoverOperation(input: {
    operationId: string;
    action: RecoveryAction;
    operator: string;
    reason: string;
  }): Promise<OperationJournalRecord> {
    assertPublicId(input.operationId, "operationId");
    assertPublicId(input.operator, "operator");
    assertBoundedString(input.reason, "reason", 1_000);
    const initial = this.inspectOperation(input.operationId);
    return this.serial.run(initial.sessionId, async () => {
      if (input.action === "commit-buffered") {
        let expiryError: ModelServiceError | undefined;
        try {
          expiryError = this.transact((transaction, stagedEvents) => {
            const operation = this.requireOperation(
              transaction,
              input.operationId,
            );
            if (operation.status !== "response_validated") {
              throw new ModelServiceError(
                "OPERATION_RECOVERY_REQUIRED",
                "Only response-validated operations can be committed locally.",
              );
            }
            const session = this.requireCurrentRecoverySession(
              transaction,
              operation,
            );
            const fromStatus = operation.status;
            operation.operator = input.operator;
            operation.recoveryReason = input.reason;
            const expired = this.expireLateBufferedOperation(
              transaction,
              session,
              operation,
              stagedEvents,
            );
            if (expired === undefined) {
              this.commitBufferedOperation(
                transaction,
                session,
                operation,
                stagedEvents,
              );
            }
            this.emitRecoveryDecision(
              transaction,
              session,
              operation,
              input,
              fromStatus,
              stagedEvents,
            );
            transaction.sessions.save(session);
            return expired;
          });
        } catch (error) {
          const recoveryError =
            error instanceof ModelServiceError
              ? error
              : new ModelServiceError(
                  "OPERATION_RECOVERY_REQUIRED",
                  "The validated response is awaiting local recovery.",
                  { retryable: true },
                );
          this.preserveBufferedOperation(input.operationId, recoveryError);
          throw recoveryError;
        }
        if (expiryError !== undefined) throw expiryError;
        return this.inspectOperation(input.operationId);
      }

      if (input.action === "fail") {
        const redactedLegacyRequest = this.transact((transaction, stagedEvents) => {
          const operation = this.requireOperation(transaction, input.operationId);
          if (operation.status !== "prepared" && operation.status !== "unknown") {
            throw new ModelServiceError(
              "OPERATION_RECOVERY_REQUIRED",
              "Only prepared or unknown operations can be marked failed.",
            );
          }
          const session = this.requireCurrentRecoverySession(
            transaction,
            operation,
          );
          this.assertRecoveryLeaseExpired(operation);
          const fromStatus = operation.status;
          operation.status = "failed";
          operation.failureCode = "OPERATOR_MARKED_FAILED";
          operation.operator = input.operator;
          operation.recoveryReason = input.reason;
          operation.updatedAt = this.clock.now().toISOString();
          delete operation.leaseToken;
          delete operation.leaseExpiresAt;
          transaction.operations.save(operation);
          const redacted = this.restoreAfterOperationFailure(
            transaction,
            operation,
            new ModelServiceError(
              "OPERATION_RECOVERY_REQUIRED",
              "Operation was marked failed by an operator.",
            ),
            stagedEvents,
          );
          const restoredSession = this.requireSessionWithoutExpiry(
            transaction,
            operation.sessionId,
          );
          this.emitRecoveryDecision(
            transaction,
            restoredSession,
            operation,
            input,
            fromStatus,
            stagedEvents,
          );
          transaction.sessions.save(restoredSession);
          return redacted;
        });
        if (redactedLegacyRequest) this.persistence.purgeSensitiveData?.();
        return this.inspectOperation(input.operationId);
      }

      const prepared = this.transact((transaction, stagedEvents) => {
        const operation = this.requireOperation(transaction, input.operationId);
        if (operation.status !== "prepared" && operation.status !== "unknown") {
          throw new ModelServiceError(
            "OPERATION_RECOVERY_REQUIRED",
            "Only prepared or unknown operations can be retried.",
          );
        }
        if (operation.attemptCount >= 2) {
          throw new ModelServiceError(
            "OPERATION_RECOVERY_REQUIRED",
            "Operation retry budget is exhausted.",
          );
        }
        if (
          operation.providerName !== this.providerName ||
          operation.modelId !== this.modelId ||
          operation.promptVersion !== this.promptVersion
        ) {
          throw new ModelServiceError(
            "OPERATION_RECOVERY_REQUIRED",
            "The configured provider identity does not match the original operation.",
          );
        }
        const session = this.requireCurrentRecoverySession(
          transaction,
          operation,
        );
        this.assertRecoveryLeaseExpired(operation);
        const fromStatus = operation.status;
        const fromPhase = session.sessionPhase;
        if (expireSessionIfNeeded(session, this.clock.now())) {
          this.emitStateChanged(transaction, session, fromPhase, stagedEvents);
          operation.status = "failed";
          operation.failureCode = "SESSION_EXPIRED";
          delete operation.leaseToken;
          delete operation.leaseExpiresAt;
          transaction.operations.save(operation);
          const redactedLegacyRequest = this.restoreAfterOperationFailure(
            transaction,
            operation,
            new ModelServiceError("SESSION_EXPIRED", "Session has expired."),
            stagedEvents,
          );
          transaction.sessions.save(session);
          return {
            error: new ModelServiceError(
              "SESSION_EXPIRED",
              "Session has expired.",
            ),
            redactedLegacyRequest,
          } as const;
        }
        const target = operation.kind === "turn" ? "awaiting_model" : "evaluating";
        const fallback = operation.kind === "turn" ? "active" : "diagnosis_submitted";
        if (session.sessionPhase === fallback) {
          transitionSession(session, target);
          this.emitStateChanged(transaction, session, fallback, stagedEvents);
        } else if (session.sessionPhase !== target) {
          throw new ModelServiceError(
            "INVALID_SESSION_STATE",
            "Session is not recoverable for this operation.",
          );
        }
        session.activeOperationId = operation.operationId;
        operation.status = "prepared";
        operation.operator = input.operator;
        operation.recoveryReason = input.reason;
        operation.leaseToken = randomUUID();
        operation.leaseExpiresAt = new Date(
          this.clock.now().getTime() + OPERATION_LEASE_MS,
        ).toISOString();
        operation.updatedAt = this.clock.now().toISOString();
        transaction.sessions.save(session);
        transaction.operations.save(operation);
        const idempotency = this.requireOperationIdempotency(
          transaction,
          operation,
        );
        idempotency.status = "in_progress";
        delete idempotency.error;
        transaction.idempotency.save(idempotency);
        this.emitRecoveryDecision(
          transaction,
          session,
          operation,
          input,
          fromStatus,
          stagedEvents,
        );
        transaction.sessions.save(session);
        return { operation } as const;
      });
      if (
        "redactedLegacyRequest" in prepared &&
        prepared.redactedLegacyRequest
      ) {
        this.persistence.purgeSensitiveData?.();
      }
      if ("error" in prepared) throw prepared.error;
      if (prepared.operation.kind === "turn") {
        await this.executeTurnOperation(prepared.operation.operationId);
      } else {
        await this.executeEvaluationOperation(prepared.operation.operationId);
      }
      return this.inspectOperation(prepared.operation.operationId);
    });
  }

  listEvents(sessionId: string): ModelEvent[] {
    return this.persistence.transaction((transaction) =>
      transaction.events.list(sessionId),
    );
  }

  close(): void {
    this.persistence.close();
  }

  private assertTerminalSessionDoesNotReplay(
    session: SessionAggregate,
  ): void {
    if (
      session.sessionPhase === "expired" ||
      session.sessionPhase === "cancelled"
    ) {
      assertSessionAcceptsWrites(session);
    }
    if (
      session.sessionPhase === "completed" ||
      session.sessionPhase === "failed"
    ) {
      throw new ModelServiceError(
        "INVALID_SESSION_STATE",
        "The session does not accept this action.",
      );
    }
  }

  private requireCurrentRecoverySession(
    transaction: PersistenceTransaction,
    operation: OperationJournalRecord,
  ): SessionAggregate {
    const session = this.requireSessionWithoutExpiry(
      transaction,
      operation.sessionId,
    );
    if (session.activeOperationId !== operation.operationId) {
      throw new ModelServiceError(
        "OPERATION_RECOVERY_REQUIRED",
        "The operation is not the session's current recovery operation.",
      );
    }
    return session;
  }

  private assertRecoveryLeaseExpired(operation: OperationJournalRecord): void {
    if (
      operation.leaseExpiresAt !== undefined &&
      Date.parse(operation.leaseExpiresAt) > this.clock.now().getTime()
    ) {
      throw new ModelServiceError(
        "OPERATION_IN_PROGRESS",
        "The operation recovery lease is still active.",
        { retryable: true },
      );
    }
  }

  private emitRecoveryDecision(
    transaction: PersistenceTransaction,
    session: SessionAggregate,
    operation: OperationJournalRecord,
    input: {
      action: RecoveryAction;
      operator: string;
      reason: string;
    },
    fromStatus: OperationJournalRecord["status"],
    stagedEvents: ModelEvent[],
  ): void {
    this.emit(
      transaction,
      session,
      "operation.recovery_decided",
      {
        operationId: operation.operationId,
        action: input.action,
        operator: input.operator,
        reason: input.reason,
        fromStatus,
        toStatus: operation.status,
      },
      stagedEvents,
    );
  }

  private async executeTurnOperation(
    operationId: string,
  ): Promise<TurnCompleted> {
    let responseBuffered = false;
    let dispatchFence: DispatchFence | undefined;
    try {
      const context = this.markDispatched(operationId);
      this.provider.beginOperation?.(
        operationId,
        Math.max(0, 2 - context.operation.attemptCount),
      );
      dispatchFence = {
        leaseToken: context.operation.leaseToken!,
        attemptCount: context.operation.attemptCount,
      };
      if (context.operation.kind !== "turn") {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Turn operation request is invalid.",
        );
      }
      const { text, clientTurnId } = readTurnOperationRequest(
        context.operation,
        this.safetyAuditHmacKey,
      );
      if (clientTurnId !== context.operation.idempotencyKey) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Turn operation request is invalid.",
        );
      }
      const safeCaseView = buildSafePatientCaseView(
        context.casePackage,
        context.session.completedTests,
      );
      const patientInput = {
        operationId,
        userText: text,
        patientProfile: structuredClone(safeCaseView.patientProfile),
        safeCaseView: structuredClone(safeCaseView),
        recentTurns: context.session.turns.map((turn) => ({
          turnId: turn.turnId,
          userText: turn.text,
          patientReply: turn.reply,
          committedAt: turn.createdAt,
        })),
        disclosedFactIds: context.session.disclosedFacts.map(
          ({ factId }) => factId,
        ),
        completedTests: structuredClone(context.session.completedTests),
        consecutiveOffTopicTurns: context.session.consecutiveOffTopicTurns,
        ...(context.session.pendingTestSuggestionId === undefined
          ? {}
          : {
              pendingTestSuggestionId:
                context.session.pendingTestSuggestionId,
            }),
      };
      let validatedPatientReply: PatientAgentOutput | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const patientReply = await this.callProvider(operationId, () =>
            this.provider.generatePatientReply({
              ...patientInput,
              ...(attempt === 0
                ? {}
                : {
                      regenerationInstruction:
                        "The previous structured output was rejected by the server gate. Answer the same user message again as the same patient, using patientProfile and the complete committed conversation history to preserve identity and continuity. Never mention missing case data, a profile, a prompt, or a system setting. Creatively fill ordinary non-medical identity and daily-life details when useful, keep every invented detail consistent with the full history, and speak naturally rather than selecting a canned phrase. Cite only supplied IDs for medical facts, explicit persona anchors, completed tests, or test actions; remove unsupported medical claims. Reanalyze diagnosisIntent only from this userText: submit only when the player clearly commits to one primary diagnosis; treat equally asserted multiple diseases without a clear primary as continue_dialogue and copy those exact terms into candidateDiagnoses; copy every diagnosis term exactly from userText and never judge correctness. Do not reveal a diagnosis, an uncompleted test result, or any new medical fact in reply.",
                  }),
            }),
          );
          this.assertProviderIdentity();
          validatedPatientReply = validatePatientOutputV1(patientReply, {
            casePackage: context.casePackage,
            safeCaseView,
            userText: text,
            previouslyDisclosedFactIds: patientInput.disclosedFactIds,
          });
          break;
        } catch (error) {
          if (
            attempt === 0 &&
            (error instanceof ModelProviderOutputError ||
              (error instanceof ModelServiceError &&
                error.code === "MODEL_OUTPUT_REJECTED"))
          ) {
            this.provider.beginOperation?.(operationId, 0);
            continue;
          }
          throw error;
        }
      }
      if (validatedPatientReply === undefined) {
        throw new ModelServiceError(
          "MODEL_OUTPUT_REJECTED",
          "The Patient Agent output was rejected after regeneration.",
        );
      }
      const disclosedBefore = new Set(
        context.session.disclosedFacts.map(({ factId }) => factId),
      );
      const factsUsed = [...validatedPatientReply.factIdsUsed];
      const action: TurnBufferPayload["action"] =
        validatedPatientReply.interactionKind === "social_chat"
          ? "other"
          : factsUsed.length > 0 &&
              factsUsed.every((factId) => disclosedBefore.has(factId))
            ? "repeat"
            : "ask_patient";
      const reply = validatedPatientReply.reply;
      const effects = turnEffectsForPatientOutput(
        validatedPatientReply,
        context.casePackage,
      );
      const diagnosisSubmission = diagnosisSubmissionForPatientOutput(
        validatedPatientReply,
      );
      const now = this.clock.now();
      const disclosedFacts = factsUsed
        .filter((factId) => !disclosedBefore.has(factId))
        .map((factId) => ({
          factId,
          displayText: context.casePackage.patientFacts[factId]!.value,
          disclosedAtTurn: context.session.turnCount + 1,
        }));
      const response: TurnCompleted = {
        sessionId: context.session.sessionId,
        turnId: this.ids.next("turn"),
        reply,
        disclosedFactIds: [...factsUsed],
        effects,
        turnNumber: context.session.turnCount + 1,
        sessionPhase: "active",
        ...(diagnosisSubmission === undefined
          ? {}
          : { diagnosisSubmission }),
      };
      const payload: TurnBufferPayload = {
        text,
        action,
        requestedFactIds: [...factsUsed],
        createdAt: now.toISOString(),
        disclosedFacts,
        response,
        patientAgentOutput: validatedPatientReply,
      };
      this.bufferOperation(operationId, "turn.v1", payload, now, dispatchFence);
      responseBuffered = true;
      const committed = this.transact((transaction, stagedEvents) => {
        const operation = this.requireOperation(transaction, operationId);
        const session = this.requireSessionWithoutExpiry(
          transaction,
          operation.sessionId,
        );
        const expiryError = this.expireLateBufferedOperation(
          transaction,
          session,
          operation,
          stagedEvents,
        );
        if (expiryError !== undefined) return { expiryError } as const;
        this.commitBufferedOperation(
          transaction,
          session,
          operation,
          stagedEvents,
        );
        return { response: structuredClone(response) } as const;
      });
      if ("expiryError" in committed) throw committed.expiryError;
      return committed.response;
    } catch (error) {
      const serviceError = responseBuffered
        ? error instanceof ModelServiceError
          ? error
          : new ModelServiceError(
              "OPERATION_RECOVERY_REQUIRED",
              "The validated response is awaiting local recovery.",
              { retryable: true },
            )
        : asServiceError(error);
      if (responseBuffered) {
        this.preserveBufferedOperation(operationId, serviceError);
      } else {
        this.failOperation(operationId, serviceError, dispatchFence);
      }
      throw serviceError;
    } finally {
      this.provider.finishOperation?.(operationId);
    }
  }

  private async executeEvaluationOperation(
    operationId: string,
  ): Promise<EvaluationCompleted> {
    let responseBuffered = false;
    let dispatchFence: DispatchFence | undefined;
    try {
      const context = this.markDispatched(operationId);
      this.provider.beginOperation?.(
        operationId,
        Math.max(0, 2 - context.operation.attemptCount),
      );
      dispatchFence = {
        leaseToken: context.operation.leaseToken!,
        attemptCount: context.operation.attemptCount,
      };
      if (
        context.operation.kind !== "evaluation" ||
        context.session.diagnosisSubmission === undefined
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Evaluation operation request is invalid.",
        );
      }
      const evaluationInput = evaluationInputForSession(
        context.session,
        structuredClone(context.casePackage),
      );
      const providerEvaluation = await this.callProvider(operationId, () =>
        this.provider.evaluate({
          operationId,
          ...evaluationInput,
        }),
      );
      this.assertProviderIdentity();
      const validatedEvaluation = validateAndNormalizeMedicalEvaluation(
        providerEvaluation,
        evaluationInput,
        context.session,
      );
      const evaluation = validatedEvaluation.evaluation;
      if (
        evaluation.scores.communication === null ||
        evaluation.scores.total === null
      ) {
        throw new ModelServiceError(
          "EVALUATION_UNAVAILABLE",
          "Communication review is unavailable; no final score was committed.",
          { retryable: true },
        );
      }
      const now = this.clock.now();
      const response: EvaluationCompleted = {
        diagnosis: evaluation.diagnosis,
        scores: {
          ...evaluation.scores,
          communication: evaluation.scores.communication,
          total: evaluation.scores.total,
        },
        evidence: evaluation.evidence,
        summary: evaluation.summary,
        evaluationVersion: evaluation.evaluationVersion,
        sessionId: context.session.sessionId,
        caseVersion: context.session.caseVersion,
        sessionPhase: "completed",
        completedAt: now.toISOString(),
      };
      const payload: EvaluationBufferPayload = {
        response,
        communicationAssessment:
          validatedEvaluation.communicationAssessment,
      };
      this.bufferOperation(
        operationId,
        "evaluation.v1",
        payload,
        now,
        dispatchFence,
      );
      responseBuffered = true;
      const committed = this.transact((transaction, stagedEvents) => {
        const operation = this.requireOperation(transaction, operationId);
        const session = this.requireSessionWithoutExpiry(
          transaction,
          operation.sessionId,
        );
        const expiryError = this.expireLateBufferedOperation(
          transaction,
          session,
          operation,
          stagedEvents,
        );
        if (expiryError !== undefined) return { expiryError } as const;
        this.commitBufferedOperation(
          transaction,
          session,
          operation,
          stagedEvents,
        );
        return { response: structuredClone(response) } as const;
      });
      if ("expiryError" in committed) throw committed.expiryError;
      return committed.response;
    } catch (error) {
      const serviceError = responseBuffered
        ? error instanceof ModelServiceError
          ? error
          : new ModelServiceError(
              "OPERATION_RECOVERY_REQUIRED",
              "The validated response is awaiting local recovery.",
              { retryable: true },
            )
        : asServiceError(error);
      if (responseBuffered) {
        this.preserveBufferedOperation(operationId, serviceError);
      } else {
        this.failOperation(operationId, serviceError, dispatchFence);
      }
      throw serviceError;
    } finally {
      this.provider.finishOperation?.(operationId);
    }
  }

  private markDispatched(operationId: string): {
    operation: OperationJournalRecord;
    session: SessionAggregate;
    casePackage: SupportedCasePackage;
  } {
    this.assertProviderIdentity();
    return this.persistence.transaction((transaction) => {
      const operation = this.requireOperation(transaction, operationId);
      if (operation.status !== "prepared") {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Only prepared operations can be dispatched.",
        );
      }
      if (operation.attemptCount >= 2) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Operation retry budget is exhausted.",
        );
      }
      const now = this.clock.now();
      if (
        typeof operation.leaseToken !== "string" ||
        operation.leaseToken.length === 0 ||
        operation.leaseExpiresAt === undefined ||
        Date.parse(operation.leaseExpiresAt) <= now.getTime()
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Operation dispatch lease is missing or expired.",
        );
      }
      const session = this.requireSessionWithoutExpiry(
        transaction,
        operation.sessionId,
      );
      if (
        operation.providerName !== this.providerName ||
        operation.modelId !== this.modelId ||
        operation.promptVersion !== this.promptVersion ||
        session.providerName !== this.providerName ||
        session.modelId !== this.modelId ||
        session.promptVersion !== this.promptVersion
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "The configured provider identity does not match the session.",
        );
      }
      operation.status = "dispatched";
      operation.attemptCount += 1;
      operation.updatedAt = now.toISOString();
      transaction.operations.save(operation);
      return { operation, session, casePackage: this.requireCase(session) };
    });
  }

  private bufferOperation(
    operationId: string,
    kind: "turn.v1" | "evaluation.v1",
    payload: unknown,
    now: Date,
    fence: DispatchFence,
  ): void {
    this.persistence.transaction((transaction) => {
      const operation = this.requireOperation(transaction, operationId);
      if (
        operation.status !== "dispatched" ||
        operation.leaseToken !== fence.leaseToken ||
        operation.attemptCount !== fence.attemptCount
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "The operation dispatch lease is stale.",
        );
      }
      operation.status = "response_validated";
      const clonedPayload = structuredClone(payload);
      const validatedAt = now.toISOString();
      const sha256 = operationBufferSha256V1(clonedPayload);
      const unsignedBuffer = {
        kind,
        payload: clonedPayload,
        sha256,
        validatedAt,
      };
      operation.buffer = {
        ...unsignedBuffer,
        hmacSha256: operationBufferHmacSha256V1(
          operation,
          unsignedBuffer,
          this.safetyAuditHmacKey,
        ),
      };
      delete operation.leaseToken;
      delete operation.leaseExpiresAt;
      operation.updatedAt = now.toISOString();
      transaction.operations.save(operation);
    });
  }

  private expireLateBufferedOperation(
    transaction: PersistenceTransaction,
    session: SessionAggregate,
    operation: OperationJournalRecord,
    stagedEvents: ModelEvent[],
  ): ModelServiceError | undefined {
    if (
      operation.buffer === undefined ||
      Date.parse(operation.buffer.validatedAt) < Date.parse(session.expiresAt)
    ) {
      return undefined;
    }
    const error = new ModelServiceError(
      "SESSION_EXPIRED",
      "Session has expired.",
    );
    const from = session.sessionPhase;
    transitionSession(session, "expired");
    delete session.activeOperationId;
    operation.status = "failed";
    operation.failureCode = error.code;
    operation.updatedAt = this.clock.now().toISOString();
    delete operation.leaseToken;
    delete operation.leaseExpiresAt;
    const idempotency = this.requireOperationIdempotency(transaction, operation);
    idempotency.status = "failed";
    idempotency.error = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
    this.emitStateChanged(transaction, session, from, stagedEvents);
    this.emit(
      transaction,
      session,
      "request.error",
      { code: error.code, retryable: error.retryable },
      stagedEvents,
    );
    transaction.operations.save(operation);
    transaction.idempotency.save(idempotency);
    transaction.sessions.save(session);
    return error;
  }

  private preserveBufferedOperation(
    operationId: string,
    error: ModelServiceError,
  ): void {
    try {
      this.persistence.transaction((transaction) => {
        const operation = transaction.operations.get(operationId);
        if (!operation || operation.status !== "response_validated") return;
        operation.failureCode = error.code;
        operation.updatedAt = this.clock.now().toISOString();
        transaction.operations.save(operation);
        const idempotency = this.requireOperationIdempotency(
          transaction,
          operation,
        );
        idempotency.status = "recovery_required";
        idempotency.error = {
          code: "OPERATION_RECOVERY_REQUIRED",
          message: "The validated response is awaiting local recovery.",
          retryable: true,
        };
        transaction.idempotency.save(idempotency);
      });
    } catch {
      // The response_validated row remains authoritative even when this
      // best-effort recovery marker cannot be written.
    }
  }

  private commitBufferedOperation(
    transaction: PersistenceTransaction,
    session: SessionAggregate,
    operation: OperationJournalRecord,
    stagedEvents: ModelEvent[],
  ): void {
    if (
      operation.status !== "response_validated" ||
      operation.buffer === undefined ||
      !isValidDateString(operation.buffer.validatedAt) ||
      operation.buffer.sha256 !==
        operationBufferSha256V1(operation.buffer.payload) ||
      typeof operation.buffer.hmacSha256 !== "string" ||
      !operationBufferHmacMatchesV1(
        operation.buffer.hmacSha256,
        operation,
        operation.buffer,
        this.safetyAuditHmacKey,
      )
    ) {
      throw new ModelServiceError(
        "OPERATION_RECOVERY_REQUIRED",
        "Validated operation buffer is missing or corrupt.",
      );
    }
    const idempotency = this.requireOperationIdempotency(transaction, operation);
    if (operation.kind === "turn") {
      if (
        operation.buffer.kind !== "turn.v1" ||
        session.sessionPhase !== "awaiting_model"
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Turn buffer does not match the session state.",
        );
      }
      const payload = validateAndRebuildTurnBufferPayload(
        readTurnBufferPayload(
          operation.buffer.payload,
          operation,
          session,
        ),
        session,
        this.requireCase(session),
      );
      assertTurnOperationRequestMatches(
        operation,
        payload,
        this.safetyAuditHmacKey,
      );
      const response = payload.response;
      const turnAlreadyCommitted = session.turns.some(
        ({ turnId }) => turnId === response.turnId,
      );
      const interactionKind: StoredPatientInteractionKind =
        payload.patientAgentOutput?.interactionKind ??
          (payload.action === "other" ? "social_chat" : "medical_chat");
      const committedEffects = turnAlreadyCommitted
        ? []
        : structuredClone(response.effects);
      if (!turnAlreadyCommitted) {
        session.turns.push({
          turnId: response.turnId,
          clientTurnId: operation.idempotencyKey,
          text: payload.text,
          reply: response.reply,
          disclosedFactIds: [...response.disclosedFactIds],
          action: payload.action,
          requestedFactIds: [...payload.requestedFactIds],
          interactionKind,
          factIdsUsed: [
            ...(payload.patientAgentOutput?.factIdsUsed ??
              response.disclosedFactIds),
          ],
          personaFactIdsUsed: [
            ...(payload.patientAgentOutput?.personaFactIdsUsed ?? []),
          ],
          completedTestIdsUsed: [
            ...(payload.patientAgentOutput?.completedTestIdsUsed ?? []),
          ],
          effects: structuredClone(response.effects),
          turnNumber: response.turnNumber,
          createdAt: payload.createdAt,
        });
        session.turnCount = response.turnNumber;
        if (payload.action === "other") {
          session.otherTurnCount += 1;
        } else {
          session.medicalTurnCount += 1;
          if (payload.action === "repeat") session.repeatTurnCount += 1;
        }
        session.interactionKind = interactionKind;
        session.consecutiveOffTopicTurns = interactionKind === "social_chat"
          ? session.consecutiveOffTopicTurns + 1
          : 0;
        if (payload.patientAgentOutput?.suggestedTestId !== undefined) {
          session.pendingTestSuggestionId =
            payload.patientAgentOutput.suggestedTestId;
        } else {
          delete session.pendingTestSuggestionId;
        }
        for (const effect of response.effects) {
          if (effect.type === "test_completed") {
            applyCompletedTestResult(session, effect.result);
          }
        }
        for (const fact of payload.disclosedFacts) {
          if (!session.disclosedFacts.some(({ factId }) => factId === fact.factId)) {
            session.disclosedFacts.push(structuredClone(fact));
          }
        }
      }
      const from = session.sessionPhase;
      transitionSession(session, "active");
      delete session.activeOperationId;
      idempotency.status = "committed";
      idempotency.response = response;
      delete idempotency.error;
      this.emitStateChanged(transaction, session, from, stagedEvents);
      this.emit(
        transaction,
        session,
        "patient.reply.completed",
        {
          clientTurnId: operation.idempotencyKey,
          turnId: response.turnId,
          action: payload.action,
          requestedFactIds: [...payload.requestedFactIds],
          disclosedFactIds: [...response.disclosedFactIds],
          interactionKind,
          personaFactIdsUsed: [
            ...(payload.patientAgentOutput?.personaFactIdsUsed ?? []),
          ],
          completedTestIdsUsed: [
            ...(payload.patientAgentOutput?.completedTestIdsUsed ?? []),
          ],
          effects: structuredClone(response.effects),
        },
        stagedEvents,
      );
      for (const effect of committedEffects) {
        this.emit(
          transaction,
          session,
          "test.completed",
          effect.type === "test_completed"
            ? {
                testId: effect.result.testId,
                status: effect.result.status,
              }
            : {
                testId: effect.testId,
                status: "unavailable",
                reasonCode: effect.reasonCode,
              },
          stagedEvents,
        );
      }
    } else {
      if (
        operation.buffer.kind !== "evaluation.v1" ||
        session.sessionPhase !== "evaluating"
      ) {
        throw new ModelServiceError(
          "OPERATION_RECOVERY_REQUIRED",
          "Evaluation buffer does not match the session state.",
        );
      }
      const payload = operation.buffer.payload;
      assertEvaluationOperationRequestMatches(operation, session);
      assertEvaluationBufferPayload(
        payload,
        operation,
        session,
        this.requireCase(session),
      );
      const response = payload.response;
      session.evaluation = structuredClone(response);
      const from = session.sessionPhase;
      transitionSession(session, "completed");
      delete session.activeOperationId;
      idempotency.status = "committed";
      idempotency.response = response;
      delete idempotency.error;
      this.emitStateChanged(transaction, session, from, stagedEvents);
      this.emit(
        transaction,
        session,
        "evaluation.completed",
        {
          diagnosisCorrect: response.diagnosis.correct,
          scoreTotal: response.scores.total,
          evaluationVersion: response.evaluationVersion,
        },
        stagedEvents,
      );
    }
    operation.status = "committed";
    operation.updatedAt = this.clock.now().toISOString();
    delete operation.leaseToken;
    delete operation.leaseExpiresAt;
    transaction.operations.save(operation);
    transaction.idempotency.save(idempotency);
    transaction.sessions.save(session);
  }

  private failOperation(
    operationId: string,
    error: ModelServiceError,
    fence?: DispatchFence,
  ): void {
    try {
      const redactedLegacyRequest = this.transact((transaction, stagedEvents) => {
        const operation = transaction.operations.get(operationId);
        if (!operation || operation.status === "committed") return false;
        if (
          fence !== undefined &&
          (operation.status !== "dispatched" ||
            operation.leaseToken !== fence.leaseToken ||
            operation.attemptCount !== fence.attemptCount)
        ) {
          return false;
        }
        operation.status = "failed";
        operation.failureCode = error.code;
        operation.updatedAt = this.clock.now().toISOString();
        transaction.operations.save(operation);
        return this.restoreAfterOperationFailure(
          transaction,
          operation,
          error,
          stagedEvents,
        );
      });
      if (redactedLegacyRequest) this.persistence.purgeSensitiveData?.();
    } catch {
      // Preserve the original error. Recovery tooling can inspect a journal row
      // left nonterminal if the failure transaction itself could not commit.
    }
  }

  private restoreAfterOperationFailure(
    transaction: PersistenceTransaction,
    operation: OperationJournalRecord,
    error: ModelServiceError,
    stagedEvents: ModelEvent[],
  ): boolean {
    const session = this.requireSessionWithoutExpiry(
      transaction,
      operation.sessionId,
    );
    const ownsActiveOperation =
      session.activeOperationId === operation.operationId;
    const fallback = operation.kind === "turn" ? "active" : "diagnosis_submitted";
    if (
      (ownsActiveOperation &&
        operation.kind === "turn" &&
        session.sessionPhase === "awaiting_model") ||
      (ownsActiveOperation &&
        operation.kind === "evaluation" &&
        session.sessionPhase === "evaluating")
    ) {
      const from = session.sessionPhase;
      transitionSession(session, fallback);
      this.emitStateChanged(transaction, session, from, stagedEvents);
    }
    if (ownsActiveOperation) delete session.activeOperationId;
    const idempotency = this.requireOperationIdempotency(transaction, operation);
    idempotency.status = "failed";
    idempotency.error = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
    transaction.idempotency.save(idempotency);
    const safetyInterruption = error instanceof ProviderSafetyInterruptionError
      ? error.interruption
      : undefined;
    const providerSafetyRequest = error instanceof ProviderSafetyInterruptionError
      ? error.audit
      : undefined;
    const legacyText =
      operation.kind === "turn" &&
      isRecord(operation.request) &&
      typeof operation.request["text"] === "string"
        ? operation.request["text"]
        : undefined;
    const legacySafetyRequest = legacyText === undefined
      ? undefined
      : {
          textLength: legacyText.length,
          inputHmac: safetyRequestFingerprint(
            "submit_turn",
            operation.sessionId,
            { text: legacyText },
            this.safetyAuditHmacKey,
          ),
        };
    const safetyRequest = providerSafetyRequest ?? legacySafetyRequest;
    if (safetyRequest !== undefined) {
      operation.requestHash = safetyRequest.inputHmac;
      operation.request = {
        clientTurnId: operation.idempotencyKey,
        redacted: true,
        textLength: safetyRequest.textLength,
        inputHmac: safetyRequest.inputHmac,
      };
      idempotency.requestHash = safetyRequest.inputHmac;
      if (legacySafetyRequest !== undefined) delete operation.buffer;
      transaction.operations.save(operation);
      transaction.idempotency.save(idempotency);
    }
    this.emit(
      transaction,
      session,
      safetyInterruption !== undefined || error.code.startsWith("SAFETY_")
        ? "safety.interrupted"
        : "request.error",
      safetyInterruption !== undefined
        ? {
            decision: safetyInterruption.decision,
            templateId: safetyInterruption.templateId,
            policyVersion: safetyInterruption.policyVersion,
            ruleIds: [...safetyInterruption.ruleIds],
            source: "provider_controller_fallback",
            ...safetyRequest,
          }
        : error.code.startsWith("SAFETY_")
          ? { code: error.code }
          : { code: error.code, retryable: error.retryable },
      stagedEvents,
    );
    transaction.sessions.save(session);
    return legacySafetyRequest !== undefined;
  }

  private recoverOnStartup(): void {
    const redactedLegacyRequest = this.transact((transaction, stagedEvents) => {
      let redacted = false;
      for (const original of transaction.sessions.list()) {
        let session = transaction.sessions.get(original.sessionId)!;
        if (session.sessionPhase === "created") {
          const from = session.sessionPhase;
          if (
            this.cases.findByPublicIdAndVersion(
              session.publicCaseId,
              session.caseVersion,
            )
          ) {
            transitionSession(session, "active");
          } else {
            transitionSession(session, "failed");
            session.failureCode = "CASE_VERSION_NOT_FOUND";
          }
          this.emitStateChanged(transaction, session, from, stagedEvents);
          transaction.sessions.save(session);
        }
        if (
          session.sessionPhase === "awaiting_model" ||
          session.sessionPhase === "evaluating"
        ) {
          const operation = session.activeOperationId
            ? transaction.operations.get(session.activeOperationId)
            : transaction.operations
                .listForSession(session.sessionId)
                .find(({ status }) =>
                  [
                    "prepared",
                    "dispatched",
                    "response_validated",
                    "unknown",
                    "failed",
                  ].includes(status),
                );
          if (!operation) {
            const from = session.sessionPhase;
            transitionSession(
              session,
              session.sessionPhase === "awaiting_model"
                ? "active"
                : "diagnosis_submitted",
            );
            delete session.activeOperationId;
            this.emitStateChanged(transaction, session, from, stagedEvents);
            transaction.sessions.save(session);
          } else if (
            operation.status === "response_validated" &&
            operation.buffer !== undefined
          ) {
            const expiryError = this.expireLateBufferedOperation(
              transaction,
              session,
              operation,
              stagedEvents,
            );
            if (expiryError === undefined) {
              this.commitBufferedOperation(
                transaction,
                session,
                operation,
                stagedEvents,
              );
            }
          } else if (operation.status === "dispatched") {
            operation.status = "unknown";
            operation.updatedAt = this.clock.now().toISOString();
            transaction.operations.save(operation);
            const idempotency = this.requireOperationIdempotency(
              transaction,
              operation,
            );
            idempotency.status = "recovery_required";
            transaction.idempotency.save(idempotency);
          } else if (
            operation.status === "prepared" ||
            operation.status === "unknown"
          ) {
            const idempotency = this.requireOperationIdempotency(
              transaction,
              operation,
            );
            idempotency.status = "recovery_required";
            transaction.idempotency.save(idempotency);
          } else if (operation.status === "failed") {
            redacted = this.restoreAfterOperationFailure(
              transaction,
              operation,
              new ModelServiceError(
                (operation.failureCode as ModelServiceErrorCode | undefined) ??
                  "MODEL_UNAVAILABLE",
                "The interrupted operation failed.",
                { retryable: true },
              ),
              stagedEvents,
            ) || redacted;
          }
        }
        session = transaction.sessions.get(original.sessionId)!;
        const from = session.sessionPhase;
        if (expireSessionIfNeeded(session, this.clock.now())) {
          this.emitStateChanged(transaction, session, from, stagedEvents);
          transaction.sessions.save(session);
        }
      }
      transaction.idempotency.deleteExpired(this.clock.now());
      return redacted;
    });
    if (redactedLegacyRequest) this.persistence.purgeSensitiveData?.();
  }

  private transact<T>(
    work: (
      transaction: PersistenceTransaction,
      stagedEvents: ModelEvent[],
    ) => T,
  ): T {
    const stagedEvents: ModelEvent[] = [];
    const result = this.persistence.transaction((transaction) =>
      work(transaction, stagedEvents),
    );
    for (const event of stagedEvents) {
      try {
        const appendResult = this.eventSink.append(structuredClone(event));
        if (appendResult !== undefined) {
          void Promise.resolve(appendResult).catch((error: unknown) => {
            this.reportEventSinkError(error, event);
          });
        }
      } catch (error) {
        this.reportEventSinkError(error, event);
      }
    }
    return result;
  }

  private reportEventSinkError(error: unknown, event: ModelEvent): void {
    try {
      const reportResult = this.onEventSinkError?.(
        error,
        structuredClone(event),
      );
      if (reportResult !== undefined) {
        void Promise.resolve(reportResult).catch(() => undefined);
      }
    } catch {
      // The persisted audit event is authoritative; observer failures must
      // never turn an already committed operation into an API failure.
    }
  }

  private assertProviderIdentity(): void {
    const identity = this.provider.identity;
    if (
      identity.providerName !== this.providerName ||
      identity.modelId !== this.modelId ||
      identity.promptVersion !== this.promptVersion
    ) {
      throw new ModelServiceError(
        "OPERATION_RECOVERY_REQUIRED",
        "The configured provider identity changed after service startup.",
      );
    }
  }

  private async callProvider<T>(
    operationId: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } finally {
      this.persistProviderCallRecords(operationId);
    }
  }

  private persistProviderCallRecords(operationId: string): void {
    const drain = this.provider.drainCallRecords;
    if (drain === undefined) return;
    const records = drain.call(this.provider, operationId);
    if (!Array.isArray(records) || records.length === 0) return;
    this.transact((transaction, stagedEvents) => {
      const operation = this.requireOperation(transaction, operationId);
      const session = this.requireSessionWithoutExpiry(
        transaction,
        operation.sessionId,
      );
      for (const record of records) {
        this.assertProviderCallRecord(record, operation);
        if (record.providerRequestId !== undefined) {
          operation.providerRequestId = record.providerRequestId;
        }
        this.emit(
          transaction,
          session,
          `provider.call.${record.status}`,
          {
            operationId: record.operationId,
            role: record.role,
            providerName: record.providerName,
            modelId: record.modelId,
            promptVersion: record.promptVersion,
            promptSha256: record.promptSha256,
            schemaName: record.schemaName,
            responseStatus: record.responseStatus ?? null,
            finishReason: record.finishReason ?? null,
            providerRequestId: record.providerRequestId ?? null,
            attemptCount: record.retryCount + 1,
            retryCount: record.retryCount,
            durationMs: record.durationMs,
            usage: record.usage ?? null,
            failureCode: record.failureCode ?? null,
          },
          stagedEvents,
        );
      }
      transaction.operations.save(operation);
      transaction.sessions.save(session);
    });
  }

  private assertProviderCallRecord(
    record: ProviderCallRecord,
    operation: OperationJournalRecord,
  ): void {
    const safeString = (value: unknown, maxLength = 256): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= maxLength &&
      !/[\r\n\0]/u.test(value);
    const safeCount = (value: unknown): value is number =>
      Number.isSafeInteger(value) && Number(value) >= 0;
    const usage = record.usage;
    if (
      record.operationId !== operation.operationId ||
      record.providerName !== this.providerName ||
      record.promptVersion !== this.promptVersion ||
      !safeString(record.modelId) ||
      !["controller", "patient", "review"].includes(record.role) ||
      !["completed", "failed"].includes(record.status) ||
      !safeString(record.promptSha256, 64) ||
      !/^[a-f0-9]{64}$/u.test(record.promptSha256) ||
      !safeString(record.schemaName, 64) ||
      !safeCount(record.retryCount) ||
      record.retryCount > 1 ||
      typeof record.durationMs !== "number" ||
      !Number.isFinite(record.durationMs) ||
      record.durationMs < 0 ||
      (record.providerRequestId !== undefined &&
        !safeString(record.providerRequestId, MAX_ID_LENGTH)) ||
      (record.responseStatus !== undefined &&
        !safeString(record.responseStatus, 64)) ||
      (record.finishReason !== undefined &&
        !safeString(record.finishReason, 128)) ||
      (record.failureCode !== undefined &&
        !safeString(record.failureCode, 128)) ||
      (usage !== undefined &&
        (!safeCount(usage.inputTokens) ||
          !safeCount(usage.outputTokens) ||
          !safeCount(usage.totalTokens) ||
          (usage.cachedInputTokens !== undefined &&
            !safeCount(usage.cachedInputTokens)) ||
          (usage.reasoningOutputTokens !== undefined &&
            !safeCount(usage.reasoningOutputTokens))))
    ) {
      throw new ModelProviderOutputError(
        "Provider call metadata failed validation.",
      );
    }
  }

  private requireSession(
    transaction: PersistenceTransaction,
    sessionId: string,
    stagedEvents: ModelEvent[],
  ): SessionAggregate {
    const session = this.requireSessionWithoutExpiry(transaction, sessionId);
    const from = session.sessionPhase;
    if (expireSessionIfNeeded(session, this.clock.now())) {
      this.emitStateChanged(transaction, session, from, stagedEvents);
      transaction.sessions.save(session);
    }
    return session;
  }

  private requireSessionWithoutExpiry(
    transaction: PersistenceTransaction,
    sessionId: string,
  ): SessionAggregate {
    const session = transaction.sessions.get(sessionId);
    if (!session) {
      throw new ModelServiceError(
        "SESSION_NOT_FOUND",
        "Session was not found.",
      );
    }
    return session;
  }

  private requireCase(session: SessionAggregate): SupportedCasePackage {
    const casePackage = this.cases.findByPublicIdAndVersion(
      session.publicCaseId,
      session.caseVersion,
    );
    if (!casePackage) {
      throw new ModelServiceError(
        "INVALID_SESSION_STATE",
        "The frozen case version is unavailable.",
      );
    }
    return casePackage;
  }

  private assertSessionScope(
    session: SessionAggregate,
    idempotencyScopeId: string | undefined,
  ): void {
    if (
      idempotencyScopeId !== undefined &&
      session.userId !== idempotencyScopeId
    ) {
      throw new ModelServiceError(
        "SESSION_NOT_FOUND",
        "Session was not found.",
      );
    }
  }

  private requireOperation(
    transaction: PersistenceTransaction,
    operationId: string,
  ): OperationJournalRecord {
    const operation = transaction.operations.get(operationId);
    if (!operation) {
      throw new ModelServiceError(
        "OPERATION_RECOVERY_REQUIRED",
        "Operation was not found.",
      );
    }
    return operation;
  }

  private requireOperationIdempotency(
    transaction: PersistenceTransaction,
    operation: OperationJournalRecord,
  ): IdempotencyRecord {
    const idempotencyOperation =
      operation.kind === "turn" ? "submit_turn" : "submit_diagnosis";
    const record = transaction.idempotency.get(
      operation.sessionId,
      idempotencyOperation,
      operation.idempotencyKey,
    );
    if (!record || record.requestHash !== operation.requestHash) {
      throw new ModelServiceError(
        "OPERATION_RECOVERY_REQUIRED",
        "Operation idempotency record is missing or inconsistent.",
      );
    }
    return record;
  }

  private replayIdempotency<T>(
    transaction: PersistenceTransaction,
    scopeId: string,
    operation: IdempotencyOperationV1,
    idempotencyKey: string,
    requestHash: string,
    alternateRequestHashes: readonly string[] = [],
  ): T | undefined {
    const existing = transaction.idempotency.get(
      scopeId,
      operation,
      idempotencyKey,
    );
    if (!existing) return undefined;
    if (
      existing.requestHash !== requestHash &&
      !alternateRequestHashes.includes(existing.requestHash)
    ) {
      throw new ModelServiceError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used with a different payload.",
      );
    }
    if (existing.status === "committed") {
      return structuredClone(existing.response) as T;
    }
    if (existing.status === "failed" && existing.error) {
      throw new ModelServiceError(
        existing.error.code as ModelServiceErrorCode,
        existing.error.message,
        { retryable: existing.error.retryable },
      );
    }
    throw new ModelServiceError(
      existing.status === "in_progress"
        ? "OPERATION_IN_PROGRESS"
        : "OPERATION_RECOVERY_REQUIRED",
      "The operation has not reached a stable committed result.",
      { retryable: true },
    );
  }

  private inProgressIdempotency(
    scopeId: string,
    operation: IdempotencyOperationV1,
    idempotencyKey: string,
    requestHash: string,
    operationId: string,
    now: Date,
  ): IdempotencyRecord {
    return {
      scopeId,
      operation,
      idempotencyKey,
      requestHash,
      status: "in_progress",
      operationId,
      createdAt: now.toISOString(),
      retainUntil: new Date(
        now.getTime() + IDEMPOTENCY_RETENTION_MS,
      ).toISOString(),
    };
  }

  private sessionView(
    session: SessionAggregate,
    casePackage: SupportedCasePackage,
  ): PublicSessionView {
    const visible = casePackage.playerVisible;
    const identity = casePackage.schemaVersion === "case-package-v2-rc1"
      ? casePackage.patientIdentity
      : casePackage.playerVisible;
    return {
      contractVersion: "1",
      sessionId: session.sessionId,
      caseId: casePackage.publicCaseId,
      caseVersion: casePackage.caseVersion,
      patientNpcId: session.patientNpcId,
      patientRoleId: publicPatientRoleIdForCase(casePackage),
      chiefComplaint: visible.chiefComplaint,
      patientDisplay: {
        displayName: identity.patientDisplayName,
        ...(identity.ageBand === undefined ? {} : { ageBand: identity.ageBand }),
        ...(identity.genderDisplay === undefined
          ? {}
          : { genderDisplay: identity.genderDisplay }),
      },
      allowedActions:
        session.sessionPhase === "active"
          ? ["ask_patient", "order_test", "submit_diagnosis"]
          : [],
      sessionPhase: session.sessionPhase,
    };
  }

  private projection(
    session: SessionAggregate,
    casePackage: SupportedCasePackage,
  ): PublicSessionProjection {
    return {
      sessionId: session.sessionId,
      caseVersion: session.caseVersion,
      initialPresentation: casePackage.playerVisible.chiefComplaint,
      disclosedFacts: session.disclosedFacts.map((fact) => ({ ...fact })),
      completedTests: session.completedTests.map((test) => ({ ...test })),
      turnCount: session.medicalTurnCount,
      turnLimit: casePackage.rubric.recommendedTurnLimit,
      sessionPhase: session.sessionPhase,
    };
  }

  private emit(
    transaction: PersistenceTransaction,
    session: SessionAggregate,
    eventType: string,
    payload: Record<string, unknown>,
    stagedEvents: ModelEvent[],
  ): void {
    session.eventSequence += 1;
    const event: ModelEvent = {
      eventId: this.ids.next("event"),
      eventType,
      sessionId: session.sessionId,
      sequence: session.eventSequence,
      emittedAt: this.clock.now().toISOString(),
      payload,
    };
    transaction.events.append(event);
    stagedEvents.push(structuredClone(event));
  }

  private emitStateChanged(
    transaction: PersistenceTransaction,
    session: SessionAggregate,
    from: SessionPhaseV1,
    stagedEvents: ModelEvent[],
  ): void {
    this.emit(
      transaction,
      session,
      "session.state_changed",
      { from, to: session.sessionPhase },
      stagedEvents,
    );
  }
}
