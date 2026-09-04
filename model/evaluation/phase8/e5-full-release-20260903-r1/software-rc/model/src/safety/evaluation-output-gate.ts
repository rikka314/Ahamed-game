import { isDeepStrictEqual } from "node:util";

import { ModelServiceError } from "../domain/errors.js";
import { evaluateDeterministically } from "../evaluation/deterministic-evaluator.js";
import type { CommunicationAssessment } from "../evaluation/scoring-policy-v1.js";
import type {
  EvaluationInput,
  MedicalEvaluation,
} from "../providers/model-provider.js";

export interface ValidatedMedicalEvaluationV1 {
  evaluation: MedicalEvaluation;
  communicationAssessment: CommunicationAssessment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}

function reject(message: string): never {
  throw new ModelServiceError("MODEL_OUTPUT_REJECTED", message);
}

export function validateEvaluationOutputV1(
  value: unknown,
  input: EvaluationInput,
  expectedEvaluationVersion: string,
): ValidatedMedicalEvaluationV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "diagnosis",
      "scores",
      "evidence",
      "summary",
      "evaluationVersion",
      "communicationAssessment",
    ]) ||
    !isRecord(value["diagnosis"]) ||
    !isRecord(value["scores"]) ||
    !isRecord(value["communicationAssessment"])
  ) {
    reject("Evaluation output failed the Phase 7 validation gate.");
  }

  const diagnosis = value["diagnosis"];
  const scores = value["scores"];
  const communicationAssessment = value["communicationAssessment"];
  const deterministicScoreKeys = [
    "diagnosis",
    "historyCoverage",
    "differentialReasoning",
    "testSelection",
    "efficiency",
  ] as const;
  const knownTurnIds = new Set(input.turnIds);
  const knownTestIds = new Set(input.completedTestIds);
  const knownRubricCriterionIds = new Set(
    input.casePackage.rubric.communicationCriterionIds,
  );
  const validCommunicationAssessment =
    (communicationAssessment["status"] === "available" &&
      hasExactKeys(communicationAssessment, [
        "status",
        "score",
        "supportingTurnIds",
        "rubricCriterionIds",
      ]) &&
      typeof communicationAssessment["score"] === "number" &&
      [0, 50, 100].includes(communicationAssessment["score"]) &&
      isUniqueStringArray(communicationAssessment["supportingTurnIds"]) &&
      communicationAssessment["supportingTurnIds"].length > 0 &&
      communicationAssessment["supportingTurnIds"].every((turnId) =>
        knownTurnIds.has(turnId),
      ) &&
      isUniqueStringArray(communicationAssessment["rubricCriterionIds"]) &&
      communicationAssessment["rubricCriterionIds"].length > 0 &&
      (communicationAssessment["score"] !== 100 ||
        communicationAssessment["rubricCriterionIds"].length >= 2) &&
      communicationAssessment["rubricCriterionIds"].every((criterionId) =>
        knownRubricCriterionIds.has(criterionId),
      )) ||
    (communicationAssessment["status"] === "unavailable" &&
      hasExactKeys(communicationAssessment, ["status", "failureCode"]) &&
      typeof communicationAssessment["failureCode"] === "string" &&
      communicationAssessment["failureCode"].trim().length > 0);

  if (
    !validCommunicationAssessment ||
    !hasExactKeys(diagnosis, ["correct", "explanation"], ["matchType"]) ||
    typeof diagnosis["correct"] !== "boolean" ||
    typeof diagnosis["explanation"] !== "string" ||
    diagnosis["explanation"].trim().length === 0 ||
    diagnosis["explanation"].length > 4_000 ||
    (diagnosis["matchType"] !== undefined &&
      !["exact", "synonym", "semantic"].includes(
        String(diagnosis["matchType"]),
      )) ||
    !hasExactKeys(scores, [
      ...deterministicScoreKeys,
      "communication",
      "total",
    ]) ||
    !deterministicScoreKeys.every((key) =>
      Number.isSafeInteger(scores[key]) &&
      Number(scores[key]) >= 0 &&
      Number(scores[key]) <= 100,
    ) ||
    !(
      scores["communication"] === null ||
      (typeof scores["communication"] === "number" &&
        [0, 50, 100].includes(scores["communication"]))
    ) ||
    !(
      scores["total"] === null ||
      (Number.isSafeInteger(scores["total"]) &&
        Number(scores["total"]) >= 0 &&
        Number(scores["total"]) <= 100)
    ) ||
    (scores["communication"] === null) !== (scores["total"] === null) ||
    (communicationAssessment["status"] === "available" &&
      (scores["communication"] !== communicationAssessment["score"] ||
        scores["total"] === null)) ||
    (communicationAssessment["status"] === "unavailable" &&
      (scores["communication"] !== null || scores["total"] !== null)) ||
    !Array.isArray(value["evidence"]) ||
    !value["evidence"].every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(
          item,
          ["criterionId", "outcome", "explanation"],
          ["supportingTurnIds", "supportingTestIds"],
        ) &&
        typeof item["criterionId"] === "string" &&
        item["criterionId"].trim().length > 0 &&
        ["met", "partial", "missed", "not_applicable"].includes(
          String(item["outcome"]),
        ) &&
        typeof item["explanation"] === "string" &&
        item["explanation"].length <= 4_000 &&
        (item["supportingTurnIds"] === undefined ||
          (isUniqueStringArray(item["supportingTurnIds"]) &&
            item["supportingTurnIds"].every((turnId) =>
              knownTurnIds.has(turnId),
            ))) &&
        (item["supportingTestIds"] === undefined ||
          (isUniqueStringArray(item["supportingTestIds"]) &&
            item["supportingTestIds"].every((testId) =>
              knownTestIds.has(testId),
            ))),
    ) ||
    typeof value["summary"] !== "string" ||
    value["summary"].trim().length === 0 ||
    value["summary"].length > 8_000 ||
    value["evaluationVersion"] !== expectedEvaluationVersion
  ) {
    reject("Evaluation output failed the Phase 7 validation gate.");
  }

  const normalizedAssessment = structuredClone(
    communicationAssessment,
  ) as unknown as CommunicationAssessment;
  let expected: MedicalEvaluation;
  try {
    expected = evaluateDeterministically(input, normalizedAssessment);
  } catch {
    reject("Evaluation output failed the frozen scoring policy.");
  }
  if (
    expected.evaluationVersion !== expectedEvaluationVersion ||
    !isDeepStrictEqual(scores, expected.scores) ||
    diagnosis["correct"] !== expected.diagnosis.correct ||
    diagnosis["matchType"] !== expected.diagnosis.matchType ||
    !isDeepStrictEqual(value["evidence"], expected.evidence)
  ) {
    reject("Evaluation output failed the frozen scoring policy.");
  }

  return {
    evaluation: expected,
    communicationAssessment: normalizedAssessment,
  };
}
