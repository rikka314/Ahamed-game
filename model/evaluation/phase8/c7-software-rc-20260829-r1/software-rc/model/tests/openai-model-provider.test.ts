import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import { buildSafePatientCaseView } from "../src/domain/safe-patient-case-view.js";
import {
  OpenAIModelProvider,
  OPENAI_OFFICIAL_BASE_URL,
  openAIEndpointSha256,
  type OpenAIResponsesTransport,
  type OpenAITransportRequest,
  type OpenAITransportResponse,
} from "../src/providers/openai-model-provider.js";
import {
  ModelProviderOutputError,
  ModelProviderRequestError,
  type PatientInput,
} from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

class ScriptedTransport implements OpenAIResponsesTransport {
  readonly providerName = "openai";
  readonly protocol = "openai-responses";
  readonly endpointSha256 = openAIEndpointSha256(OPENAI_OFFICIAL_BASE_URL);
  readonly requests: OpenAITransportRequest[] = [];

  constructor(
    private readonly script: Array<
      OpenAITransportResponse | Error | ((request: OpenAITransportRequest) => OpenAITransportResponse)
    >,
  ) {}

  async create(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (next === undefined) throw new Error("Unexpected transport call.");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : structuredClone(next);
  }
}

function response(output: unknown, overrides: Partial<OpenAITransportResponse> = {}): OpenAITransportResponse {
  return {
    status: "completed",
    outputText: JSON.stringify(output),
    responseId: "resp_fixture",
    requestId: "req_fixture",
    modelId: "gpt-test",
    finishReason: "completed",
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    ...overrides,
  };
}

function provider(transport: OpenAIResponsesTransport): OpenAIModelProvider {
  return new OpenAIModelProvider({
    transport,
    modelId: "gpt-test",
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

test("controller and patient calls use strict schemas and minimum role data", async () => {
  const transport = new ScriptedTransport([
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

  assert.equal(decision.action, "ask_patient");
  assert.equal(reply.reply, "大约两天前开始的。");
  assert.equal(transport.requests.length, 2);
  for (const request of transport.requests) {
    assert.equal(request.store, false);
    assert.equal(request.schema.strict, true);
    assert.equal(request.modelId, "gpt-test");
    assert.equal(request.timeoutMs, 120_000);
  }
  const controllerPayload = JSON.parse(transport.requests[0]!.input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(controllerPayload).sort(), ["factIndex", "locale", "question"]);
  assert.doesNotMatch(transport.requests[0]!.input, /大约两天前/u);
  const patientPayload = JSON.parse(transport.requests[1]!.input) as Record<string, unknown>;
  assert.deepEqual(Object.keys(patientPayload).sort(), [
    "completedTests",
    "consecutiveOffTopicTurns",
    "disclosedFactIds",
    "patientProfile",
    "recentTurns",
    "safeCaseView",
    "userText",
  ]);
  assert.doesNotMatch(transport.requests[1]!.input, /answerKey|rubric|userId|API_KEY/u);
  const patientSchema = transport.requests[1]!.schema.schema as {
    properties: Record<string, unknown>;
  };
  assert.deepEqual(patientSchema.properties["factIdsUsed"], {
    type: "array",
    items: {
      type: "string",
      enum: ["fact.family_history", "fact.onset", "fact.rash"],
    },
  });
  assert.deepEqual(patientSchema.properties["newFactsClaimed"], {
    type: "array",
    maxItems: 0,
    items: { type: "string" },
  });
});

test("retryable transport and schema failures share one retry budget", async () => {
  const retryable = new ModelProviderRequestError(
    "OPENAI_RATE_LIMIT",
    "OpenAI request failed.",
    { retryable: true, status: 429 },
  );
  const transport = new ScriptedTransport([
    retryable,
    response({ action: "other", requestedFactIds: [], safetyCode: null }),
  ]);
  const model = provider(transport);

  assert.deepEqual(
    await model.classifyTurn({
      operationId: "operation_retry",
      text: "你好",
      locale: "zh-CN",
      factIndex: [],
    }),
    { action: "other", requestedFactIds: [] },
  );
  assert.equal(transport.requests.length, 2);
  const records = model.drainCallRecords("operation_retry");
  assert.equal(records.length, 1);
  assert.equal(records[0]!.retryCount, 1);
  assert.equal(records[0]!.status, "completed");

  const invalid = new ScriptedTransport([
    response({ action: "other", requestedFactIds: ["fact.onset"], safetyCode: null }),
    response({ action: "other", requestedFactIds: ["fact.onset"], safetyCode: null }),
  ]);
  await assert.rejects(
    provider(invalid).classifyTurn({
      operationId: "operation_invalid",
      text: "你好",
      locale: "zh-CN",
      factIndex: [{ factId: "fact.onset", questionMatchers: ["开始"] }],
    }),
    ModelProviderOutputError,
  );
  assert.equal(invalid.requests.length, 2);
});

test("one service operation shares its single automatic retry across roles", async () => {
  const retryable = () => new ModelProviderRequestError(
    "OPENAI_RATE_LIMIT",
    "OpenAI request failed.",
    { retryable: true, status: 429 },
  );
  const transport = new ScriptedTransport([
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

test("terminal controller decisions release the operation deadline", async () => {
  let now = 0;
  const transport = new ScriptedTransport([
    response({ action: "other", requestedFactIds: [], safetyCode: null }),
    response({
      reply: "两天前。",
      interactionKind: "medical_chat",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      requestedTestId: null,
      suggestedTestId: null,
      newFactsClaimed: [],
      diagnosisLeak: false,
    }),
  ]);
  const model = new OpenAIModelProvider({
    transport,
    modelId: "gpt-test",
    promptVersion: "v0.1.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
    now: () => now,
  });

  await model.classifyTurn({
    operationId: "operation_reused_after_other",
    text: "你好",
    locale: "zh-CN",
    factIndex: [],
  });
  now = 400_000;
  const reply = await model.generatePatientReply(
    patientInput("operation_reused_after_other"),
  );
  assert.deepEqual(reply.factIdsUsed, ["fact.onset"]);
});

test("non-retryable provider errors are not replayed", async () => {
  const transport = new ScriptedTransport([
    new ModelProviderRequestError(
      "OPENAI_AUTHENTICATION",
      "OpenAI request failed.",
      { retryable: false, status: 401 },
    ),
  ]);

  await assert.rejects(
    provider(transport).classifyTurn({
      operationId: "operation_auth",
      text: "你好",
      locale: "zh-CN",
      factIndex: [],
    }),
    (error: unknown) =>
      error instanceof ModelProviderRequestError && !error.retryable,
  );
  assert.equal(transport.requests.length, 1);

  const refusal = new ScriptedTransport([
    response({}, {
      status: "failed",
      outputText: "",
      failureCode: "content_filter",
      finishReason: "content_filter",
    }),
  ]);
  const refused = provider(refusal);
  await assert.rejects(
    refused.classifyTurn({
      operationId: "operation_refusal",
      text: "你好",
      locale: "zh-CN",
      factIndex: [],
    }),
    (error: unknown) =>
      error instanceof ModelProviderRequestError && !error.retryable,
  );
  assert.equal(refusal.requests.length, 1);
  assert.equal(refused.drainCallRecords("operation_refusal")[0]!.retryCount, 0);
});

test("review output can only supply communication evidence and summary", async () => {
  const fixture = createCaseFixture();
  const transport = new ScriptedTransport([
    response({
      communicationScore: 50,
      supportingTurnIds: ["turn_1"],
      rubricCriterionIds: [fixture.rubric.communicationCriterionIds[0]],
      summary: "问诊抓住了主要线索，但沟通过渡仍可更清晰。",
    }),
  ]);
  const model = provider(transport);
  const result = await model.evaluate({
    operationId: "operation_review",
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

  assert.equal(result.scores.diagnosis, 100);
  assert.equal(result.scores.communication, 50);
  assert.equal(
    result.summary,
    "本次复盘：确定性评分已完成；沟通表达部分达到当前公开评价标准，仍有改进空间。",
  );
  const payload = transport.requests[0]!.input;
  assert.doesNotMatch(payload, /answerKey|internalCaseId|userId/u);
  assert.match(payload, /deterministicEvaluation/u);
  assert.match(payload, /criterion\.history/u);
  assert.doesNotMatch(
    payload,
    /targetDiagnosis|history\.fact|differential\.concept|test\.(?:required|unnecessary)|mustAskFactIds|acceptableDifferentialConceptIds|testClassifications/u,
  );
  assert.equal(payload.includes(fixture.answerKey.targetDiagnosis), false);
});
