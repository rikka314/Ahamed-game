import { createHash } from "node:crypto";

import { createHeadlessModelService } from "../application/create-headless-model-service.js";
import type { CasePackage } from "../domain/case-package.js";
import { MemoryEventSink } from "../observability/event-sink.js";
import type {
  ModelProvider,
  ProviderReproducibilityManifest,
  ProviderRole,
} from "../providers/model-provider.js";

export interface ProviderLiveEvalCallSummary {
  role: ProviderRole;
  actualModelId: string;
  status: "completed" | "failed";
  retryCount: number;
  durationMs: number;
  providerRequestId?: string;
  responseStatus?: string;
  finishReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    reasoningOutputTokens?: number;
  };
}

export interface ProviderLiveEvalReport {
  schemaVersion: string;
  referenceStatus: "engineering_reference_only" | "published_case";
  benchmarkFingerprint: string;
  caseContentSha256: string;
  caseId: string;
  caseVersion: string;
  providerName: string;
  modelId: string;
  actualModelId: string;
  promptVersion: string;
  providerManifest: ProviderReproducibilityManifest;
  evaluationVersion: string;
  sessionPhase: "completed";
  scores: {
    diagnosis: number;
    historyCoverage: number;
    differentialReasoning: number;
    testSelection: number;
    efficiency: number;
    communication: number;
    total: number;
  };
  callCount: number;
  controllerFactRouting: {
    evaluatedTurns: number;
    matchedTurns: number;
    accuracy: number;
  };
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  calls: ProviderLiveEvalCallSummary[];
}

const NATURAL_LIVE_EVAL_QUESTIONS: Record<string, string> = {
  onset: "这些不舒服是什么时候开始的？",
  nasal_discharge: "有流鼻涕吗？鼻涕是什么样的？",
  sore_throat: "嗓子疼吗？吞咽有没有受影响？",
  cough: "有咳嗽吗？咳嗽是什么情况？",
  fever: "有发热吗？最高体温是多少？",
  myalgia: "有没有肌肉或全身酸痛？",
  headache: "有没有头痛？程度怎么样？",
  sputum: "有咳痰吗？痰量和颜色怎么样？",
};

function liveEvalQuestion(
  factId: string,
  questionMatchers: readonly string[],
): string {
  const suffix = factId.split(".").at(-1) ?? "";
  const question = NATURAL_LIVE_EVAL_QUESTIONS[suffix] ??
    `关于“${questionMatchers[0] ?? "这一项"}”，请说说具体情况。`;
  return `在当前虚构病例中，${question}`;
}

export interface OpenAILiveEvalReport extends ProviderLiveEvalReport {
  schemaVersion: "openai-c01-live-eval-v1";
}

export type OpenAILiveEvalCallSummary = ProviderLiveEvalCallSummary;

export interface ProviderLiveEvalPatientSample {
  caseId: string;
  caseVersion: string;
  question: string;
  reply: string;
  disclosedFactIds: string[];
  authorizedFacts: Array<{
    factId: string;
    status: "present" | "absent" | "unknown";
    value: string;
  }>;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerManifest(provider: ModelProvider): ProviderReproducibilityManifest {
  const manifest = provider.reproducibilityManifest?.();
  if (manifest === undefined) {
    throw new TypeError("The live eval requires a reproducibility manifest.");
  }
  return manifest;
}

function stableFingerprint(
  casePackage: CasePackage,
  provider: ModelProvider,
  manifest: ProviderReproducibilityManifest,
  schemaVersion: string,
  actualModelId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      schemaVersion,
      caseContentSha256: sha256(casePackage),
      providerName: provider.identity.providerName,
      modelId: provider.identity.modelId,
      actualModelId,
      promptVersion: provider.identity.promptVersion,
      manifest,
    }))
    .digest("hex");
}

function differentialTerms(casePackage: CasePackage): string[] {
  return casePackage.rubric.acceptableDifferentialConceptIds
    .slice(0, casePackage.rubric.requiredDifferentialCount)
    .map((conceptId) => {
      const concept = casePackage.answerKey.diagnosisConcepts.find(
        (candidate) => candidate.conceptId === conceptId,
      );
      if (concept === undefined) {
        throw new Error(`Missing reviewed differential concept ${conceptId}.`);
      }
      return concept.preferredTerm;
    });
}

function callSummaries(events: MemoryEventSink): ProviderLiveEvalCallSummary[] {
  return events.events
    .filter(({ eventType }) => eventType.startsWith("provider.call."))
    .map(({ payload }): ProviderLiveEvalCallSummary => {
      const usage = payload["usage"];
      return {
        role: payload["role"] as ProviderRole,
        actualModelId: String(payload["modelId"]),
        status: payload["status"] === "failed" ? "failed" :
          String(payload["failureCode"] ?? "") === "" || payload["failureCode"] === null
            ? "completed"
            : "failed",
        retryCount: Number(payload["retryCount"]),
        durationMs: Number(payload["durationMs"]),
        ...(typeof payload["providerRequestId"] === "string"
          ? { providerRequestId: payload["providerRequestId"] }
          : {}),
        ...(typeof payload["responseStatus"] === "string"
          ? { responseStatus: payload["responseStatus"] }
          : {}),
        ...(typeof payload["finishReason"] === "string"
          ? { finishReason: payload["finishReason"] }
          : {}),
        ...(usage !== null && typeof usage === "object"
          ? {
              usage: structuredClone(usage) as NonNullable<
                ProviderLiveEvalCallSummary["usage"]
              >,
            }
          : {}),
      };
    });
}

function requirePinnedActualModelId(calls: readonly ProviderLiveEvalCallSummary[]): string {
  const actualModelIds = new Set(
    calls
      .filter(({ status }) => status === "completed")
      .map(({ actualModelId }) => actualModelId),
  );
  if (actualModelIds.size !== 1) {
    throw new Error(
      `Live eval requires one stable actual model ID; observed ${actualModelIds.size}.`,
    );
  }
  return [...actualModelIds][0]!;
}

export async function runProviderC01LiveEval(options: {
  casePackage: CasePackage;
  provider: ModelProvider;
  schemaVersion: string;
  questionCount?: number;
  onPatientSample?: (
    sample: ProviderLiveEvalPatientSample,
  ) => void | Promise<void>;
  validateProvider(provider: ModelProvider): void;
}): Promise<ProviderLiveEvalReport> {
  options.validateProvider(options.provider);
  const questionCount = options.questionCount ?? 3;
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 8) {
    throw new TypeError("The live eval questionCount must be an integer from 1 to 8.");
  }
  const events = new MemoryEventSink();
  const service = createHeadlessModelService({
    cases: [options.casePackage],
    provider: options.provider,
    eventSink: events,
  });
  try {
    const created = await service.createSession({
      clientRequestId: "live_eval_create_v1",
      publicCaseId: options.casePackage.publicCaseId,
      patientNpcId: `npc.${options.casePackage.publicCaseId}`,
    });
    const askFactIds = options.casePackage.rubric.mustAskFactIds.slice(
      0,
      questionCount,
    );
    if (askFactIds.length !== questionCount) {
      throw new Error(
        `Live eval requires ${questionCount} reviewed must-ask facts.`,
      );
    }
    let matchedControllerRoutes = 0;
    for (const [index, factId] of askFactIds.entries()) {
      const fact = options.casePackage.patientFacts[factId];
      if (fact === undefined || fact.questionMatchers[0] === undefined) {
        throw new Error(`C01 fact ${factId} has no live-eval question matcher.`);
      }
      const question = liveEvalQuestion(factId, fact.questionMatchers);
      const turn = await service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId: `live_eval_turn_${index + 1}`,
        text: question,
      });
      if (turn.disclosedFactIds.includes(factId)) {
        matchedControllerRoutes += 1;
      }
      if (options.onPatientSample !== undefined) {
        await options.onPatientSample({
          caseId: options.casePackage.publicCaseId,
          caseVersion: options.casePackage.caseVersion,
          question,
          reply: turn.reply,
          disclosedFactIds: [...turn.disclosedFactIds],
          authorizedFacts: turn.disclosedFactIds.map((disclosedFactId) => {
            const disclosedFact = options.casePackage.patientFacts[disclosedFactId];
            if (disclosedFact === undefined) {
              throw new Error(
                `Live eval disclosed an unknown fact ${disclosedFactId}.`,
              );
            }
            return {
              factId: disclosedFactId,
              status: disclosedFact.status,
              value: disclosedFact.value,
            };
          }),
        });
      }
    }
    const requiredTestId = Object.entries(
      options.casePackage.rubric.testClassifications,
    ).find(([, classification]) => classification === "required")?.[0];
    if (requiredTestId !== undefined) {
      await service.orderTest({
        sessionId: created.session.sessionId,
        clientRequestId: "live_eval_test_1",
        testId: requiredTestId,
      });
    }
    const result = await service.submitDiagnosis({
      sessionId: created.session.sessionId,
      clientRequestId: "live_eval_diagnosis_v1",
      primaryDiagnosis: options.casePackage.answerKey.targetDiagnosis,
      differentials: differentialTerms(options.casePackage),
    });
    const calls = callSummaries(events);
    const actualModelId = requirePinnedActualModelId(calls);
    const manifest = providerManifest(options.provider);
    const totalUsage = calls.reduce(
      (aggregate, call) => ({
        inputTokens: aggregate.inputTokens + (call.usage?.inputTokens ?? 0),
        outputTokens: aggregate.outputTokens + (call.usage?.outputTokens ?? 0),
        totalTokens: aggregate.totalTokens + (call.usage?.totalTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
    return {
      schemaVersion: options.schemaVersion,
      referenceStatus: options.casePackage.packageStatus === "published"
        ? "published_case"
        : "engineering_reference_only",
      benchmarkFingerprint: stableFingerprint(
        options.casePackage,
        options.provider,
        manifest,
        options.schemaVersion,
        actualModelId,
      ),
      caseContentSha256: sha256(options.casePackage),
      caseId: options.casePackage.publicCaseId,
      caseVersion: options.casePackage.caseVersion,
      providerName: options.provider.identity.providerName,
      modelId: options.provider.identity.modelId,
      actualModelId,
      promptVersion: options.provider.identity.promptVersion,
      providerManifest: manifest,
      evaluationVersion: result.evaluationVersion,
      sessionPhase: result.sessionPhase,
      scores: result.scores,
      callCount: calls.length,
      controllerFactRouting: {
        evaluatedTurns: askFactIds.length,
        matchedTurns: matchedControllerRoutes,
        accuracy: matchedControllerRoutes / askFactIds.length,
      },
      totalUsage,
      calls,
    };
  } catch (error) {
    const calls = callSummaries(events);
    const failedRoles = calls
      .filter(({ status }) => status === "failed")
      .map(({ role }) => role);
    const message = error instanceof Error ? error.message : "unknown live-eval error";
    throw new Error(
      `Live eval failed after ${calls.length} provider calls` +
        `${failedRoles.length === 0 ? "" : `; failed roles: ${failedRoles.join(",")}`}: ${message}`,
      { cause: error },
    );
  } finally {
    service.close();
  }
}

export async function runOpenAIC01LiveEval(options: {
  casePackage: CasePackage;
  provider: ModelProvider;
}): Promise<OpenAILiveEvalReport> {
  const report = await runProviderC01LiveEval({
    ...options,
    schemaVersion: "openai-c01-live-eval-v1",
    validateProvider(provider) {
      if (
        provider.identity.providerName !== "openai" &&
        !provider.identity.providerName.startsWith("openai-compatible.")
      ) {
        throw new TypeError(
          "The live eval requires an OpenAI Responses-compatible provider.",
        );
      }
      const manifest = provider.reproducibilityManifest?.();
      if (manifest?.protocol !== "openai-responses") {
        throw new TypeError(
          "The live eval requires the openai-responses protocol.",
        );
      }
    },
  });
  return report as OpenAILiveEvalReport;
}
