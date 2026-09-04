import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadCasePackages } from "../src/cli/case-loader.js";
import { runAnthropicC01LiveEval } from "../src/evaluation/anthropic-live-eval.js";
import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import {
  AnthropicModelProvider,
  ANTHROPIC_OFFICIAL_BASE_URL,
  anthropicEndpointSha256,
  type AnthropicMessagesTransport,
} from "../src/providers/anthropic-model-provider.js";

function scriptedProvider(options: {
  actualModelId?: string;
  driftActualModelId?: boolean;
} = {}): AnthropicModelProvider {
  let sequence = 0;
  const transport: AnthropicMessagesTransport = {
    providerName: "anthropic",
    protocol: "anthropic-messages",
    endpointSha256: anthropicEndpointSha256(ANTHROPIC_OFFICIAL_BASE_URL),
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
          summary: "完成了 C01 Claude 工程纵切。",
        };
      }
      return {
        status: "completed",
        outputText: JSON.stringify(output),
        responseId: `msg_${sequence}`,
        requestId: `req_${sequence}`,
        modelId: options.driftActualModelId === true && sequence > 1
          ? "claude-test-snapshot-drifted"
          : (options.actualModelId ?? "claude-test-snapshot"),
        finishReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  };
  return new AnthropicModelProvider({
    transport,
    modelId: "claude-test",
    promptVersion: "v0.2.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
  });
}

test("C01 mock Claude vertical exports a reproducible redacted benchmark report", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);

  const first = await runAnthropicC01LiveEval({
    casePackage,
    provider: scriptedProvider(),
  });
  const second = await runAnthropicC01LiveEval({
    casePackage,
    provider: scriptedProvider(),
  });
  const snapshotChanged = await runAnthropicC01LiveEval({
    casePackage,
    provider: scriptedProvider({ actualModelId: "claude-test-snapshot-v2" }),
  });

  assert.equal(first.schemaVersion, "anthropic-c01-live-eval-v1");
  assert.equal(first.sessionPhase, "completed");
  assert.equal(first.providerName, "anthropic");
  assert.equal(first.referenceStatus, "engineering_reference_only");
  assert.equal(first.benchmarkFingerprint, second.benchmarkFingerprint);
  assert.notEqual(first.benchmarkFingerprint, snapshotChanged.benchmarkFingerprint);
  assert.equal(first.providerManifest.protocol, "anthropic-messages");
  assert.equal(first.modelId, "claude-test");
  assert.equal(first.actualModelId, "claude-test-snapshot");
  assert.ok(first.calls.every(({ actualModelId }) => actualModelId === first.actualModelId));
  assert.match(first.providerManifest.sdkVersion, /^0\.\d+\.\d+$/u);
  assert.ok(first.callCount >= 3);
  assert.equal(first.calls.some(({ role }) => role === "controller"), false);
  assert.equal(first.totalUsage.totalTokens, first.callCount * 15);
  assert.doesNotMatch(
    JSON.stringify(first),
    /answerKey|rubric|internalCaseId|API_KEY|ANTHROPIC_API_KEY|patientFacts/u,
  );
});

test("Claude live eval fails closed when one configured alias resolves to different snapshots", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);

  await assert.rejects(
    runAnthropicC01LiveEval({
      casePackage,
      provider: scriptedProvider({ driftActualModelId: true }),
    }),
    /one stable actual model ID/u,
  );
});

test("Claude live eval rejects a manifest from another protocol", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);
  const provider = scriptedProvider();
  const originalManifest = provider.reproducibilityManifest();
  provider.reproducibilityManifest = () => ({
    ...originalManifest,
    protocol: "openai-responses",
  });

  await assert.rejects(
    runAnthropicC01LiveEval({ casePackage, provider }),
    /anthropic-messages protocol/u,
  );
});
