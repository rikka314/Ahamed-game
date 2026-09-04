import type { ClientRequestIdV1, SubmissionIdV1 } from "./ids.js";

export type DiagnosisSubmissionV1 = {
  clientRequestId: ClientRequestIdV1;
  primaryDiagnosis: string;
  differentials: string[];
  notes?: string;
};
export type DiagnosisAcceptedV1 = { submissionId: SubmissionIdV1; sessionPhase: "diagnosis_submitted" | "evaluating" };
