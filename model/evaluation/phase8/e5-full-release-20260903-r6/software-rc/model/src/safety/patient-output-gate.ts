import type { SupportedCasePackage } from "../domain/case-package.js";
import {
  buildSafePatientCaseView,
  type SafePatientCaseView,
} from "../domain/safe-patient-case-view.js";
import { ModelServiceError } from "../domain/errors.js";
import type {
  PatientAgentOutput,
  PatientDiagnosisIntent,
  PatientInteractionKind,
} from "../providers/model-provider.js";

export interface PatientOutputGateContextV1 {
  casePackage: SupportedCasePackage;
  safeCaseView: SafePatientCaseView;
  userText?: string;
  previouslyDisclosedFactIds?: string[];
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
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length;
}

function normalizeLeakText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const ROLEPLAY_META_LANGUAGE_PATTERNS = [
  /(?:病例|病例资料|患者资料|档案|设定|系统)(?:里|中)?(?:没有|没|未)(?:特别)?(?:说明|写|提到|提供|设定)/u,
  /(?:没有|没)特别说明/u,
  /\b(?:the )?(?:case|profile|prompt|scenario|data) (?:does not|doesn't|did not|didn't) (?:specify|provide|mention|say)\b/iu,
] as const;

function containsRoleplayMetaLanguage(value: string): boolean {
  return ROLEPLAY_META_LANGUAGE_PATTERNS.some((pattern) => pattern.test(value));
}

function reject(message: string): never {
  throw new ModelServiceError("MODEL_OUTPUT_REJECTED", message);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJsonValue(left)) ===
    JSON.stringify(stableJsonValue(right));
}

function assertSafeViewMatchesCase(
  context: PatientOutputGateContextV1,
): void {
  const { casePackage, safeCaseView } = context;
  if (
    safeCaseView.publicCaseId !== casePackage.publicCaseId ||
    safeCaseView.caseVersion !== casePackage.caseVersion ||
    safeCaseView.locale !== casePackage.locale
  ) {
    reject("Patient output gate received a safe case view for another case.");
  }
  const expectedProfile = buildSafePatientCaseView(casePackage).patientProfile;
  if (!structurallyEqual(safeCaseView.patientProfile, expectedProfile)) {
    reject("Patient output gate received an invalid patient identity or persona view.");
  }
  const safeFactIds = new Set<string>();
  for (const fact of safeCaseView.facts) {
    const source = casePackage.patientFacts[fact.factId];
    if (
      safeFactIds.has(fact.factId) ||
      source === undefined ||
      (source.disclosure !== "spontaneous" &&
        source.disclosure !== "if_asked") ||
      source.status !== fact.status ||
      source.value !== fact.value ||
      source.disclosure !== fact.disclosure ||
      source.questionMatchers.length !== fact.questionMatchers.length ||
      source.questionMatchers.some(
        (matcher, index) => matcher !== fact.questionMatchers[index],
      )
    ) {
      reject("Patient output gate received an invalid safe fact view.");
    }
    safeFactIds.add(fact.factId);
  }
  if (
    Object.entries(casePackage.patientFacts).some(
      ([factId, fact]) =>
        (fact.disclosure === "spontaneous" ||
          fact.disclosure === "if_asked") &&
        !safeFactIds.has(factId),
    )
  ) {
    reject("Patient output gate received an incomplete safe fact view.");
  }
}

function interactionKind(value: unknown): value is PatientInteractionKind {
  return [
    "medical_chat",
    "social_chat",
    "test_query",
    "test_order",
  ].includes(String(value));
}

function optionalString(
  value: Record<string, unknown>,
  key: "requestedTestId" | "suggestedTestId",
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    reject(`Patient output ${key} must be a non-empty string when present.`);
  }
  return candidate;
}

const CONTINUE_DIALOGUE_INTENT: PatientDiagnosisIntent = {
  decision: "continue_dialogue",
  primaryDiagnosis: null,
  differentialDiagnoses: [],
  candidateDiagnoses: [],
};

function diagnosisIntent(
  value: Record<string, unknown>,
  userText: string | undefined,
): PatientDiagnosisIntent {
  const candidate = value["diagnosisIntent"];
  if (candidate === undefined) return CONTINUE_DIALOGUE_INTENT;
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, [
      "decision",
      "primaryDiagnosis",
      "differentialDiagnoses",
      "candidateDiagnoses",
    ]) ||
    !isUniqueStringArray(candidate["differentialDiagnoses"]) ||
    candidate["differentialDiagnoses"].length > 5 ||
    !isUniqueStringArray(candidate["candidateDiagnoses"]) ||
    candidate["candidateDiagnoses"].length > 6
  ) {
    reject("Patient output failed the diagnosis intent schema gate.");
  }

  const decision = candidate["decision"];
  const primaryDiagnosis = candidate["primaryDiagnosis"];
  const differentialDiagnoses = candidate["differentialDiagnoses"];
  const candidateDiagnoses = candidate["candidateDiagnoses"];
  if (decision === "continue_dialogue") {
    if (
      primaryDiagnosis !== null ||
      differentialDiagnoses.length !== 0 ||
      candidateDiagnoses.some(
        (item) => item.trim().length === 0 || item.length > 200,
      )
    ) {
      reject("Patient output returned diagnosis terms without submission intent.");
    }
    const normalizedUserText = normalizeLeakText(userText ?? "");
    const normalizedCandidates = candidateDiagnoses.map(normalizeLeakText);
    if (
      normalizedCandidates.some(
        (item) => item.length === 0 || !normalizedUserText.includes(item),
      ) ||
      new Set(normalizedCandidates).size !== normalizedCandidates.length
    ) {
      reject("Patient output diagnosis candidates were not grounded in player text.");
    }
    return {
      decision: "continue_dialogue",
      primaryDiagnosis: null,
      differentialDiagnoses: [],
      candidateDiagnoses: candidateDiagnoses.map((item) => item.trim()),
    };
  }
  if (
    decision !== "submit_diagnosis" ||
    typeof primaryDiagnosis !== "string" ||
    primaryDiagnosis.trim().length === 0 ||
    primaryDiagnosis.length > 200 ||
    candidateDiagnoses.length !== 0 ||
    differentialDiagnoses.some(
      (item) => item.trim().length === 0 || item.length > 200,
    )
  ) {
    reject("Patient output returned an invalid diagnosis submission intent.");
  }

  const normalizedUserText = normalizeLeakText(userText ?? "");
  const normalizedPrimary = normalizeLeakText(primaryDiagnosis);
  const normalizedDifferentials = differentialDiagnoses.map(normalizeLeakText);
  if (
    normalizedUserText.length === 0 ||
    normalizedPrimary.length === 0 ||
    !normalizedUserText.includes(normalizedPrimary) ||
    normalizedDifferentials.some(
      (item) => item.length === 0 || !normalizedUserText.includes(item),
    ) ||
    new Set([normalizedPrimary, ...normalizedDifferentials]).size !==
      1 + normalizedDifferentials.length
  ) {
    reject("Patient output diagnosis intent was not grounded in the player text.");
  }
  return {
    decision: "submit_diagnosis",
    primaryDiagnosis: primaryDiagnosis.trim(),
    differentialDiagnoses: differentialDiagnoses.map((item) => item.trim()),
    candidateDiagnoses: [],
  };
}

export function validatePatientOutputV1(
  value: unknown,
  context: PatientOutputGateContextV1,
): PatientAgentOutput {
  assertSafeViewMatchesCase(context);
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "reply",
        "interactionKind",
        "factIdsUsed",
        "personaFactIdsUsed",
        "completedTestIdsUsed",
        "newFactsClaimed",
        "diagnosisLeak",
      ],
      ["requestedTestId", "suggestedTestId", "diagnosisIntent"],
    ) ||
    typeof value["reply"] !== "string" ||
    value["reply"].trim().length === 0 ||
    value["reply"].length > 4_000 ||
    !interactionKind(value["interactionKind"]) ||
    !isUniqueStringArray(value["factIdsUsed"]) ||
    !isUniqueStringArray(value["personaFactIdsUsed"]) ||
    !isUniqueStringArray(value["completedTestIdsUsed"]) ||
    !isUniqueStringArray(value["newFactsClaimed"]) ||
    typeof value["diagnosisLeak"] !== "boolean"
  ) {
    reject("Patient output failed the Patient Agent schema gate.");
  }

  const reply = value["reply"];
  const kind = value["interactionKind"];
  const factIdsUsed = value["factIdsUsed"];
  const personaFactIdsUsed = value["personaFactIdsUsed"];
  const completedTestIdsUsed = value["completedTestIdsUsed"];
  const requestedTestId = optionalString(value, "requestedTestId");
  const suggestedTestId = optionalString(value, "suggestedTestId");
  const validatedDiagnosisIntent = diagnosisIntent(value, context.userText);
  const allowedFactIds = new Set(
    context.safeCaseView.facts.map(({ factId }) => factId),
  );
  const allowedPersonaFactIds = new Set(
    context.safeCaseView.patientProfile.personaFacts.map(
      ({ personaFactId }) => personaFactId,
    ),
  );
  const testStatusById = new Map(
    context.safeCaseView.tests.map(({ testId, status }) => [testId, status]),
  );
  if (
    value["diagnosisLeak"] ||
    value["newFactsClaimed"].length > 0 ||
    factIdsUsed.some((factId) => !allowedFactIds.has(factId)) ||
    personaFactIdsUsed.some(
      (personaFactId) => !allowedPersonaFactIds.has(personaFactId),
    ) ||
    completedTestIdsUsed.some(
      (testId) => testStatusById.get(testId) !== "completed",
    )
  ) {
    reject("Patient output failed the safe case view reference gate.");
  }
  if (
    (requestedTestId !== undefined &&
      testStatusById.get(requestedTestId) === undefined) ||
    (suggestedTestId !== undefined &&
      testStatusById.get(suggestedTestId) === undefined) ||
    (requestedTestId !== undefined && suggestedTestId !== undefined) ||
    (kind === "test_order" && requestedTestId === undefined) ||
    (kind !== "test_order" && requestedTestId !== undefined) ||
    (suggestedTestId !== undefined && kind !== "test_query") ||
    (suggestedTestId !== undefined &&
      testStatusById.get(suggestedTestId) !== "not_completed") ||
    ((kind === "medical_chat" || kind === "social_chat") &&
      (requestedTestId !== undefined || suggestedTestId !== undefined))
  ) {
    reject("Patient output failed the test action gate.");
  }
  if (
    kind === "medical_chat" &&
    validatedDiagnosisIntent.decision !== "submit_diagnosis" &&
    validatedDiagnosisIntent.candidateDiagnoses.length === 0 &&
    factIdsUsed.length === 0 &&
    completedTestIdsUsed.length === 0
  ) {
    reject("Patient output failed the reply grounding gate.");
  }

  const normalizedReply = normalizeLeakText(reply);
  if (containsRoleplayMetaLanguage(reply)) {
    reject("Patient output broke character with case-data meta language.");
  }
  const diagnosisTerms = context.casePackage.answerKey.diagnosisConcepts
    .flatMap(({ preferredTerm, acceptedSynonyms }) => [
      preferredTerm,
      ...acceptedSynonyms,
    ])
    .map(normalizeLeakText)
    .filter((term) => term.length > 0);
  if (diagnosisTerms.some((term) => normalizedReply.includes(term))) {
    reject("Patient output failed the diagnosis leak gate.");
  }

  const completedIds = new Set(completedTestIdsUsed);
  const unavailableReports = Object.entries(context.casePackage.medicalTests)
    .filter(([testId]) => !completedIds.has(testId))
    .flatMap(([, definition]) =>
      definition.report === undefined ? [] : [definition.report],
    )
    .map(normalizeLeakText)
    .filter((report) => report.length >= 8);
  if (unavailableReports.some((report) => normalizedReply.includes(report))) {
    reject("Patient output failed the uncompleted test-result leak gate.");
  }

  return {
    reply,
    interactionKind: kind,
    factIdsUsed: [...factIdsUsed],
    personaFactIdsUsed: [...personaFactIdsUsed],
    completedTestIdsUsed: [...completedTestIdsUsed],
    ...(requestedTestId === undefined ? {} : { requestedTestId }),
    ...(suggestedTestId === undefined ? {} : { suggestedTestId }),
    diagnosisIntent: validatedDiagnosisIntent,
    newFactsClaimed: [],
    diagnosisLeak: false,
  };
}
