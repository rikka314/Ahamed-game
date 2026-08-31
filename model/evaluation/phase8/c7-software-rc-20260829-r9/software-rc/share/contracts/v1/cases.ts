import type { CaseIdV1, CaseVersionV1, ClientRequestIdV1, FactIdV1, GameProfileIdV1, NpcIdV1, SessionIdV1, UserIdV1 } from "./ids.js";
import type { SessionPhaseV1 } from "./sessions.js";
import type { TestResultV1 } from "./tests.js";

export const CASE_ACTIONS_V1 = ["ask_patient", "order_test", "submit_diagnosis"] as const;
export type CaseActionV1 = (typeof CASE_ACTIONS_V1)[number];
export const FACT_TRUTH_STATES_V1 = ["present", "absent", "unknown"] as const;
export type FactTruthStateV1 = (typeof FACT_TRUTH_STATES_V1)[number];

export type PatientDisplayV1 = {
  displayName: string;
  ageBand?: string;
  genderDisplay?: string;
  portraitAssetId?: string;
};

export type CaseSummaryV1 = {
  contractVersion: "1";
  sessionId: SessionIdV1;
  caseId: CaseIdV1;
  caseVersion: CaseVersionV1;
  patientNpcId: NpcIdV1;
  title?: string;
  chiefComplaint: string;
  patientDisplay: PatientDisplayV1;
  allowedActions: CaseActionV1[];
  sessionPhase: SessionPhaseV1;
};

export type DisclosedFactV1 = {
  factId: FactIdV1;
  displayText: string;
  disclosedAtTurn: number;
};

export type ClientCaseProjectionV1 = {
  contractVersion: "1";
  sessionId: SessionIdV1;
  caseVersion: CaseVersionV1;
  initialPresentation: string;
  disclosedFacts: DisclosedFactV1[];
  completedTests: TestResultV1[];
  turnCount: number;
  turnLimit?: number;
  sessionPhase: SessionPhaseV1;
};

export type CaseSelectionV1 =
  | { mode: "daily" }
  | { mode: "specific"; publicCaseId: CaseIdV1 }
  | { mode: "fixture"; fixtureId: string };

export type CreateSessionRequestV1 = {
  clientRequestId: ClientRequestIdV1;
  userId?: UserIdV1;
  gameProfileId?: GameProfileIdV1;
  caseSelection: CaseSelectionV1;
  locale: string;
};

export type CreateSessionResponseV1 = {
  session: CaseSummaryV1;
  projection: ClientCaseProjectionV1;
};

export const CLIENT_CASE_PROJECTION_KEYS_V1 = [
  "contractVersion",
  "sessionId",
  "caseVersion",
  "initialPresentation",
  "disclosedFacts",
  "completedTests",
  "turnCount",
  "turnLimit",
  "sessionPhase",
] as const satisfies readonly (keyof ClientCaseProjectionV1)[];

export function projectClientCaseV1(input: ClientCaseProjectionV1): ClientCaseProjectionV1 {
  const output: ClientCaseProjectionV1 = {
    contractVersion: input.contractVersion,
    sessionId: input.sessionId,
    caseVersion: input.caseVersion,
    initialPresentation: input.initialPresentation,
    disclosedFacts: input.disclosedFacts.map((fact) => ({
      factId: fact.factId,
      displayText: fact.displayText,
      disclosedAtTurn: fact.disclosedAtTurn,
    })),
    completedTests: input.completedTests.map((test) => ({
      testId: test.testId,
      status: test.status,
      ...(test.report === undefined ? {} : { report: test.report }),
      ...(test.assetId === undefined ? {} : { assetId: test.assetId }),
      ...(test.completedAt === undefined ? {} : { completedAt: test.completedAt }),
      ...(test.reasonCode === undefined ? {} : { reasonCode: test.reasonCode }),
    })),
    turnCount: input.turnCount,
    sessionPhase: input.sessionPhase,
  };
  if (input.turnLimit !== undefined) output.turnLimit = input.turnLimit;
  return output;
}
