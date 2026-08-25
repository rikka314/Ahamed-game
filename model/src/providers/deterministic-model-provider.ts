import type {
  ControllerDecision,
  EvaluationInput,
  MedicalEvaluation,
  ModelProvider,
  PatientReply,
} from "./model-provider.js";
import { evaluateDeterministically } from "../evaluation/deterministic-evaluator.js";
import {
  isExplicitRealHealthInput,
  isPromptInjection,
} from "../safety/prompt-injection-policy.js";

export class DeterministicModelProvider implements ModelProvider {
  async classifyTurn(input: {
    text: string;
    locale: string;
    factIndex: Array<{ factId: string; questionMatchers: string[] }>;
  }): Promise<ControllerDecision> {
    if (isExplicitRealHealthInput(input.text)) {
      return {
        action: "unsafe",
        requestedFactIds: [],
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

  async generatePatientReply(input: {
    locale: string;
    languageStyle: string;
    allowedFacts: Array<{
      factId: string;
      status: "present" | "absent" | "unknown";
      value: string;
    }>;
  }): Promise<PatientReply> {
    if (input.allowedFacts.length === 0) {
      return {
        reply: "I am not sure how to answer that.",
        factsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    }

    return {
      reply: input.allowedFacts.map(({ value }) => value).join(" "),
      factsUsed: input.allowedFacts.map(({ factId }) => factId),
      newFactsClaimed: [],
      diagnosisLeak: false,
    };
  }

  async evaluate(input: EvaluationInput): Promise<MedicalEvaluation> {
    return evaluateDeterministically(input);
  }
}
