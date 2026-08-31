import assert from "node:assert/strict";
import test from "node:test";

import { ModelService } from "../src/application/model-service.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { MemoryEventSink, type EventSink } from "../src/observability/event-sink.js";
import { InMemoryModelPersistence } from "../src/persistence/memory/in-memory-model-persistence.js";
import type {
  ModelPersistence,
  PersistenceTransaction,
} from "../src/persistence/ports.js";
import { DeterministicModelProvider } from "../src/providers/deterministic-model-provider.js";
import { LabeledFixtureCommunicationReviewProvider } from "../src/providers/communication-review-provider.js";
import type { ModelProvider } from "../src/providers/model-provider.js";
import { InMemoryCaseRepository } from "../src/repositories/case-repository.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const START = new Date("2026-08-01T00:00:00.000Z");
const FIXTURE_PROVIDER_IDENTITY = {
  providerName: "fixture-provider",
  modelId: "fixture-model-v1",
  promptVersion: "fixture-prompt-v1",
} as const;
const FIXTURE_COMMUNICATION_REVIEW_IDENTITY = {
  providerName: "fixture-communication-review",
  modelId: "fixture-communication-review-v1",
  promptVersion: "fixture-v1",
} as const;

function errorHasCode(code: string) {
  return (error: unknown) =>
    error instanceof ModelServiceError && error.code === code;
}

function createService(options: {
  persistence?: ModelPersistence;
  provider?: ModelProvider;
  eventSink?: EventSink;
  now?: { value: Date };
  onEventSinkError?: (
    error: unknown,
    event: Parameters<EventSink["append"]>[0],
  ) => void | Promise<void>;
} = {}) {
  return new ModelService(
    new InMemoryCaseRepository([createCaseFixture()]),
    options.provider ?? new DeterministicModelProvider(),
    options.eventSink ?? new MemoryEventSink(),
    undefined,
    {
      persistence: options.persistence ?? new InMemoryModelPersistence(),
      clock: { now: () => new Date(options.now?.value ?? START) },
      ...(options.onEventSinkError === undefined
        ? {}
        : { onEventSinkError: options.onEventSinkError }),
    },
  );
}

async function createSession(
  service: ModelService,
  requestId: string,
  idempotencyScopeId = "principal.fixture",
) {
  return service.createSession({
    clientRequestId: requestId,
    idempotencyScopeId,
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc_fixture_patient",
  });
}

class FailOnTransactionPersistence implements ModelPersistence {
  readonly requiresStableIntegrityKey: boolean;
  transactionCount = 0;

  constructor(
    readonly inner: InMemoryModelPersistence,
    private readonly failAt: number,
  ) {
    this.requiresStableIntegrityKey = inner.requiresStableIntegrityKey;
  }

  transaction<T>(work: (transaction: PersistenceTransaction) => T): T {
    this.transactionCount += 1;
    if (this.transactionCount === this.failAt) {
      throw new Error("fixture local commit failure");
    }
    return this.inner.transaction(work);
  }

  close(): void {
    this.inner.close();
  }
}

class TrackingPersistence implements ModelPersistence {
  readonly inner = new InMemoryModelPersistence();
  readonly requiresStableIntegrityKey = this.inner.requiresStableIntegrityKey;
  closeCount = 0;

  transaction<T>(work: (transaction: PersistenceTransaction) => T): T {
    return this.inner.transaction(work);
  }

  close(): void {
    this.closeCount += 1;
    this.inner.close();
  }
}

test("terminal sessions reject replay of an older successful turn", async () => {
  const cancelled = createService();
  const cancelledSession = await createSession(cancelled, "create.cancelled");
  await cancelled.askPatient({
    sessionId: cancelledSession.session.sessionId,
    clientTurnId: "turn.cancelled",
    text: "When did it start?",
  });
  await cancelled.cancelSession({
    sessionId: cancelledSession.session.sessionId,
    clientRequestId: "cancel.fixture",
  });
  await assert.rejects(
    cancelled.askPatient({
      sessionId: cancelledSession.session.sessionId,
      clientTurnId: "turn.cancelled",
      text: "When did it start?",
    }),
    errorHasCode("SESSION_CANCELLED"),
  );

  const now = { value: new Date(START) };
  const expired = createService({ now });
  const expiredSession = await createSession(expired, "create.expired");
  await expired.askPatient({
    sessionId: expiredSession.session.sessionId,
    clientTurnId: "turn.expired",
    text: "When did it start?",
  });
  now.value = new Date(START.getTime() + 8 * DAY_MS);
  await assert.rejects(
    expired.askPatient({
      sessionId: expiredSession.session.sessionId,
      clientTurnId: "turn.expired",
      text: "When did it start?",
    }),
    errorHasCode("SESSION_EXPIRED"),
  );
});

test("a provider response validated after TTL is not committed", async () => {
  const now = { value: new Date(START) };
  const deterministic = new DeterministicModelProvider();
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    async generatePatientReply(input) {
      now.value = new Date(START.getTime() + 8 * DAY_MS);
      return deterministic.generatePatientReply(input);
    },
    evaluate: (input) => deterministic.evaluate(input),
  };
  const service = createService({ now, provider });
  const created = await createSession(service, "create.late-provider");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.late-provider",
      text: "When did it start?",
    }),
    errorHasCode("SESSION_EXPIRED"),
  );
  assert.equal(service.getSession(created.session.sessionId).turnCount, 0);
  assert.equal(service.getSession(created.session.sessionId).sessionPhase, "expired");
});

test("a provider response at the exact TTL boundary is not committed", async () => {
  const now = { value: new Date(START) };
  const deterministic = new DeterministicModelProvider();
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    async generatePatientReply(input) {
      now.value = new Date(START.getTime() + 7 * DAY_MS);
      return deterministic.generatePatientReply(input);
    },
    evaluate: (input) => deterministic.evaluate(input),
  };
  const service = createService({ now, provider });
  const created = await createSession(service, "create.ttl-boundary");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.ttl-boundary",
      text: "When did it start?",
    }),
    errorHasCode("SESSION_EXPIRED"),
  );
  assert.equal(service.getSession(created.session.sessionId).turnCount, 0);
  assert.equal(service.getSession(created.session.sessionId).sessionPhase, "expired");
});

test("a local commit failure preserves the validated buffer for recovery", async () => {
  const inner = new InMemoryModelPersistence();
  const persistence = new FailOnTransactionPersistence(inner, 6);
  const service = createService({ persistence });
  const created = await createSession(service, "create.local-failure");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.local-failure",
      text: "When did it start?",
    }),
    errorHasCode("OPERATION_RECOVERY_REQUIRED"),
  );

  const operation = inner.transaction((transaction) =>
    transaction.operations.listForSession(created.session.sessionId)[0],
  );
  assert.equal(operation?.status, "response_validated");
  const idempotency = inner.transaction((transaction) =>
    transaction.idempotency.get(
      created.session.sessionId,
      "submit_turn",
      "turn.local-failure",
    ),
  );
  assert.equal(idempotency?.status, "recovery_required");
});

test("event sink failure does not turn a committed request into an API failure", async () => {
  const persistence = new InMemoryModelPersistence();
  const service = createService({
    persistence,
    eventSink: {
      append() {
        throw new Error("fixture sink unavailable");
      },
    },
  });

  const created = await createSession(service, "create.sink-failure");
  assert.equal(created.session.sessionPhase, "active");
  assert.equal(
    persistence.transaction((transaction) =>
      transaction.events.list(created.session.sessionId).length,
    ),
    2,
  );
});

test("async event observers cannot create floating rejections", async () => {
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", listener);
  let reports = 0;
  try {
    const service = createService({
      eventSink: {
        async append() {
          throw new Error("fixture async sink unavailable");
        },
      },
      onEventSinkError: async () => {
        reports += 1;
        throw new Error("fixture async observer unavailable");
      },
    });

    const created = await createSession(service, "create.async-sink-failure");
    assert.equal(created.session.sessionPhase, "active");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reports, 2);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("local safety preflight never writes raw real-health text to the journal", async () => {
  const persistence = new InMemoryModelPersistence();
  const service = createService({ persistence });
  const created = await createSession(service, "create.real-health");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.real-health",
      text: "These are my own real symptoms and health concerns.",
    }),
    errorHasCode("SAFETY_REAL_HEALTH_INPUT"),
  );
  const operations = persistence.transaction((transaction) =>
    transaction.operations.listForSession(created.session.sessionId),
  );
  assert.deepEqual(operations, []);
});

test("common first-person health statements are rejected before journaling", async () => {
  const samples = [
    ["I have chest pain and shortness of breath.", "SAFETY_REAL_HEALTH_INPUT"],
    ["I have been coughing for three days.", "SAFETY_REAL_HEALTH_INPUT"],
    ["I’ve been coughing for three days.", "SAFETY_REAL_HEALTH_INPUT"],
    ["我胸痛三天了，呼吸困难。", "SAFETY_INTERRUPTED"],
    ["我这三天一直胸疼。", "SAFETY_INTERRUPTED"],
  ] as const;
  for (const [index, [text, expectedCode]] of samples.entries()) {
    const persistence = new InMemoryModelPersistence();
    const service = createService({ persistence });
    const created = await createSession(service, `create.health.${index}`);

    await assert.rejects(
      service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId: `turn.health.${index}`,
        text,
      }),
      errorHasCode(expectedCode),
    );
    assert.deepEqual(
      persistence.transaction((transaction) =>
        transaction.operations.listForSession(created.session.sessionId),
      ),
      [],
    );
  }
});

test("create-session idempotency is isolated by a trusted scope", async () => {
  const service = createService();
  const first = await createSession(service, "shared-key", "principal.first");
  const second = await createSession(service, "shared-key", "principal.second");
  const repeated = await createSession(service, "shared-key", "principal.first");

  assert.notEqual(second.session.sessionId, first.session.sessionId);
  assert.deepEqual(repeated, first);
});

test("provider failures use a stable public message", async () => {
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    async classifyTurn() {
      throw new Error("online Controller must not be called");
    },
    async generatePatientReply() {
      throw new Error("secret provider URL https://internal.invalid/request/123");
    },
    async evaluate() {
      throw new Error("not reached");
    },
  };
  const service = createService({ provider });
  const created = await createSession(service, "create.provider-error");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.provider-error",
      text: "When did it start?",
    }),
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_UNAVAILABLE" &&
      error.message === "The model provider is unavailable.",
  );
});

test("Patient Agent test-order output requires a requested test ID", async () => {
  const deterministic = new DeterministicModelProvider();
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    async generatePatientReply() {
      return {
        reply: "I will do that test.",
        interactionKind: "test_order",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      };
    },
    evaluate: (input) => deterministic.evaluate(input),
  };
  const service = createService({ provider });
  const created = await createSession(service, "create.invalid-patient-action");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.invalid-patient-action",
      text: "When did it start?",
    }),
    errorHasCode("MODEL_OUTPUT_REJECTED"),
  );
  assert.deepEqual(service.getSession(created.session.sessionId).disclosedFacts, []);
});

test("evaluation output must match the frozen local scoring policy", async () => {
  const deterministic = new DeterministicModelProvider({
    identity: FIXTURE_COMMUNICATION_REVIEW_IDENTITY,
    async review({ turnIds, rubricCriterionIds }) {
      return {
        status: "available",
        score: 100,
        supportingTurnIds: [turnIds[0]!],
        rubricCriterionIds: rubricCriterionIds.slice(0, 2),
      };
    },
  });
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    generatePatientReply: (input) => deterministic.generatePatientReply(input),
    async evaluate(input) {
      const valid = await deterministic.evaluate(input);
      return {
        ...valid,
        scores: {
          ...valid.scores,
          diagnosis: -50,
          historyCoverage: 1e100,
          total: 999,
        },
        evaluationVersion: "wrong-version",
      };
    },
  };
  const service = createService({ provider });
  const created = await createSession(service, "create.invalid-evaluation");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.invalid-evaluation",
    text: "When did it start?",
  });

  await assert.rejects(
    service.submitDiagnosis({
      sessionId: created.session.sessionId,
      clientRequestId: "diagnosis.invalid-evaluation",
      primaryDiagnosis: "Fixture Syndrome",
      differentials: ["Alternate Condition"],
    }),
    errorHasCode("MODEL_OUTPUT_REJECTED"),
  );
  assert.equal(
    service.getSession(created.session.sessionId).sessionPhase,
    "diagnosis_submitted",
  );
});

test("evaluation output rejects non-allowlisted fields", async () => {
  const deterministic = new DeterministicModelProvider({
    identity: FIXTURE_COMMUNICATION_REVIEW_IDENTITY,
    async review({ turnIds, rubricCriterionIds }) {
      return {
        status: "available",
        score: 100,
        supportingTurnIds: [turnIds[0]!],
        rubricCriterionIds: rubricCriterionIds.slice(0, 2),
      };
    },
  });
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    generatePatientReply: (input) => deterministic.generatePatientReply(input),
    async evaluate(input) {
      const valid = await deterministic.evaluate(input);
      return {
        ...valid,
        secretPrompt: "must never be persisted",
      } as typeof valid;
    },
  };
  const service = createService({ provider });
  const created = await createSession(service, "create.extra-evaluation-field");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.extra-evaluation-field",
    text: "When did it start?",
  });

  await assert.rejects(
    service.submitDiagnosis({
      sessionId: created.session.sessionId,
      clientRequestId: "diagnosis.extra-evaluation-field",
      primaryDiagnosis: "Fixture Syndrome",
      differentials: ["Alternate Condition"],
    }),
    errorHasCode("MODEL_OUTPUT_REJECTED"),
  );
});

test("invalid communication evidence is a model-output rejection", async () => {
  const deterministic = new DeterministicModelProvider({
    identity: FIXTURE_COMMUNICATION_REVIEW_IDENTITY,
    async review({ turnIds, rubricCriterionIds }) {
      return {
        status: "available",
        score: 50,
        supportingTurnIds: [turnIds[0]!],
        rubricCriterionIds: [rubricCriterionIds[0]!],
      };
    },
  });
  let evaluationCalls = 0;
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    generatePatientReply: (input) => deterministic.generatePatientReply(input),
    async evaluate(input) {
      evaluationCalls += 1;
      const valid = await deterministic.evaluate(input);
      if (evaluationCalls === 1) {
        return {
          ...valid,
          communicationAssessment: {
            ...valid.communicationAssessment,
            supportingTurnIds: [],
          },
          evidence: valid.evidence.map((item, index) => ({
            ...item,
            ...(index === 0
              ? { supportingTurnIds: [input.turnIds[0]!] }
              : item.criterionId.startsWith("communication.score.")
                ? { supportingTurnIds: [] }
                : {}),
          })),
        } as typeof valid;
      }
      return {
        ...valid,
        scores: { ...valid.scores, communication: "50" },
      } as unknown as typeof valid;
    },
  };
  const service = createService({ provider });
  const created = await createSession(service, "create.invalid-evidence");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.invalid-evidence",
    text: "When did it start?",
  });

  for (const clientRequestId of [
    "diagnosis.missing-evidence",
    "diagnosis.string-communication",
  ]) {
    await assert.rejects(
      service.submitDiagnosis({
        sessionId: created.session.sessionId,
        clientRequestId,
        primaryDiagnosis: "Fixture Syndrome",
        differentials: ["Alternate Condition"],
      }),
      errorHasCode("MODEL_OUTPUT_REJECTED"),
    );
  }
});

test("the provider identity is required at service construction", () => {
  const persistence = new InMemoryModelPersistence();
  assert.throws(
    () =>
      new ModelService(
        new InMemoryCaseRepository([createCaseFixture()]),
        {} as ModelProvider,
        new MemoryEventSink(),
        undefined,
        { persistence },
      ),
    errorHasCode("INVALID_REQUEST"),
  );
});

test("provider identity getter failures close persistence", () => {
  const persistence = new TrackingPersistence();
  const provider = {
    get identity(): ModelProvider["identity"] {
      throw new Error("identity getter failed");
    },
  } as ModelProvider;

  assert.throws(
    () =>
      new ModelService(
        new InMemoryCaseRepository([createCaseFixture()]),
        provider,
        new MemoryEventSink(),
        undefined,
        { persistence },
      ),
    /identity getter failed/,
  );
  assert.equal(persistence.closeCount, 1);
});

test("nested provider identity getter failures close persistence", () => {
  const persistence = new TrackingPersistence();
  const provider = {
    identity: {
      get providerName(): string {
        throw new Error("nested identity getter failed");
      },
      modelId: "fixture-model",
      promptVersion: "fixture-prompt",
    },
  } as ModelProvider;

  assert.throws(
    () =>
      new ModelService(
        new InMemoryCaseRepository([createCaseFixture()]),
        provider,
        new MemoryEventSink(),
        undefined,
        { persistence },
      ),
    /nested identity getter failed/,
  );
  assert.equal(persistence.closeCount, 1);
});

test("communication reviewer configuration is part of provider identity", () => {
  const low = new DeterministicModelProvider(
    new LabeledFixtureCommunicationReviewProvider({
      score: 0,
      supportingTurnIndexes: [0],
      rubricCriterionIds: ["communication.respectful_clear"],
    }),
  );
  const high = new DeterministicModelProvider(
    new LabeledFixtureCommunicationReviewProvider({
      score: 100,
      supportingTurnIndexes: [0],
      rubricCriterionIds: [
        "communication.respectful_clear",
        "communication.summary_transition",
      ],
    }),
  );

  assert.notEqual(low.identity.promptVersion, high.identity.promptVersion);
  assert.match(low.identity.promptVersion, /\+reviewer\.[a-f0-9]{16}$/);
});

test("invalid communication reviewer output is a model-output rejection", async () => {
  const provider = new DeterministicModelProvider({
    identity: FIXTURE_COMMUNICATION_REVIEW_IDENTITY,
    async review() {
      return {
        status: "available",
        score: 100,
        supportingTurnIds: [],
        rubricCriterionIds: [],
      };
    },
  });
  const service = createService({ provider });
  const created = await createSession(service, "create.invalid-reviewer-output");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.invalid-reviewer-output",
    text: "When did it start?",
  });

  await assert.rejects(
    service.submitDiagnosis({
      sessionId: created.session.sessionId,
      clientRequestId: "diagnosis.invalid-reviewer-output",
      primaryDiagnosis: "Fixture Syndrome",
      differentials: ["Alternate Condition"],
    }),
    errorHasCode("MODEL_OUTPUT_REJECTED"),
  );
});

test("communication reviewer identity changes cannot be committed", async () => {
  const reviewerIdentity = {
    providerName: "reviewer-a",
    modelId: "reviewer-model-a",
    promptVersion: "reviewer-prompt-a",
  };
  const provider = new DeterministicModelProvider({
    identity: reviewerIdentity,
    async review({ turnIds, rubricCriterionIds }) {
      reviewerIdentity.promptVersion = "reviewer-prompt-b";
      return {
        status: "available",
        score: 100,
        supportingTurnIds: [turnIds[0]!],
        rubricCriterionIds: rubricCriterionIds.slice(0, 2),
      };
    },
  });
  const service = createService({ provider });
  const created = await createSession(service, "create.reviewer-identity-change");
  await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.reviewer-identity-change",
    text: "When did it start?",
  });

  await assert.rejects(
    service.submitDiagnosis({
      sessionId: created.session.sessionId,
      clientRequestId: "diagnosis.reviewer-identity-change",
      primaryDiagnosis: "Fixture Syndrome",
      differentials: ["Alternate Condition"],
    }),
    errorHasCode("OPERATION_RECOVERY_REQUIRED"),
  );
});

test("provider identity changes during a call cannot be committed", async () => {
  const identity = {
    providerName: "provider-a",
    modelId: "model-a",
    promptVersion: "prompt-a",
  };
  const deterministic = new DeterministicModelProvider();
  const provider: ModelProvider = {
    identity,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    async generatePatientReply(input) {
      identity.providerName = "provider-b";
      identity.modelId = "model-b";
      identity.promptVersion = "prompt-b";
      return deterministic.generatePatientReply(input);
    },
    evaluate: (input) => deterministic.evaluate(input),
  };
  const persistence = new InMemoryModelPersistence();
  const service = createService({ persistence, provider });
  const created = await createSession(service, "create.identity-toctou");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.identity-toctou",
      text: "When did it start?",
    }),
    errorHasCode("OPERATION_RECOVERY_REQUIRED"),
  );
  const operation = persistence.transaction((transaction) =>
    transaction.operations.listForSession(created.session.sessionId)[0],
  );
  assert.equal(operation?.status, "failed");
  assert.equal(operation?.providerName, "provider-a");
  assert.equal(service.getSession(created.session.sessionId).sessionPhase, "active");
});

test("stale provider responses cannot cross a dispatch fencing token", async () => {
  const persistence = new InMemoryModelPersistence();
  const deterministic = new DeterministicModelProvider();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatched = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const provider: ModelProvider = {
    identity: FIXTURE_PROVIDER_IDENTITY,
    classifyTurn: (input) => deterministic.classifyTurn(input),
    async generatePatientReply(input) {
      entered();
      await gate;
      return deterministic.generatePatientReply(input);
    },
    evaluate: (input) => deterministic.evaluate(input),
  };
  const service = createService({ persistence, provider });
  const created = await createSession(service, "create.fencing");
  const request = service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.fencing",
    text: "When did it start?",
  });
  await dispatched;
  persistence.transaction((transaction) => {
    const operation = transaction.operations.listForSession(
      created.session.sessionId,
    )[0]!;
    operation.status = "dispatched";
    operation.attemptCount = 2;
    operation.leaseToken = "new-recovery-fence";
    operation.leaseExpiresAt = new Date(START.getTime() + 60_000).toISOString();
    transaction.operations.save(operation);
  });
  release();

  await assert.rejects(request, errorHasCode("OPERATION_RECOVERY_REQUIRED"));
  const operation = persistence.transaction((transaction) =>
    transaction.operations.listForSession(created.session.sessionId)[0],
  );
  assert.equal(operation?.status, "dispatched");
  assert.equal(operation?.attemptCount, 2);
  assert.equal(operation?.leaseToken, "new-recovery-fence");
  assert.equal(
    service.getSession(created.session.sessionId).sessionPhase,
    "awaiting_model",
  );
});

test("ops fail cannot rewrite a committed operation or its idempotency result", async () => {
  const persistence = new InMemoryModelPersistence();
  const service = createService({ persistence });
  const created = await createSession(service, "create.committed-op");
  const original = await service.askPatient({
    sessionId: created.session.sessionId,
    clientTurnId: "turn.committed-op",
    text: "When did it start?",
  });
  const operation = persistence.transaction((transaction) =>
    transaction.operations.listForSession(created.session.sessionId)[0],
  );
  assert.ok(operation);

  await assert.rejects(
    service.recoverOperation({
      operationId: operation.operationId,
      action: "fail",
      operator: "ops.fixture",
      reason: "must not rewrite committed state",
    }),
    errorHasCode("OPERATION_RECOVERY_REQUIRED"),
  );
  assert.deepEqual(
    await service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.committed-op",
      text: "When did it start?",
    }),
    original,
  );
  assert.equal(service.inspectOperation(operation.operationId).status, "committed");
});

test("oversized request payloads are rejected before persistence", async () => {
  const persistence = new InMemoryModelPersistence();
  const service = createService({ persistence });
  const created = await createSession(service, "create.input-limits");

  await assert.rejects(
    service.askPatient({
      sessionId: created.session.sessionId,
      clientTurnId: "turn.oversized",
      text: "x".repeat(1_001),
    }),
    errorHasCode("INVALID_REQUEST"),
  );
  assert.deepEqual(
    persistence.transaction((transaction) =>
      transaction.operations.listForSession(created.session.sessionId),
    ),
    [],
  );
});
