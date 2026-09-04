import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadCasePackages } from "../src/cli/case-loader.js";
import {
  runOpenAIC01LiveEval,
  runProviderC01LiveEval,
} from "../src/evaluation/openai-live-eval.js";
import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import {
  OpenAIModelProvider,
  OPENAI_OFFICIAL_BASE_URL,
  openAIEndpointSha256,
  type OpenAIResponsesTransport,
} from "../src/providers/openai-model-provider.js";

function scriptedProvider(options: {
  providerName?: string;
  endpointSha256?: string;
  actualModelId?: string;
  driftActualModelId?: boolean;
} = {}): OpenAIModelProvider {
  let sequence = 0;
  const providerName = options.providerName ?? "openai";
  const endpointSha256 =
    options.endpointSha256 ?? openAIEndpointSha256(OPENAI_OFFICIAL_BASE_URL);
  const transport: OpenAIResponsesTransport = {
    providerName,
    protocol: "openai-responses",
    endpointSha256,
    async create(request) {
      sequence += 1;
      const input = JSON.parse(request.input) as Record<string, unknown>;
      let output: unknown;
      if (request.role === "patient") {
        const safeCaseView = input["safeCaseView"] as {
          facts: Array<{
            factId: string;
            value: string;
            questionMatchers: string[];
          }>;
        };
        const userText = String(input["userText"])
          .normalize("NFKC")
          .toLocaleLowerCase();
        const facts = safeCaseView.facts.filter(({ questionMatchers }) =>
          questionMatchers.some((matcher) =>
            userText.includes(matcher.normalize("NFKC").toLocaleLowerCase())
          )
        );
        output = {
          reply: facts.map(({ value }) => value).join(" ") || "你好，医生。",
          interactionKind: facts.length > 0 ? "medical_chat" : "social_chat",
          factIdsUsed: facts.map(({ factId }) => factId),
          personaFactIdsUsed: [],
          completedTestIdsUsed: [],
          requestedTestId: null,
          suggestedTestId: null,
          newFactsClaimed: [],
          diagnosisLeak: false,
        };
      } else {
        const turns = input["turns"] as Array<{ turnId: string }>;
        const criterionIds = input["communicationCriterionIds"] as string[];
        output = {
          communicationScore: 50,
          supportingTurnIds: [turns[0]!.turnId],
          rubricCriterionIds: [criterionIds[0]],
          summary: "完成了 C01 工程纵切。",
        };
      }
      return {
        status: "completed",
        outputText: JSON.stringify(output),
        responseId: `resp_${sequence}`,
        requestId: `req_${sequence}`,
        modelId: options.driftActualModelId === true && sequence > 1
          ? "gpt-test-snapshot-drifted"
          : (options.actualModelId ?? "gpt-test-snapshot"),
        finishReason: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  };
  return new OpenAIModelProvider({
    transport,
    modelId: "gpt-test",
    promptVersion: "v0.2.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
  });
}

test("C01 mock GPT vertical exports a reproducible redacted benchmark report", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);

  const first = await runOpenAIC01LiveEval({
    casePackage,
    provider: scriptedProvider(),
  });
  const second = await runOpenAIC01LiveEval({
    casePackage,
    provider: scriptedProvider(),
  });
  const changedCase = structuredClone(casePackage);
  changedCase.patientFacts["fact.onset"]!.value += "（内容变更）";
  const changed = await runOpenAIC01LiveEval({
    casePackage: changedCase,
    provider: scriptedProvider(),
  });
  const schemaChangedProvider = scriptedProvider();
  const originalManifest = schemaChangedProvider.reproducibilityManifest();
  schemaChangedProvider.reproducibilityManifest = () => ({
    ...originalManifest,
    schemaSha256ByRole: {
      ...originalManifest.schemaSha256ByRole,
      patient: "0".repeat(64),
    },
  });
  const schemaChanged = await runOpenAIC01LiveEval({
    casePackage,
    provider: schemaChangedProvider,
  });
  const snapshotChanged = await runOpenAIC01LiveEval({
    casePackage,
    provider: scriptedProvider({ actualModelId: "gpt-test-snapshot-v2" }),
  });

  assert.equal(first.sessionPhase, "completed");
  assert.equal(first.providerName, "openai");
  assert.equal(first.referenceStatus, "engineering_reference_only");
  assert.equal(first.benchmarkFingerprint, second.benchmarkFingerprint);
  assert.notEqual(first.benchmarkFingerprint, changed.benchmarkFingerprint);
  assert.notEqual(first.benchmarkFingerprint, schemaChanged.benchmarkFingerprint);
  assert.notEqual(first.benchmarkFingerprint, snapshotChanged.benchmarkFingerprint);
  assert.notEqual(first.caseContentSha256, changed.caseContentSha256);
  assert.equal(first.providerManifest.sdkVersion, "7.7.0");
  assert.equal(first.providerManifest.protocol, "openai-responses");
  assert.equal(first.modelId, "gpt-test");
  assert.equal(first.actualModelId, "gpt-test-snapshot");
  assert.ok(first.calls.every(({ actualModelId }) => actualModelId === first.actualModelId));
  assert.match(first.providerManifest.endpointSha256, /^[a-f0-9]{64}$/u);
  assert.match(first.providerManifest.promptSha256ByRole.patient, /^[a-f0-9]{64}$/u);
  assert.match(first.providerManifest.schemaSha256ByRole.patient, /^[a-f0-9]{64}$/u);
  assert.ok(first.callCount >= 3);
  assert.equal(first.calls.some(({ role }) => role === "controller"), false);
  assert.equal(first.totalUsage.totalTokens, first.callCount * 15);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(
    serialized,
    /answerKey|rubric|internalCaseId|API_KEY|MODEL_API_KEY|patientFacts/u,
  );
});

test("OpenAI live eval fails closed when one configured alias resolves to different snapshots", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);

  await assert.rejects(
    runOpenAIC01LiveEval({
      casePackage,
      provider: scriptedProvider({ driftActualModelId: true }),
    }),
    /one stable actual model ID/u,
  );
});

test("C01 report binds a compatible endpoint without exposing its URL", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);
  const endpointSha256 = "1".repeat(64);
  const report = await runOpenAIC01LiveEval({
    casePackage,
    provider: scriptedProvider({
      providerName: "openai-compatible.1111111111111111",
      endpointSha256,
    }),
  });

  assert.equal(report.providerName, "openai-compatible.1111111111111111");
  assert.equal(report.providerManifest.endpointSha256, endpointSha256);
  assert.doesNotMatch(JSON.stringify(report), /gateway|baseURL|MODEL_BASE_URL/iu);
});

test("OpenAI live eval rejects a manifest from another protocol", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);
  const provider = scriptedProvider();
  const manifest = provider.reproducibilityManifest();
  provider.reproducibilityManifest = () => ({
    ...manifest,
    protocol: "anthropic-messages",
  });

  await assert.rejects(
    runOpenAIC01LiveEval({ casePackage, provider }),
    /openai-responses protocol/u,
  );
});

test("Phase 8 live eval can collect four authorized patient samples without adding them to the public report", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);
  const samples: Array<{ question: string; reply: string; factIds: string[] }> = [];

  const report = await runProviderC01LiveEval({
    casePackage,
    provider: scriptedProvider(),
    schemaVersion: "phase8-published-case-live-eval-v1",
    questionCount: 4,
    onPatientSample(sample) {
      samples.push({
        question: sample.question,
        reply: sample.reply,
        factIds: [...sample.disclosedFactIds],
      });
    },
    validateProvider() {},
  });

  assert.equal(samples.length, 4);
  assert.deepEqual(report.controllerFactRouting, {
    evaluatedTurns: 4,
    matchedTurns: 4,
    accuracy: 1,
  });
  assert.equal(report.callCount, 5);
  assert.equal(report.calls.some(({ role }) => role === "controller"), false);
  assert.doesNotMatch(JSON.stringify(report), /question|reply|disclosedFactIds/u);
});
