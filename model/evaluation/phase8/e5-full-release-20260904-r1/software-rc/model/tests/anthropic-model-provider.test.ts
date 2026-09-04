import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import { buildSafePatientCaseView } from "../src/domain/safe-patient-case-view.js";
import {
  AnthropicModelProvider,
  ANTHROPIC_OFFICIAL_BASE_URL,
  anthropicEndpointSha256,
  type AnthropicMessagesTransport,
  type AnthropicTransportRequest,
  type AnthropicTransportResponse,
} from "../src/providers/anthropic-model-provider.js";
import {
  OpenAIModelProvider,
  type OpenAIResponsesTransport,
} from "../src/providers/openai-model-provider.js";
import {
  ModelProviderOutputError,
  ModelProviderRequestError,
  type PatientInput,
} from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";
import { createCaseV2Fixture } from "./fixtures/case-v2-fixture.js";

class ScriptedAnthropicTransport implements AnthropicMessagesTransport {
  readonly providerName = "anthropic";
  readonly protocol = "anthropic-messages";
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

function patientInput(
  operationId: string,
  userText = "When did it start?",
): PatientInput {
  const fixture = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(fixture);
  return {
    operationId,
    userText,
    patientProfile: safeCaseView.patientProfile,
    safeCaseView,
    recentTurns: [],
    disclosedFactIds: [],
    completedTests: [],
    consecutiveOffTopicTurns: 0,
  };
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
      interactionKind: "medical_chat",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      requestedTestId: null,
      suggestedTestId: null,
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
  const reply = await model.generatePatientReply(
    patientInput("operation_turn_1", "什么时候开始的？"),
  );
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
  assert.doesNotMatch(
    transport.requests[2]!.input,
    /targetDiagnosis|history\.fact|differential\.concept|test\.(?:required|unnecessary)|mustAskFactIds|acceptableDifferentialConceptIds|testClassifications/u,
  );
  assert.equal(
    transport.requests[2]!.input.includes(fixture.answerKey.targetDiagnosis),
    false,
  );
  const manifest = model.reproducibilityManifest();
  assert.equal(manifest.protocol, "anthropic-messages");
  assert.match(manifest.sdkVersion, /^0\.\d+\.\d+$/u);
  assert.match(manifest.schemaSha256ByRole.patient, /^[a-f0-9]{64}$/u);
});

test("Anthropic Patient adapter carries the same Persona v2 safe projection", async () => {
  const transport = new ScriptedAnthropicTransport([response({
    reply: "您好，医生。",
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    requestedTestId: null,
    suggestedTestId: null,
    diagnosisIntent: {
      decision: "continue_dialogue",
      primaryDiagnosis: null,
      differentialDiagnoses: [],
      candidateDiagnoses: [],
    },
    newFactsClaimed: [],
    diagnosisLeak: false,
  })]);
  const model = new AnthropicModelProvider({
    transport,
    modelId: "claude-test",
    promptVersion: "v0.5.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
  });
  const casePackage = createCaseV2Fixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);

  await model.generatePatientReply({
    operationId: "operation_persona_v2",
    userText: "你好",
    patientProfile: safeCaseView.patientProfile,
    safeCaseView,
    recentTurns: [],
    disclosedFactIds: [],
    completedTests: [],
    consecutiveOffTopicTurns: 0,
  });

  const input = transport.requests[0]!.input;
  assert.match(input, /patient-role\.fixture-001/u);
  assert.match(input, /talkative_digressive/u);
  assert.match(input, /healthLiteracy/u);
  assert.doesNotMatch(input, /answerKey|rubric|Fixture Syndrome/u);
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
    model.generatePatientReply(
      patientInput("operation_shared_retry", "什么时候开始的？"),
    ),
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

test("Claude rejects a transport with a mismatched provider identity", () => {
  const transport = new ScriptedAnthropicTransport([]);
  Object.defineProperty(transport, "providerName", { value: "openai" });

  assert.throws(
    () => provider(transport),
    /Anthropic transport providerName must be anthropic/u,
  );
});

test("providers reject cross-protocol transport wiring", () => {
  const anthropicTransport = new ScriptedAnthropicTransport([]);
  Object.defineProperty(anthropicTransport, "protocol", {
    value: "openai-responses",
  });
  assert.throws(
    () => provider(anthropicTransport),
    /Anthropic transport protocol must be anthropic-messages/u,
  );

  const openAITransport = new ScriptedAnthropicTransport([]);
  assert.throws(
    () => new OpenAIModelProvider({
      transport: openAITransport as unknown as OpenAIResponsesTransport,
      modelId: "gpt-test",
      promptVersion: "v0.1.0",
      promptRegistry: new FilePromptRegistry(resolve("prompts")),
    }),
    /OpenAI transport protocol must be openai-responses/u,
  );
});

test("Claude preserves non-retryable stop reasons without replay", async () => {
  const transport = new ScriptedAnthropicTransport([
    response({}, {
      status: "failed",
      outputText: "",
      finishReason: "tool_use",
      failureCode: "tool_use",
    }),
  ]);
  const model = provider(transport);

  await assert.rejects(
    model.classifyTurn({
      operationId: "operation_tool_use",
      text: "你好",
      locale: "zh-CN",
      factIndex: [],
    }),
    (error: unknown) =>
      error instanceof ModelProviderRequestError && !error.retryable,
  );
  assert.equal(transport.requests.length, 1);
  const [record] = model.drainCallRecords("operation_tool_use");
  assert.equal(record?.finishReason, "tool_use");
  assert.equal(record?.failureCode, "tool_use");
});

test("Claude failure records describe only the final retry attempt", async () => {
  const transport = new ScriptedAnthropicTransport([
    response({}, {
      status: "incomplete",
      outputText: "",
      requestId: "req_first",
      finishReason: "max_tokens",
      failureCode: "max_tokens",
    }),
    new ModelProviderRequestError(
      "ANTHROPIC_TIMEOUT",
      "Anthropic request failed.",
      {
        retryable: true,
        providerRequestId: "req_second",
      },
    ),
  ]);
  const model = provider(transport);

  await assert.rejects(
    model.classifyTurn({
      operationId: "operation_final_attempt",
      text: "你好",
      locale: "zh-CN",
      factIndex: [],
    }),
    (error: unknown) =>
      error instanceof ModelProviderRequestError &&
      error.code === "ANTHROPIC_TIMEOUT",
  );

  const [record] = model.drainCallRecords("operation_final_attempt");
  assert.equal(record?.retryCount, 1);
  assert.equal(record?.failureCode, "ANTHROPIC_TIMEOUT");
  assert.equal(record?.providerRequestId, "req_second");
  assert.equal(record?.finishReason, undefined);
  assert.equal(record?.responseStatus, undefined);
  assert.deepEqual(record?.usage, {
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
  });
});
