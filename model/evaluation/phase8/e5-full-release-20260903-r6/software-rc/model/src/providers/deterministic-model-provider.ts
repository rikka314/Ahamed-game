import { createHash } from "node:crypto";

import type {
  ControllerDecision,
  EvaluationInput,
  ModelProvider,
  ModelProviderIdentity,
  PatientInput,
  PatientReply,
  ProviderMedicalEvaluation,
} from "./model-provider.js";
import {
  ModelProviderIdentityError,
  ModelProviderOutputError,
} from "./model-provider.js";
import { evaluateDeterministically } from "../evaluation/deterministic-evaluator.js";
import type { CommunicationReviewProvider } from "./communication-review-provider.js";
import { evaluateMedicalSafetyV1 } from "../safety/medical-safety-policy-v1.js";
import { isPromptInjection } from "../safety/prompt-injection-policy.js";

export const DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY = Object.freeze({
  providerName: "deterministic",
  modelId: "deterministic-v1",
  promptVersion: "v0.1.0",
} as const);

function identitiesEqual(
  left: ModelProviderIdentity,
  right: ModelProviderIdentity,
): boolean {
  return (
    left.providerName === right.providerName &&
    left.modelId === right.modelId &&
    left.promptVersion === right.promptVersion
  );
}

export class DeterministicModelProvider implements ModelProvider {
  get identity(): ModelProviderIdentity {
    if (this.communicationReviewer === undefined) {
      return DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY;
    }
    const reviewer = this.communicationReviewer.identity;
    if (
      typeof reviewer?.providerName !== "string" ||
      reviewer.providerName.trim().length === 0 ||
      typeof reviewer.modelId !== "string" ||
      reviewer.modelId.trim().length === 0 ||
      typeof reviewer.promptVersion !== "string" ||
      reviewer.promptVersion.trim().length === 0
    ) {
      throw new ModelProviderIdentityError(
        "The communication reviewer must declare a complete identity.",
      );
    }
    const reviewerFingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          reviewer.providerName,
          reviewer.modelId,
          reviewer.promptVersion,
        ]),
      )
      .digest("hex")
      .slice(0, 16);
    return {
      ...DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY,
      promptVersion:
        `${DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.promptVersion}` +
        `+reviewer.${reviewerFingerprint}`,
    };
  }

  constructor(
    private readonly communicationReviewer?: CommunicationReviewProvider,
  ) {}

  async classifyTurn(input: {
    text: string;
    locale: string;
    factIndex: Array<{ factId: string; questionMatchers: string[] }>;
  }): Promise<ControllerDecision> {
    const medicalSafety = evaluateMedicalSafetyV1({
      text: input.text,
      context: "fictional_case_session",
    });
    if (medicalSafety.decision !== "ALLOW_GAME") {
      return {
        action: "unsafe",
        requestedFactIds: [],
        // The provider contract predates the richer Phase 7 exit taxonomy.
        // ModelService owns the authoritative local decision and fixed template;
        // this legacy code is only a defense-in-depth provider stop signal.
        safetyCode: "SAFETY_REAL_HEALTH_INPUT",
      };
    }

    if (isPromptInjection(input.text)) {
      return {
        action: "unsafe",
        requestedFactIds: [],
        safetyCode: "SAFETY_PROMPT_INJECTION",
      };
    }

    const normalizedText = input.text.normalize("NFKC").toLocaleLowerCase();
    const requestedFactIds = input.factIndex
      .filter(({ questionMatchers }) =>
        questionMatchers.some((matcher) =>
          normalizedText.includes(
            matcher.normalize("NFKC").toLocaleLowerCase(),
          ),
        ),
      )
      .map(({ factId }) => factId);

    if (requestedFactIds.length === 0) {
      return { action: "other", requestedFactIds: [] };
    }

    return { action: "ask_patient", requestedFactIds };
  }

  async generatePatientReply(input: PatientInput): Promise<PatientReply> {
    const normalized = input.userText
      .normalize("NFKC")
      .toLocaleLowerCase();
    const pendingTest = input.pendingTestSuggestionId === undefined
      ? undefined
      : input.safeCaseView.tests.find(
          ({ testId }) => testId === input.pendingTestSuggestionId,
        );
    const confirmationText = normalized.replace(/[ ,.?!，。！？、]+/gu, "");
    const confirmsPendingTest = new Set([
      "好",
      "好的",
      "可以",
      "行",
      "去做吧",
      "做吧",
      "现在做",
      "好那去做吧",
      "好的那去做吧",
      "okay",
      "okaydoit",
      "ok",
      "okdoit",
      "yes",
      "yesdoit",
      "doit",
      "goahead",
    ]).has(confirmationText);
    if (pendingTest !== undefined && confirmsPendingTest) {
      return {
        reply: input.safeCaseView.locale.startsWith("zh")
          ? `好的，我现在去做${pendingTest.displayName}。`
          : `Okay, I will have the ${pendingTest.displayName} now.`,
        interactionKind: "test_order",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        requestedTestId: pendingTest.testId,
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }
    const mentionedTest = input.safeCaseView.tests.find((test) =>
      [test.displayName, ...test.aliases].some((alias) =>
        normalized.includes(alias.normalize("NFKC").toLocaleLowerCase()),
      ),
    );
    const explicitOrder =
      /(?:量一下|测一下|检查一下|做一下|做个|安排|去做|现在做|order|perform|measure)/iu.test(
        input.userText,
      );
    const resultQuery =
      /(?:结果|怎么样|如何|出来了吗|做过吗|有没有做|result|show|done)/iu.test(
        input.userText,
      );
    if (mentionedTest !== undefined && explicitOrder) {
      return {
        reply: input.safeCaseView.locale.startsWith("zh")
          ? `好的，我配合做${mentionedTest.displayName}。`
          : `Okay, I will have the ${mentionedTest.displayName}.`,
        interactionKind: "test_order",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        requestedTestId: mentionedTest.testId,
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }
    if (mentionedTest !== undefined && resultQuery) {
      if (mentionedTest.status === "completed") {
        return {
          reply: mentionedTest.report!,
          interactionKind: "test_query",
          factIdsUsed: [],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [mentionedTest.testId],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      }
      return {
        reply: input.safeCaseView.locale.startsWith("zh")
          ? `这项${mentionedTest.displayName}还没有做。需要现在去做吗？`
          : `That ${mentionedTest.displayName} has not been done. Should I do it now?`,
        interactionKind: "test_query",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        suggestedTestId: mentionedTest.testId,
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }

    const contextFollowUp =
      /(?:现在|目前|这会儿).*(?:还|仍然).*(?:这样|这些|这个|有)/iu.test(
        input.userText,
      );
    if (contextFollowUp) {
      const latestDisclosedFact = [...input.disclosedFactIds]
        .reverse()
        .map((factId) =>
          input.safeCaseView.facts.find((fact) => fact.factId === factId),
        )
        .find((fact) => fact !== undefined);
      if (latestDisclosedFact !== undefined) {
        return {
          reply: latestDisclosedFact.value,
          interactionKind: "medical_chat",
          factIdsUsed: [latestDisclosedFact.factId],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      }
    }

    const matchedFacts = input.safeCaseView.facts.filter((fact) =>
      fact.questionMatchers.some((matcher) =>
        normalized.includes(matcher.normalize("NFKC").toLocaleLowerCase()),
      ),
    );
    const matcherFacts = matchedFacts.length > 0
      ? matchedFacts
      : input.safeCaseView.facts.filter((fact) => {
          const tokens = fact.value
            .normalize("NFKC")
            .toLocaleLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter((token) => token.length >= 2);
          return tokens.some((token) => normalized.includes(token));
        });
    if (matcherFacts.length > 0) {
      return {
        reply: matcherFacts.map(({ value }) => value).join(" "),
        interactionKind: "medical_chat",
        factIdsUsed: matcherFacts.map(({ factId }) => factId),
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }

    if (/(?:什么|哪些|主要).*(?:症状|不舒服)/iu.test(input.userText)) {
      const chiefComplaint = input.safeCaseView.facts.find(
        ({ disclosure }) => disclosure === "spontaneous",
      );
      if (chiefComplaint !== undefined) {
        return {
          reply: chiefComplaint.value,
          interactionKind: "medical_chat",
          factIdsUsed: [chiefComplaint.factId],
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      }
    }

    const interestQuestion = /(?:喜欢|爱好|兴趣|hobby|interest)/iu.test(
      input.userText,
    );
    const interestFact = input.patientProfile.personaFacts.find(
      ({ personaFactId }) => personaFactId.startsWith("persona.interest."),
    );
    const dailyLifeQuestion = /(?:最近忙不忙|忙吗|busy)/iu.test(input.userText);
    const dailyLifeFact = input.patientProfile.personaFacts.find(
      ({ personaFactId }) => personaFactId === "persona.daily_life",
    );
    const reachedOffTopicThreshold =
      input.consecutiveOffTopicTurns + 1 >=
        input.patientProfile.offTopicReminderThreshold;
    if (!interestQuestion && reachedOffTopicThreshold) {
      const reminderByTemplate = {
        gentle_cooperative: "不好意思，医生，刚才没及时回应您。你好。",
        anxious_reassurance_seeking:
          "医生，我有点担心，我们能继续看看我哪里不舒服吗？",
        impatient_direct: "医生，还是继续问我的病情吧。",
        talkative_digressive:
          "我刚才好像说远了，还是回到这次不舒服的事吧。",
        accommodating_minimizing:
          "好的医生，我们还是接着聊这次不舒服的情况吧。",
        guarded_questioning:
          "医生，我们还是说回病情吧，不过您能说明一下接下来为什么这样问吗？",
      } as const;
      return {
        reply: input.safeCaseView.locale.startsWith("zh")
          ? reminderByTemplate[input.patientProfile.templateId]
          : "Doctor, could we return to my symptoms?",
        interactionKind: "social_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }
    return {
      reply: dailyLifeQuestion && dailyLifeFact !== undefined
        ? dailyLifeFact.value
        : interestQuestion && interestFact !== undefined
        ? input.safeCaseView.locale.startsWith("zh")
          ? `我平时喜欢${interestFact.value}。`
          : `I enjoy ${interestFact.value}.`
        : input.safeCaseView.locale.startsWith("zh")
          ? "你好，医生。"
          : "Hello, doctor.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed:
        dailyLifeQuestion && dailyLifeFact !== undefined
          ? [dailyLifeFact.personaFactId]
          : interestQuestion && interestFact !== undefined
          ? [interestFact.personaFactId]
          : [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    };
  }

  async evaluate(input: EvaluationInput): Promise<ProviderMedicalEvaluation> {
    const identityBeforeReview = this.identity;
    const communication = this.communicationReviewer === undefined
      ? {
          status: "unavailable" as const,
          failureCode: "COMMUNICATION_REVIEW_NOT_CONFIGURED",
        }
      : await this.communicationReviewer.review({
          turnIds: input.turnIds,
          rubricCriterionIds:
            input.casePackage.rubric.communicationCriterionIds,
        });
    if (!identitiesEqual(identityBeforeReview, this.identity)) {
      throw new ModelProviderIdentityError(
        "The communication reviewer identity changed during evaluation.",
      );
    }
    try {
      return {
        ...evaluateDeterministically(input, communication),
        communicationAssessment: structuredClone(communication),
      };
    } catch {
      throw new ModelProviderOutputError(
        "Communication reviewer output failed validation.",
      );
    }
  }
}
