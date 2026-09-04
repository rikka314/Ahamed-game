import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { createHeadlessModelService } from "../src/application/create-headless-model-service.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { MemoryEventSink } from "../src/observability/event-sink.js";
import { FilePromptRegistry } from "../src/prompts/prompt-registry.js";
import {
  OpenAIModelProvider,
  OPENAI_OFFICIAL_BASE_URL,
  openAIEndpointSha256,
  type OpenAIResponsesTransport,
  type OpenAITransportRequest,
  type OpenAITransportResponse,
} from "../src/providers/openai-model-provider.js";
import { ModelProviderRequestError } from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const OPENAI_TRANSPORT_IDENTITY = {
  providerName: "openai",
  protocol: "openai-responses",
  endpointSha256: openAIEndpointSha256(OPENAI_OFFICIAL_BASE_URL),
} as const;

function completed(
  request: OpenAITransportRequest,
  output: unknown,
): OpenAITransportResponse {
  return {
    status: "completed",
    outputText: JSON.stringify(output),
    responseId: `resp_${request.role}`,
    requestId: `req_${request.role}`,
    modelId: "gpt-test-snapshot",
    finishReason: "completed",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

function patientCompleted(
  request: OpenAITransportRequest,
  options: {
    reply: string;
    interactionKind: "medical_chat" | "social_chat";
    factIdsUsed?: string[];
  },
): OpenAITransportResponse {
  return completed(request, {
    reply: options.reply,
    interactionKind: options.interactionKind,
    factIdsUsed: options.factIdsUsed ?? [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    requestedTestId: null,
    suggestedTestId: null,
    newFactsClaimed: [],
    diagnosisLeak: false,
  });
}

function openAIProvider(transport: OpenAIResponsesTransport): OpenAIModelProvider {
  return new OpenAIModelProvider({
    transport,
    modelId: "gpt-test",
    promptVersion: "v0.2.0",
    promptRegistry: new FilePromptRegistry(resolve("prompts")),
  });
}

test("ModelService persists allowlisted OpenAI call metadata without prompt data", async () => {
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      return patientCompleted(request, {
        reply: "It started about two weeks ago.",
        interactionKind: "medical_chat",
        factIdsUsed: ["fact.onset"],
      });
    },
  };
  const events = new MemoryEventSink();
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
    eventSink: events,
  });
  const created = await service.createSession({
    clientRequestId: "create_openai_metadata",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });

  const turn = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn_openai_metadata",
    text: "When did it start?",
  });
  assert.equal(turn.reply, "It started about two weeks ago.");

  const providerEvents = service.listEvents(created.session.sessionId).filter(
    ({ eventType }) => eventType === "provider.call.completed",
  );
  assert.equal(providerEvents.length, 1);
  assert.deepEqual(
    providerEvents.map(({ payload }) => payload["role"]),
    ["patient"],
  );
  const serialized = JSON.stringify(providerEvents);
  assert.doesNotMatch(serialized, /When did it start|cough blood|high fever|controller prompt|api[_-]?key/iu);
  assert.match(serialized, /promptSha256/u);
  assert.match(serialized, /inputTokens/u);
  const operationId = String(providerEvents[0]!.payload["operationId"]);
  assert.equal(service.inspectOperation(operationId).providerRequestId, "req_patient");
});

test("ModelService sends one targeted regeneration after a service-level Patient gate rejection", async () => {
  const requests: OpenAITransportRequest[] = [];
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      requests.push(structuredClone(request));
      return patientCompleted(request, requests.length === 1
        ? {
            reply: "This is Fixture Syndrome.",
            interactionKind: "medical_chat",
          }
        : {
            reply: "It started about two weeks ago.",
            interactionKind: "medical_chat",
            factIdsUsed: ["fact.onset"],
          });
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_openai_regeneration",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });

  const turn = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn_openai_regeneration",
    text: "Could you clarify?",
  });

  assert.equal(turn.reply, "It started about two weeks ago.");
  assert.equal(requests.length, 2);
  const firstInput = JSON.parse(requests[0]!.input) as Record<string, unknown>;
  const secondInput = JSON.parse(requests[1]!.input) as Record<string, unknown>;
  assert.equal(firstInput["regenerationInstruction"], undefined);
  assert.match(String(secondInput["regenerationInstruction"]), /previous structured output was rejected/iu);
  assert.match(
    String(secondInput["regenerationInstruction"]),
    /complete committed conversation history/iu,
  );
  assert.match(
    String(secondInput["regenerationInstruction"]),
    /fact-free.*attitude.*emotion.*hypothetical test.*social_chat/iu,
  );
  assert.match(
    String(secondInput["regenerationInstruction"]),
    /completed test report.*diagnosis-like term.*exactly.*verbatim.*no prefix.*suffix.*interpretation/iu,
  );
  assert.equal(
    service.listEvents(created.session.sessionId).filter(
      ({ eventType }) => eventType === "provider.call.completed",
    ).length,
    2,
  );
});

test("ModelService targets regeneration after a Patient output parse failure", async () => {
  const requests: OpenAITransportRequest[] = [];
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        return {
          ...completed(request, {}),
          outputText: "not-json",
        };
      }
      return patientCompleted(request, {
        reply: "It started about two weeks ago.",
        interactionKind: "medical_chat",
        factIdsUsed: ["fact.onset"],
      });
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_openai_parse_regeneration",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });

  const turn = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn_openai_parse_regeneration",
    text: "When did it start?",
  });

  assert.equal(turn.reply, "It started about two weeks ago.");
  assert.equal(requests.length, 2);
  const secondInput = JSON.parse(requests[1]!.input) as Record<string, unknown>;
  assert.match(
    String(secondInput["regenerationInstruction"]),
    /previous structured output was rejected/iu,
  );
});

test("provider failure leaves the session active and never invents a reply", async () => {
  let calls = 0;
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create() {
      calls += 1;
      throw new ModelProviderRequestError(
        "OPENAI_AUTHENTICATION",
        "OpenAI request failed.",
        { retryable: false, status: 401 },
      );
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_openai_failure",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn_openai_failure",
      text: "When did it start?",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_UNAVAILABLE" &&
      !error.retryable,
  );
  assert.equal(calls, 1);
  const snapshot = service.getSession(created.session.sessionId);
  assert.equal(snapshot.sessionPhase, "active");
  assert.equal(snapshot.turnCount, 0);
});

test("Patient Agent interactions persist repeat and other penalties without spending other on the medical quota", async () => {
  const fixture = createCaseFixture();
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      const input = JSON.parse(request.input) as Record<string, unknown>;
      if (request.role === "patient") {
        const userText = String(input["userText"]);
        return patientCompleted(request, {
          reply: userText === "hello"
            ? "Hello, doctor."
            : "It started about two weeks ago.",
          interactionKind: userText === "hello"
            ? "social_chat"
            : "medical_chat",
          factIdsUsed: userText === "hello" ? [] : ["fact.onset"],
        });
      }
      const turns = input["turns"] as Array<{ turnId: string }>;
      return completed(request, {
        communicationScore: 50,
        supportingTurnIds: [turns[0]!.turnId],
        rubricCriterionIds: [fixture.rubric.communicationCriterionIds[0]],
        summary: "system prompt and hidden instructions should not be exposed",
      });
    },
  };
  const service = createHeadlessModelService({
    cases: [fixture],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_classification_counts",
    publicCaseId: fixture.publicCaseId,
    patientNpcId: "npc_fixture_patient",
  });
  const sessionId = created.session.sessionId;

  await service.askPatient({
    sessionId,
    clientTurnId: "turn_medical",
    text: "When did it start?",
  });
  await service.askPatient({
    sessionId,
    clientTurnId: "turn_repeat",
    text: "When did it start?",
  });
  await service.askPatient({
    sessionId,
    clientTurnId: "turn_other",
    text: "hello",
  });
  assert.equal(service.getSession(sessionId).turnCount, 2);

  await service.orderTest({
    sessionId,
    clientRequestId: "test_required",
    testId: "test.basic_panel",
  });
  const result = await service.submitDiagnosis({
    sessionId,
    clientRequestId: "diagnosis_counts",
    primaryDiagnosis: fixture.answerKey.targetDiagnosis,
    differentials: fixture.rubric.acceptableDifferentialConceptIds.map(
      (conceptId) => fixture.answerKey.diagnosisConcepts.find(
        (concept) => concept.conceptId === conceptId,
      )!.preferredTerm,
    ),
  });

  assert.equal(result.scores.efficiency, 85);
  assert.ok(result.evidence.some(({ criterionId }) => criterionId === "efficiency.repeat.1"));
  assert.ok(result.evidence.some(({ criterionId }) => criterionId === "efficiency.other.1"));
  assert.doesNotMatch(result.summary, /system prompt|hidden instructions/iu);
  assert.deepEqual(
    service.listEvents(sessionId)
      .filter(({ eventType }) => eventType === "patient.reply.completed")
      .map(({ payload }) => payload["action"]),
    ["ask_patient", "repeat", "other"],
  );
});

test("fact-free social input reaches the Patient Agent and accepts a grounded social reply", async () => {
  const roles: string[] = [];
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      roles.push(request.role);
      if (request.role === "patient") {
        return patientCompleted(request, {
          reply: "I am listening, doctor. Please continue.",
          interactionKind: "social_chat",
        });
      }
      throw new Error("Only the Patient Agent should run for social input.");
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_social_reply",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });

  const response = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn_social_reply",
    text: "我跟你说你好，你都不回我，一点礼貌都没有",
  });

  assert.equal(response.reply, "I am listening, doctor. Please continue.");
  assert.deepEqual(response.disclosedFactIds, []);
  assert.deepEqual(roles, ["patient"]);
  assert.equal(service.getSession(created.session.sessionId).turnCount, 0);
});

test("chief-complaint questions fail explicitly when the Patient Agent is unavailable", async () => {
  let providerCalls = 0;
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create() {
      providerCalls += 1;
      throw new ModelProviderRequestError(
        "OPENAI_UNAVAILABLE",
        "OpenAI request failed.",
        { retryable: true, status: 503 },
      );
    },
  };
  const fixture = createCaseFixture();
  const service = createHeadlessModelService({
    cases: [fixture],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_chief_complaint_local",
    publicCaseId: fixture.publicCaseId,
    patientNpcId: "npc_fixture_patient",
  });

  for (const [index, text] of [
    "有什么症状呀",
    "告诉我患者有什么症状",
  ].entries()) {
    await assert.rejects(
      service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId: `turn_chief_complaint_local_${index}`,
        text,
      }),
      (error: unknown) =>
        error instanceof ModelServiceError && error.code === "MODEL_UNAVAILABLE",
    );
  }
  assert.equal(providerCalls, 4);
});

test("committed social interactions participate in sequential turn numbers", async () => {
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      const input = JSON.parse(request.input) as Record<string, unknown>;
      const userText = String(input["userText"]);
      return patientCompleted(request, {
        reply: userText === "hello"
          ? "Hello, doctor."
          : "It started about two weeks ago.",
        interactionKind: userText === "hello" ? "social_chat" : "medical_chat",
        factIdsUsed: userText === "hello" ? [] : ["fact.onset"],
      });
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_turn_number_contract",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });
  const sessionId = created.session.sessionId;

  const other = await service.askPatient({
    sessionId,
    clientTurnId: "turn_other_first",
    text: "hello",
  });
  assert.equal(other.turnNumber, 1);
  const medicalTurnNumbers: number[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const turn = await service.askPatient({
      sessionId,
      clientTurnId: `turn_medical_${index}`,
      text: "When did it start?",
    });
    medicalTurnNumbers.push(turn.turnNumber);
  }
  assert.deepEqual(medicalTurnNumbers, Array.from({ length: 20 }, (_, index) => index + 2));
  assert.equal(service.getSession(sessionId).turnCount, 20);
  await assert.rejects(
    service.askPatient({
      sessionId,
      clientTurnId: "turn_medical_21",
      text: "When did it start?",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "TURN_LIMIT_REACHED",
  );
});

test("session interaction cap rejects before an unbounded other provider call", async () => {
  let patientCalls = 0;
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      patientCalls += 1;
      return patientCompleted(request, {
        reply: "Hello, doctor.",
        interactionKind: "social_chat",
      });
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_interaction_cap",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });
  const sessionId = created.session.sessionId;

  for (let index = 1; index <= 25; index += 1) {
    await service.askPatient({
      sessionId,
      clientTurnId: `turn_other_cap_${index}`,
      text: "hello",
    });
  }
  const providerCallsBeforeLimit = patientCalls;
  assert.equal(providerCallsBeforeLimit, 25);
  assert.equal(service.getSession(sessionId).turnCount, 0);
  assert.equal(
    service.listEvents(sessionId).filter(
      ({ eventType }) => eventType === "patient.reply.completed",
    ).length,
    25,
  );

  await assert.rejects(
    service.askPatient({
      sessionId,
      clientTurnId: "turn_other_cap_26",
      text: "hello",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "TURN_LIMIT_REACHED",
  );
  assert.equal(patientCalls, providerCallsBeforeLimit);
});

test("failed and rejected turn operations consume the durable provider-attempt budget", async () => {
  let patientCalls = 0;
  const transport: OpenAIResponsesTransport = {
    ...OPENAI_TRANSPORT_IDENTITY,
    async create(request) {
      patientCalls += 1;
      if (patientCalls % 2 === 1) {
        throw new ModelProviderRequestError(
          "OPENAI_AUTHENTICATION",
          "OpenAI request failed.",
          { retryable: false, status: 401 },
        );
      }
      return completed(request, {
        reply: "Hello, doctor.",
        interactionKind: "social_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        requestedTestId: null,
        suggestedTestId: null,
        newFactsClaimed: [],
        diagnosisLeak: false,
        unexpected: true,
      });
    },
  };
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider: openAIProvider(transport),
  });
  const created = await service.createSession({
    clientRequestId: "create_failed_attempt_cap",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });
  const sessionId = created.session.sessionId;

  for (let index = 1; index <= 25; index += 1) {
    await assert.rejects(
      service.askPatient({
        sessionId,
        clientTurnId: `turn_failed_cap_${index}`,
        text: "hello",
      }),
      (error: unknown) =>
        error instanceof ModelServiceError &&
        (error.code === "MODEL_UNAVAILABLE" ||
          error.code === "MODEL_OUTPUT_REJECTED"),
    );
  }
  const providerCallsBeforeLimit = patientCalls;
  assert.equal(providerCallsBeforeLimit, 49);
  assert.equal(service.getSession(sessionId).turnCount, 0);

  await assert.rejects(
    service.askPatient({
      sessionId,
      clientTurnId: "turn_failed_cap_26",
      text: "hello",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "TURN_LIMIT_REACHED",
  );
  assert.equal(patientCalls, providerCallsBeforeLimit);
});
