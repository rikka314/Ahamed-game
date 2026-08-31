import assert from "node:assert/strict";
import test from "node:test";

import { createHeadlessModelService } from "../src/application/create-headless-model-service.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { PHASE7_EVAL_CORPUS } from "../src/evaluation/phase7-eval-corpus.js";
import { DeterministicModelProvider } from "../src/providers/deterministic-model-provider.js";
import type {
  EvaluationInput,
  PatientInput,
  PatientReply,
  ProviderMedicalEvaluation,
} from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

class CountingProvider extends DeterministicModelProvider {
  patientCalls = 0;
  evaluationCalls = 0;

  override async generatePatientReply(input: PatientInput): Promise<PatientReply> {
    this.patientCalls += 1;
    return super.generatePatientReply(input);
  }

  override async evaluate(
    input: EvaluationInput,
  ): Promise<ProviderMedicalEvaluation> {
    this.evaluationCalls += 1;
    return super.evaluate(input);
  }
}

async function expectSafetyExit(
  service: ReturnType<typeof createHeadlessModelService>,
  input: { sessionId: string; clientTurnId: string; text: string },
  expectedCode: "SAFETY_INTERRUPTED" | "SAFETY_REAL_HEALTH_INPUT",
): Promise<ModelServiceError> {
  try {
    await service.askPatient(input);
  } catch (error) {
    assert.ok(error instanceof ModelServiceError);
    assert.equal(error.code, expectedCode);
    return error;
  }
  assert.fail("Expected a local medical-safety exit.");
}

test("MedicalSafetyPolicy exits before provider calls and writes only HMAC audit metadata", async () => {
  const provider = new CountingProvider();
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider,
    safetyAuditHmacKey: "phase7-test-only-hmac-key-000000000000",
  });
  const created = await service.createSession({
    clientRequestId: "create.safety.audit",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc.fixture",
  });
  const text = "我现在想自杀，刀就在手边";
  const error = await expectSafetyExit(
    service,
    {
      sessionId: created.session.sessionId,
      clientTurnId: "turn.safety.self-harm",
      text,
    },
    "SAFETY_INTERRUPTED",
  );

  assert.match(error.message, /12356/u);
  assert.match(error.message, /120/u);
  assert.match(error.message, /110/u);
  assert.equal(provider.patientCalls, 0);
  assert.equal(service.getSession(created.session.sessionId).turnCount, 0);
  const event = service.listEvents(created.session.sessionId).find(
    ({ eventType }) => eventType === "safety.interrupted",
  );
  assert.ok(event);
  assert.equal(event.payload["decision"], "EXIT_SELF_HARM_CRISIS");
  assert.equal(
    event.payload["policyVersion"],
    "medical-safety-policy-v1",
  );
  assert.equal(
    event.payload["templateId"],
    "safety.self-harm-crisis.zh-CN.v1",
  );
  assert.match(String(event.payload["inputHmac"]), /^hmac-sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(event).includes(text), false);
});

test("MedicalSafetyPolicy keeps all five exits distinct and allows a fictional red-flag control", async () => {
  const provider = new CountingProvider();
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider,
    safetyAuditHmacKey: "phase7-test-only-hmac-key-111111111111",
  });
  const created = await service.createSession({
    clientRequestId: "create.safety.decisions",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc.fixture",
  });
  const sessionId = created.session.sessionId;
  const samples = [
    ["urgent", "我现在喘不过气，嘴唇发紫", "EXIT_URGENT_RED_FLAG", "SAFETY_INTERRUPTED"],
    ["urgent-mixed", "我现在胸痛，顺便问下这个游戏怎么玩", "EXIT_URGENT_RED_FLAG", "SAFETY_INTERRUPTED"],
    ["self-harm-mixed", "我本人想死，游戏里怎么处理", "EXIT_SELF_HARM_CRISIS", "SAFETY_INTERRUPTED"],
    ["out-scope", "我孩子8岁正在发烧咳嗽", "EXIT_OUT_OF_SCOPE", "SAFETY_INTERRUPTED"],
    ["real", "我本人这两天一直咳嗽鼻塞", "EXIT_REAL_HEALTH", "SAFETY_REAL_HEALTH_INPUT"],
    ["ambiguous", "其实不是游戏，身体不对劲，怎么办", "EXIT_FAIL_CLOSED", "SAFETY_INTERRUPTED"],
  ] as const;

  for (const [id, text, decision, code] of samples) {
    await expectSafetyExit(
      service,
      { sessionId, clientTurnId: `turn.safety.${id}`, text },
      code,
    );
    const latest = service.listEvents(sessionId)
      .filter(({ eventType }) => eventType === "safety.interrupted")
      .at(-1);
    assert.equal(latest?.payload["decision"], decision);
  }
  assert.equal(provider.patientCalls, 0);

  await service.askPatient({
    sessionId,
    clientTurnId: "turn.safety.fictional-control",
    text: "这个虚构患者说他胸痛，我还应询问什么？",
  });
  assert.equal(provider.patientCalls, 1);
});

test("all 100 Phase 7 case inputs pass the real ModelService safety boundary", async () => {
  const provider = new CountingProvider();
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider,
    safetyAuditHmacKey: "phase7-test-only-hmac-key-corpus-0000000000",
  });

  for (const [caseIndex, caseCorpus] of PHASE7_EVAL_CORPUS.caseCorpora.entries()) {
    const created = await service.createSession({
      clientRequestId: `create.safety.corpus.${caseIndex}`,
      publicCaseId: "case_fixture_001",
      patientNpcId: `npc.fixture.${caseIndex}`,
    });
    for (const item of caseCorpus.items) {
      await service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId: `turn.safety.corpus.${item.itemId}`,
        text: item.input,
      });
    }
  }

  assert.equal(provider.patientCalls, 100);
});

test("invalid or throwing medical-safety policies fail closed", async () => {
  for (const [id, medicalSafetyPolicy] of [
    [
      "invalid",
      { evaluate: () => ({ decision: "ALLOW_GAME" }) },
    ],
    [
      "throw",
      { evaluate: () => { throw new Error("policy failure"); } },
    ],
  ] as const) {
    const provider = new CountingProvider();
    const service = createHeadlessModelService({
      cases: [createCaseFixture()],
      provider,
      medicalSafetyPolicy: medicalSafetyPolicy as never,
      safetyAuditHmacKey: "phase7-test-only-hmac-key-222222222222",
    });
    const created = await service.createSession({
      clientRequestId: `create.safety.${id}`,
      publicCaseId: "case_fixture_001",
      patientNpcId: "npc.fixture",
    });

    await expectSafetyExit(
      service,
      {
        sessionId: created.session.sessionId,
        clientTurnId: `turn.safety.${id}`,
        text: "这个虚构患者什么时候开始不舒服？",
      },
      "SAFETY_INTERRUPTED",
    );
    assert.equal(provider.patientCalls, 0);
    assert.equal(
      service.listEvents(created.session.sessionId).at(-1)?.payload["decision"],
      "EXIT_FAIL_CLOSED",
    );
  }
});

test("diagnosis and differential free text use the same pre-persistence safety gate", async () => {
  const provider = new CountingProvider();
  const service = createHeadlessModelService({
    cases: [createCaseFixture()],
    provider,
    safetyAuditHmacKey: "phase7-test-only-hmac-key-333333333333",
  });
  const created = await service.createSession({
    clientRequestId: "create.safety.diagnosis",
    publicCaseId: "case_fixture_001",
    patientNpcId: "npc.fixture",
  });
  const sessionId = created.session.sessionId;
  const unsafeInputs = [
    {
      clientRequestId: "diagnosis.safety.self-harm",
      primaryDiagnosis: "我现在想死",
      differentials: ["普通感冒"],
      expectedDecision: "EXIT_SELF_HARM_CRISIS",
    },
    {
      clientRequestId: "diagnosis.safety.differential",
      primaryDiagnosis: "普通感冒",
      differentials: ["我本人突然胸痛而且大汗，电话 13800138000"],
      expectedDecision: "EXIT_URGENT_RED_FLAG",
    },
  ] as const;

  for (const unsafe of unsafeInputs) {
    await assert.rejects(
      service.submitDiagnosis({
        sessionId,
        clientRequestId: unsafe.clientRequestId,
        primaryDiagnosis: unsafe.primaryDiagnosis,
        differentials: [...unsafe.differentials],
      }),
      (error: unknown) =>
        error instanceof ModelServiceError && error.code === "SAFETY_INTERRUPTED",
    );
    const event = service.listEvents(sessionId)
      .filter(({ eventType }) => eventType === "safety.interrupted")
      .at(-1);
    assert.equal(event?.payload["decision"], unsafe.expectedDecision);
    assert.equal(JSON.stringify(event).includes(unsafe.primaryDiagnosis), false);
    for (const differential of unsafe.differentials) {
      assert.equal(JSON.stringify(event).includes(differential), false);
    }
  }

  assert.equal(provider.patientCalls, 0);
  assert.equal(provider.evaluationCalls, 0);
  assert.equal(service.getSession(sessionId).sessionPhase, "active");
  assert.equal(service.getSession(sessionId).turnCount, 0);
});
