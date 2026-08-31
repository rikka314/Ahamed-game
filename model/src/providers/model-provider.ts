import type {
  CasePackage,
  FactStatus,
} from "../domain/case-package.js";
import type {
  PatientProfile,
  SafePatientCaseView,
} from "../domain/safe-patient-case-view.js";
import type { CommunicationAssessment } from "../evaluation/scoring-policy-v1.js";

export interface FactIndexEntry {
  factId: string;
  questionMatchers: string[];
}

export type ControllerDecision =
  | {
      action: "ask_patient";
      requestedFactIds: string[];
    }
  | {
      action: "other";
      requestedFactIds: [];
    }
  | {
      action: "unsafe";
      requestedFactIds: [];
      safetyCode:
        | "SAFETY_PROMPT_INJECTION"
        | "SAFETY_REAL_HEALTH_INPUT";
    };

export interface AllowedFact {
  factId: string;
  status: FactStatus;
  value: string;
}

export type PatientInteractionKind =
  | "medical_chat"
  | "social_chat"
  | "test_query"
  | "test_order";

export type PatientDiagnosisIntent =
  | {
      decision: "continue_dialogue";
      primaryDiagnosis: null;
      differentialDiagnoses: [];
      candidateDiagnoses: string[];
    }
  | {
      decision: "submit_diagnosis";
      primaryDiagnosis: string;
      differentialDiagnoses: string[];
      candidateDiagnoses: [];
    };

export interface CommittedTurn {
  turnId: string;
  userText: string;
  patientReply: string;
  committedAt: string;
}

export interface PatientAgentInput {
  userText: string;
  patientProfile: PatientProfile;
  safeCaseView: SafePatientCaseView;
  recentTurns: CommittedTurn[];
  disclosedFactIds: string[];
  completedTests: Array<{
    testId: string;
    status: "unavailable" | "completed";
    report?: string;
    assetId?: string;
    reasonCode?: string;
  }>;
  consecutiveOffTopicTurns: number;
  pendingTestSuggestionId?: string;
  regenerationInstruction?: string;
}

export interface PatientAgentOutput {
  reply: string;
  interactionKind: PatientInteractionKind;
  factIdsUsed: string[];
  personaFactIdsUsed: string[];
  completedTestIdsUsed: string[];
  requestedTestId?: string;
  suggestedTestId?: string;
  /**
   * Required by the v0.4 structured provider schema. Optional here only so
   * pre-v0.4 buffered/test providers can safely normalize to continue_dialogue.
   */
  diagnosisIntent?: PatientDiagnosisIntent;
  newFactsClaimed: string[];
  diagnosisLeak: boolean;
}

export type PatientReply = PatientAgentOutput;

export interface ProviderCallUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export type ProviderRole = "controller" | "patient" | "review";

export interface StructuredProviderResponseSchema {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

export interface StructuredProviderTransportRequest {
  operationId: string;
  clientRequestId: string;
  role: ProviderRole;
  modelId: string;
  instructions: string;
  input: string;
  schema: StructuredProviderResponseSchema;
  store: false;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface StructuredProviderTransportResponse {
  status: string;
  outputText: string;
  responseId: string;
  requestId?: string;
  modelId: string;
  finishReason?: string;
  failureCode?: string;
  usage?: ProviderCallUsage;
}

export interface StructuredProviderTransport {
  readonly providerName: string;
  readonly protocol: string;
  readonly endpointSha256: string;
  create(
    request: StructuredProviderTransportRequest,
  ): Promise<StructuredProviderTransportResponse>;
}

export interface ProviderCallRecord {
  operationId: string;
  role: ProviderRole;
  providerName: string;
  modelId: string;
  promptVersion: string;
  promptSha256: string;
  schemaName: string;
  status: "completed" | "failed";
  responseStatus?: string;
  finishReason?: string;
  providerRequestId?: string;
  retryCount: number;
  durationMs: number;
  usage?: ProviderCallUsage;
  failureCode?: string;
}

export interface EvaluationEvidence {
  criterionId: string;
  outcome: "met" | "partial" | "missed" | "not_applicable";
  explanation: string;
  supportingTurnIds?: string[];
  supportingTestIds?: string[];
}

export interface ReviewEvaluationProjectionV1 {
  scores: {
    diagnosis: number;
    historyCoverage: number;
    differentialReasoning: number;
    testSelection: number;
    efficiency: number;
  };
  evidence: EvaluationEvidence[];
  evaluationVersion: string;
}

export interface MedicalEvaluation {
  diagnosis: {
    correct: boolean;
    matchType?: "exact" | "synonym" | "semantic";
    explanation: string;
  };
  scores: {
    diagnosis: number;
    historyCoverage: number;
    differentialReasoning: number;
    testSelection: number;
    efficiency: number;
    communication: number | null;
    total: number | null;
  };
  evidence: EvaluationEvidence[];
  summary: string;
  evaluationVersion: string;
}

export interface ProviderMedicalEvaluation extends MedicalEvaluation {
  communicationAssessment: CommunicationAssessment;
}

export interface EvaluationInput {
  casePackage: CasePackage;
  primaryDiagnosis: string;
  differentials: string[];
  disclosedFactIds: string[];
  completedTestIds: string[];
  turnIds: string[];
  turns?: Array<{ turnId: string; text: string; reply: string }>;
  completedTests?: Array<{
    testId: string;
    status: "unavailable" | "completed";
    report?: string;
    assetId?: string;
    reasonCode?: string;
  }>;
  medicalTurnCount?: number;
  repeatTurnCount?: number;
  otherTurnCount?: number;
}

export interface ModelProviderIdentity {
  readonly providerName: string;
  readonly modelId: string;
  readonly promptVersion: string;
}

export interface ProviderReproducibilityManifest {
  adapterVersion: string;
  sdkVersion: string;
  schemaVersion: string;
  protocol: string;
  endpointSha256: string;
  promptSha256ByRole: Record<ProviderRole, string>;
  schemaSha256ByRole: Record<ProviderRole, string>;
}

export class ModelProviderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProviderOutputError";
  }
}

export class ModelProviderIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProviderIdentityError";
  }
}

export class ModelProviderRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly providerRequestId: string | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      retryable: boolean;
      status?: number;
      providerRequestId?: string;
    },
  ) {
    super(message);
    this.name = "ModelProviderRequestError";
    this.code = code;
    this.retryable = options.retryable;
    this.status = options.status;
    this.providerRequestId = options.providerRequestId;
  }
}

export interface ControllerInput {
  operationId: string;
  text: string;
  locale: string;
  factIndex: FactIndexEntry[];
}

export interface PatientInput extends PatientAgentInput {
  operationId: string;
}

export interface ReviewInput {
  operationId: string;
  locale: string;
  deterministicEvaluation: ReviewEvaluationProjectionV1;
  turns: Array<{ turnId: string; text: string; reply: string }>;
  completedTests: Array<{
    testId: string;
    status: "unavailable" | "completed";
    report?: string;
  }>;
  communicationRubricVersion: string;
  communicationCriterionIds: string[];
}

export interface ReviewOutput {
  communicationAssessment: CommunicationAssessment;
  summary: string;
}

export interface ControllerProvider {
  readonly identity: ModelProviderIdentity;
  classifyTurn(input: ControllerInput): Promise<ControllerDecision>;
}

export interface PatientProvider {
  readonly identity: ModelProviderIdentity;
  generatePatientReply(input: PatientInput): Promise<PatientReply>;
}

export interface ReviewProvider {
  readonly identity: ModelProviderIdentity;
  review(input: ReviewInput): Promise<ReviewOutput>;
}

export interface ModelProvider extends ControllerProvider, PatientProvider {
  readonly identity: ModelProviderIdentity;

  evaluate(
    input: EvaluationInput & { operationId: string },
  ): Promise<ProviderMedicalEvaluation>;

  beginOperation?(operationId: string, retryBudget: number): void;
  finishOperation?(operationId: string): void;
  reproducibilityManifest?(): ProviderReproducibilityManifest;
  drainCallRecords?(operationId: string): ProviderCallRecord[];
}
