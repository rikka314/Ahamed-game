import type { CasePackage } from "../domain/case-package.js";
import type { SafePatientCaseView } from "../domain/safe-patient-case-view.js";
import { ModelServiceError } from "../domain/errors.js";
import type {
  PatientAgentOutput,
  PatientInteractionKind,
} from "../providers/model-provider.js";

export interface PatientOutputGateContextV1 {
  casePackage: CasePackage;
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

function replyContainsSourceText(reply: string, sourceText: string): boolean {
  const normalizedSource = normalizeLeakText(sourceText);
  return normalizedSource.length > 0 &&
    normalizeLeakText(reply).includes(normalizedSource);
}

function lexicalTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/['’]/gu, "")
    .match(
      /\p{Script=Han}|[\p{Script=Latin}\p{N}]+|[\p{L}\p{N}]+/gu,
    ) ?? [];
}

function tokenizePhrases(phrases: readonly string[]): string[][] {
  return phrases.map(lexicalTokens);
}

const ALWAYS_ALLOWED_REPLY_RESIDUES = tokenizePhrases([
  "hello doctor",
  "hello again doctor",
  "hi doctor",
  "hello",
  "hi",
  "okay",
  "ok",
  "yes",
  "no",
  "please",
  "thanks",
  "thank you",
  "sorry",
  "okay we will not do it",
  "doctor could we return to my symptoms",
  "i am listening doctor please continue",
  "i do not know",
  "i dont know",
  "im not sure",
  "i am not sure about that",
  "你好医生",
  "您好医生",
  "你好",
  "您好",
  "好的",
  "好",
  "谢谢",
  "不好意思",
  "不好意思医生刚才没及时回应您你好",
  "医生我有点担心我们能继续看看我哪里不舒服吗",
  "医生还是继续问我的病情吧",
  "我不知道",
  "不知道",
  "我不清楚",
  "不清楚",
  "我没注意",
  "没注意",
  "我不确定",
  "不确定",
]);

const SOURCE_CONNECTOR_RESIDUES = tokenizePhrases([
  "and",
  "but",
  "also",
  "和",
  "但",
  "还有",
]);

const PERSONA_REFERENCE_RESIDUES = tokenizePhrases([
  "i enjoy",
  "我平时喜欢",
]);

const REQUESTED_TEST_RESIDUES = tokenizePhrases([
  "okay i will have the now",
  "okay i will have the",
  "okay i will do it now",
  "好的我现在去做",
  "好的我配合做",
]);

const SUGGESTED_TEST_RESIDUES = tokenizePhrases([
  "that has not been done should i do it now",
  "should i do it now",
  "这项还没有做需要现在去做吗",
  "需要现在去做吗",
]);

interface ReplyGroundingPhraseContext {
  hasPersonaReference: boolean;
  hasRequestedTest: boolean;
  hasSuggestedTest: boolean;
}

function removeTokenSequence(tokens: string[], sequence: string[]): string[] {
  if (sequence.length === 0 || sequence.length > tokens.length) return tokens;
  const remaining = [...tokens];
  for (let index = 0; index <= remaining.length - sequence.length;) {
    const matches = sequence.every(
      (token, offset) => remaining[index + offset] === token,
    );
    if (matches) remaining.splice(index, sequence.length);
    else index += 1;
  }
  return remaining;
}

function replyHasOnlyGroundedContent(
  reply: string,
  sourceTexts: string[],
  phraseContext: ReplyGroundingPhraseContext,
): boolean {
  let remaining = lexicalTokens(reply);
  const sourceSequences = sourceTexts
    .map(lexicalTokens)
    .filter((tokens) => tokens.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const sequence of sourceSequences) {
    remaining = removeTokenSequence(remaining, sequence);
  }
  if (remaining.length === 0) return true;

  const allowedResidues = [
    ...ALWAYS_ALLOWED_REPLY_RESIDUES,
    ...(sourceSequences.length === 0 ? [] : SOURCE_CONNECTOR_RESIDUES),
    ...(phraseContext.hasPersonaReference
      ? PERSONA_REFERENCE_RESIDUES
      : []),
    ...(phraseContext.hasRequestedTest ? REQUESTED_TEST_RESIDUES : []),
    ...(phraseContext.hasSuggestedTest ? SUGGESTED_TEST_RESIDUES : []),
  ];
  return allowedResidues.some(
    (phrase) =>
      phrase.length === remaining.length &&
      phrase.every((token, index) => remaining[index] === token),
  );
}

function reject(message: string): never {
  throw new ModelServiceError("MODEL_OUTPUT_REJECTED", message);
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
      ["requestedTestId", "suggestedTestId"],
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
  const factById = new Map(
    context.safeCaseView.facts.map((fact) => [fact.factId, fact]),
  );
  const personaFactById = new Map(
    context.safeCaseView.patientProfile.personaFacts.map((fact) => [
      fact.personaFactId,
      fact,
    ]),
  );
  const testById = new Map(
    context.safeCaseView.tests.map((test) => [test.testId, test]),
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

  const normalizedReply = normalizeLeakText(reply);
  const normalizedUserText = context.userText === undefined
    ? ""
    : normalizeLeakText(context.userText);
  const priorFactIds = new Set(context.previouslyDisclosedFactIds ?? []);
  const isExplicitContextFollowup =
    /(?:现在|目前).*(?:还|仍然).*(?:这样|症状)/u.test(context.userText ?? "");
  if (
    isExplicitContextFollowup &&
    priorFactIds.size > 0 &&
    !factIdsUsed.some((factId) => priorFactIds.has(factId))
  ) {
    reject("Patient output failed the context follow-up continuity gate.");
  }
  const asksInterest = /(?:喜欢|爱好|平时做什么|enjoy|hobb)/u.test(
    normalizedUserText,
  );
  const asksDailyLife = /(?:最近忙不忙|忙吗|busy)/u.test(normalizedUserText);
  const usedRelevantPersonaFact = personaFactIdsUsed.some((personaFactId) =>
    asksInterest
      ? personaFactId.startsWith("persona.interest.")
      : asksDailyLife
        ? personaFactId === "persona.daily_life"
        : false
  );
  const isOffTopicReminder = [
    "医生还是继续问我的病情吧",
    "不好意思医生刚才没及时回应您你好",
    "医生我有点担心我们能继续看看我哪里不舒服吗",
    "doctorcouldwereturntomysymptoms",
  ].includes(normalizedReply);
  if (
    kind === "social_chat" &&
    (asksInterest || asksDailyLife) &&
    !usedRelevantPersonaFact &&
    !isOffTopicReminder
  ) {
    reject("Patient output failed the direct persona question gate.");
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

  const factReferencesGrounded = factIdsUsed.every((factId) => {
    const fact = factById.get(factId);
    return fact !== undefined && replyContainsSourceText(reply, fact.value);
  });
  const personaReferencesGrounded = personaFactIdsUsed.every(
    (personaFactId) => {
      const fact = personaFactById.get(personaFactId);
      return fact !== undefined && replyContainsSourceText(reply, fact.value);
    },
  );
  const testReferencesGrounded = completedTestIdsUsed.every((testId) => {
    const test = testById.get(testId);
    return test !== undefined &&
      [test.report ?? test.displayName].some(
        (sourceText) =>
          sourceText !== undefined && replyContainsSourceText(reply, sourceText),
      );
  });
  const referencedSourceTexts = [
    ...factIdsUsed.flatMap((factId) => {
      const fact = factById.get(factId);
      return fact === undefined ? [] : [fact.value];
    }),
    ...personaFactIdsUsed.flatMap((personaFactId) => {
      const fact = personaFactById.get(personaFactId);
      return fact === undefined ? [] : [fact.value];
    }),
    ...completedTestIdsUsed.flatMap((testId) => {
      const test = testById.get(testId);
      return test === undefined ? [] : [test.report ?? test.displayName];
    }),
    ...[requestedTestId, suggestedTestId].flatMap((testId) => {
      if (testId === undefined) return [];
      const test = testById.get(testId);
      return test === undefined
        ? []
        : [test.displayName, ...test.aliases];
    }),
  ];
  if (
    !factReferencesGrounded ||
    !personaReferencesGrounded ||
    !testReferencesGrounded ||
    !replyHasOnlyGroundedContent(reply, referencedSourceTexts, {
      hasPersonaReference: personaFactIdsUsed.length > 0,
      hasRequestedTest: requestedTestId !== undefined,
      hasSuggestedTest: suggestedTestId !== undefined,
    })
  ) {
    reject("Patient output failed the reply grounding gate.");
  }

  return {
    reply,
    interactionKind: kind,
    factIdsUsed: [...factIdsUsed],
    personaFactIdsUsed: [...personaFactIdsUsed],
    completedTestIdsUsed: [...completedTestIdsUsed],
    ...(requestedTestId === undefined ? {} : { requestedTestId }),
    ...(suggestedTestId === undefined ? {} : { suggestedTestId }),
    newFactsClaimed: [],
    diagnosisLeak: false,
  };
}
