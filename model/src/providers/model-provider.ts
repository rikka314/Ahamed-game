import type {
  CasePackage,
  FactStatus,
} from "../domain/case-package.js";

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

export interface PatientReply {
  reply: string;
  factsUsed: string[];
  newFactsClaimed: string[];
  diagnosisLeak: boolean;
}

export interface EvaluationEvidence {
  criterionId: string;
  outcome: "met" | "partial" | "missed" | "not_applicable";
  explanation: string;
  supportingTurnIds?: string[];
  supportingTestIds?: string[];
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
    communication: number;
    total: number;
  };
  evidence: EvaluationEvidence[];
  summary: string;
  evaluationVersion: string;
}

export interface EvaluationInput {
  casePackage: CasePackage;
  primaryDiagnosis: string;
  differentials: string[];
  disclosedFactIds: string[];
  completedTestIds: string[];
  turnIds: string[];
}

export interface ModelProvider {
  classifyTurn(input: {
    text: string;
    locale: string;
    factIndex: FactIndexEntry[];
  }): Promise<ControllerDecision>;

  generatePatientReply(input: {
    locale: string;
    languageStyle: string;
    allowedFacts: AllowedFact[];
  }): Promise<PatientReply>;

  evaluate(input: EvaluationInput): Promise<MedicalEvaluation>;
}
