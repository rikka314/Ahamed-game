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

function scriptedProvider(): AnthropicModelProvider {
  let sequence = 0;
  const transport: AnthropicMessagesTransport = {
    providerName: "anthropic",
    endpointSha256: anthropicEndpointSha256(ANTHROPIC_OFFICIAL_BASE_URL),
    async create(request) {
      sequence += 1;
      const input = JSON.parse(request.input) as Record<string, unknown>;
      let output: unknown;
      if (request.role === "controller") {
        const factIndex = input["factIndex"] as Array<{ factId: string }>;
        output = {
          action: "ask_patient",
          requestedFactIds: [factIndex[0]!.factId],
          safetyCode: null,
        };
      } else if (request.role === "patient") {
        const facts = input["allowedFacts"] as Array<{ factId: string; value: string }>;
        output = {
          reply: facts.map(({ value }) => value).join(" "),
          factsUsed: facts.map(({ factId }) => factId),
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
        modelId: "claude-test-snapshot",
        finishReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  };
  return new AnthropicModelProvider({
    transport,
    modelId: "claude-test",
    promptVersion: "v0.1.0",
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

  assert.equal(first.schemaVersion, "anthropic-c01-live-eval-v1");
  assert.equal(first.sessionPhase, "completed");
  assert.equal(first.providerName, "anthropic");
  assert.equal(first.referenceStatus, "engineering_reference_only");
  assert.equal(first.benchmarkFingerprint, second.benchmarkFingerprint);
  assert.equal(first.providerManifest.protocol, "anthropic-messages");
  assert.match(first.providerManifest.sdkVersion, /^0\.\d+\.\d+$/u);
  assert.ok(first.callCount >= 3);
  assert.equal(first.totalUsage.totalTokens, first.callCount * 15);
  assert.doesNotMatch(
    JSON.stringify(first),
    /answerKey|rubric|internalCaseId|API_KEY|ANTHROPIC_API_KEY|patientFacts/u,
  );
});

test("Claude live eval rejects a provider identity from another protocol", async () => {
  const [casePackage] = loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
  assert.ok(casePackage);
  const provider = scriptedProvider();
  Object.defineProperty(provider, "identity", {
    value: Object.freeze({
      ...provider.identity,
      providerName: "openai",
    }),
  });

  await assert.rejects(
    runAnthropicC01LiveEval({ casePackage, provider }),
    /Anthropic Messages provider/u,
  );
});
