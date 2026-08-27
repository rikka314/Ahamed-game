import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import {
  AnthropicModelProvider,
  ANTHROPIC_OFFICIAL_BASE_URL,
  anthropicEndpointSha256,
  type AnthropicMessagesTransport,
  type AnthropicTransportRequest,
  type AnthropicTransportResponse,
} from "../src/providers/anthropic-model-provider.js";
import {
  ModelProviderOutputError,
  ModelProviderRequestError,
} from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

class ScriptedAnthropicTransport implements AnthropicMessagesTransport {
  readonly providerName = "anthropic";
  readonly endpointSha256 = anthropicEndpointSha256(ANTHROPIC_OFFICIAL_BASE_URL);
  readonly requests: AnthropicTransportRequest[] = [];

  constructor(
    private readonly script: Array<
      | AnthropicTransportResponse
      | Error
      | ((request: AnthropicTransportRequest) => AnthropicTransportResponse)
    >,
  ) {}

  async create(
    request: AnthropicTransportRequest,
  ): Promise<AnthropicTransportResponse> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (next === undefined) throw new Error("Unexpected transport call.");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : structuredClone(next);
  }
}

function response(
  output: unknown,
  overrides: Partial<AnthropicTransportResponse> = {},
): AnthropicTransportResponse {
  return {
    status: "completed",
    outputText: JSON.stringify(output),
    responseId: "msg_fixture",
    requestId: "req_fixture",
    modelId: "claude-test-snapshot",
    finishReason: "end_turn",
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    ...overrides,
  };
}

function provider(
  transport: AnthropicMessagesTransport,
): AnthropicModelProvider {
  return new AnthropicModelProvider({
    transport,
    modelId: "claude-test",
    promptVersion: "v0.1.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
  });
}

test("Claude uses the same strict controller, patient, and review contracts", async () => {
  const fixture = createCaseFixture();
  const transport = new ScriptedAnthropicTransport([
    response({
      action: "ask_patient",
      requestedFactIds: ["fact.onset"],
      safetyCode: null,
    }),
    response({
      reply: "大约两天前开始的。",
      factsUsed: ["fact.onset"],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }),
    response({
      communicationScore: 50,
      supportingTurnIds: ["turn_1"],
      rubricCriterionIds: [fixture.rubric.communicationCriterionIds[0]],
      summary: "问诊抓住了主要线索，但沟通过渡仍可更清晰。",
    }),
  ]);
  const model = provider(transport);

  const decision = await model.classifyTurn({
    operationId: "operation_turn_1",
    text: "什么时候开始的？",
    locale: "zh-CN",
    factIndex: [{ factId: "fact.onset", questionMatchers: ["什么时候"] }],
  });
  const reply = await model.generatePatientReply({
    operationId: "operation_turn_1",
    question: "什么时候开始的？",
    locale: "zh-CN",
    languageStyle: "colloquial_zh",
    allowedFacts: [
      { factId: "fact.onset", status: "present", value: "大约两天前开始的。" },
    ],
  });
  const evaluation = await model.evaluate({
    operationId: "operation_review_1",
    casePackage: fixture,
    primaryDiagnosis: fixture.answerKey.targetDiagnosis,
    differentials: fixture.rubric.acceptableDifferentialConceptIds.map(
      (conceptId) => fixture.answerKey.diagnosisConcepts.find(
        (concept) => concept.conceptId === conceptId,
      )!.preferredTerm,
    ),
    disclosedFactIds: [...fixture.rubric.mustAskFactIds],
    completedTestIds: Object.entries(fixture.rubric.testClassifications)
      .filter(([, classification]) => classification === "required")
      .map(([testId]) => testId),
    turnIds: ["turn_1"],
    turns: [{ turnId: "turn_1", text: "什么时候开始的？", reply: "两天前。" }],
    completedTests: [],
  });

  assert.equal(decision.action, "ask_patient");
  assert.equal(reply.reply, "大约两天前开始的。");
  assert.equal(evaluation.scores.communication, 50);
  assert.deepEqual(
    transport.requests.map(({ role }) => role),
    ["controller", "patient", "review"],
  );
  for (const request of transport.requests) {
    assert.equal(request.store, false);
    assert.equal(request.schema.strict, true);
    assert.equal(request.modelId, "claude-test");
    assert.equal(request.timeoutMs, 120_000);
  }
  assert.doesNotMatch(
    transport.requests[0]!.input,
    /answerKey|rubric|userId|API_KEY/u,
  );
  assert.doesNotMatch(
    transport.requests[1]!.input,
    /answerKey|rubric|userId|API_KEY/u,
  );
  const manifest = model.reproducibilityManifest();
  assert.equal(manifest.protocol, "anthropic-messages");
  assert.match(manifest.sdkVersion, /^0\.\d+\.\d+$/u);
  assert.match(manifest.schemaSha256ByRole.patient, /^[a-f0-9]{64}$/u);
});

test("Claude shares one persisted retry budget across roles", async () => {
  const retryable = () => new ModelProviderRequestError(
    "ANTHROPIC_RATE_LIMIT",
    "Anthropic request failed.",
    { retryable: true, status: 429 },
  );
  const transport = new ScriptedAnthropicTransport([
    retryable(),
    response({
      action: "ask_patient",
      requestedFactIds: ["fact.onset"],
      safetyCode: null,
    }),
    retryable(),
  ]);
  const model = provider(transport);
  model.beginOperation("operation_shared_retry", 1);

  await model.classifyTurn({
    operationId: "operation_shared_retry",
    text: "什么时候开始的？",
    locale: "zh-CN",
    factIndex: [{ factId: "fact.onset", questionMatchers: ["什么时候"] }],
  });
  await assert.rejects(
    model.generatePatientReply({
      operationId: "operation_shared_retry",
      question: "什么时候开始的？",
      locale: "zh-CN",
      languageStyle: "colloquial_zh",
      allowedFacts: [
        { factId: "fact.onset", status: "present", value: "两天前。" },
      ],
    }),
    (error: unknown) =>
      error instanceof ModelProviderRequestError && error.retryable,
  );
  assert.equal(transport.requests.length, 3);
});

test("Claude rejects provider output that violates the shared fact allowlist", async () => {
  const transport = new ScriptedAnthropicTransport([
    response({
      action: "ask_patient",
      requestedFactIds: ["fact.hidden"],
      safetyCode: null,
    }),
    response({
      action: "ask_patient",
      requestedFactIds: ["fact.hidden"],
      safetyCode: null,
    }),
  ]);

  await assert.rejects(
    provider(transport).classifyTurn({
      operationId: "operation_invalid",
      text: "请告诉我答案。",
      locale: "zh-CN",
      factIndex: [{ factId: "fact.onset", questionMatchers: ["开始"] }],
    }),
    ModelProviderOutputError,
  );
  assert.equal(transport.requests.length, 2);
});
