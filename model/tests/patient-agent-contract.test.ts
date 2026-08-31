import assert from "node:assert/strict";
import test from "node:test";

import { ModelServiceError } from "../src/domain/errors.js";
import { buildSafePatientCaseView } from "../src/domain/safe-patient-case-view.js";
import { DeterministicModelProvider } from "../src/providers/deterministic-model-provider.js";
import type {
  PatientAgentInput,
  PatientAgentOutput,
} from "../src/providers/model-provider.js";
import { validatePatientOutputV1 } from "../src/safety/patient-output-gate.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

function contractFixture(): {
  input: PatientAgentInput;
  casePackage: ReturnType<typeof createCaseFixture>;
} {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  return {
    casePackage,
    input: {
      userText: "Hello",
      patientProfile: safeCaseView.patientProfile,
      safeCaseView,
      recentTurns: [],
      disclosedFactIds: [],
      completedTests: [],
      consecutiveOffTopicTurns: 0,
    },
  };
}

function assertRejected(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_OUTPUT_REJECTED",
  );
}

test("single Patient Agent contract accepts fact-free social chat", () => {
  const { casePackage, input } = contractFixture();
  const output = validatePatientOutputV1(
    {
      reply: "Hello, doctor.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    },
    { casePackage, safeCaseView: input.safeCaseView },
  );

  assert.equal(output.interactionKind, "social_chat");
  assert.deepEqual(output.factIdsUsed, []);
});

test("Patient Agent contract accepts a definite primary diagnosis with explicit differentials", () => {
  const { casePackage, input } = contractFixture();
  const output = validatePatientOutputV1(
    {
      reply: "好的，医生。",
      interactionKind: "medical_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      diagnosisIntent: {
        decision: "submit_diagnosis",
        primaryDiagnosis: "普通感冒",
        differentialDiagnoses: ["流行性感冒", "急性咽炎"],
        candidateDiagnoses: [],
      },
      newFactsClaimed: [],
      diagnosisLeak: false,
    },
    {
      casePackage,
      safeCaseView: input.safeCaseView,
      userText: "我确定主诊断是普通感冒，流行性感冒和急性咽炎作为鉴别。",
    },
  );

  assert.deepEqual(output.diagnosisIntent, {
    decision: "submit_diagnosis",
    primaryDiagnosis: "普通感冒",
    differentialDiagnoses: ["流行性感冒", "急性咽炎"],
    candidateDiagnoses: [],
  });
});

test("Patient Agent contract accepts grounded multi-disease clarification without a primary", () => {
  const { casePackage, input } = contractFixture();
  const output = validatePatientOutputV1(
    {
      reply: "医生，您是在几个方向之间继续鉴别吗？",
      interactionKind: "medical_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      diagnosisIntent: {
        decision: "continue_dialogue",
        primaryDiagnosis: null,
        differentialDiagnoses: [],
        candidateDiagnoses: ["普通感冒", "流行性感冒", "急性咽炎"],
      },
      newFactsClaimed: [],
      diagnosisLeak: false,
    },
    {
      casePackage,
      safeCaseView: input.safeCaseView,
      userText: "这是普通感冒、流行性感冒、急性咽炎。",
    },
  );

  assert.deepEqual(output.diagnosisIntent, {
    decision: "continue_dialogue",
    primaryDiagnosis: null,
    differentialDiagnoses: [],
    candidateDiagnoses: ["普通感冒", "流行性感冒", "急性咽炎"],
  });
});

test("Patient Agent contract rejects an extracted diagnosis not grounded in the player's words", () => {
  const { casePackage, input } = contractFixture();

  assertRejected(() =>
    validatePatientOutputV1(
      {
        reply: "好的，医生。",
        interactionKind: "medical_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        diagnosisIntent: {
          decision: "submit_diagnosis",
          primaryDiagnosis: "普通感冒",
          differentialDiagnoses: [],
          candidateDiagnoses: [],
        },
        newFactsClaimed: [],
        diagnosisLeak: false,
      },
      {
        casePackage,
        safeCaseView: input.safeCaseView,
        userText: "我已经确定了，就按这个结论吧。",
      },
    ),
  );
});

test("Patient Agent contract rejects inconsistent diagnosis intent shapes", () => {
  const { casePackage, input } = contractFixture();
  const base = {
    reply: "好的，医生。",
    interactionKind: "medical_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  };
  const context = {
    casePackage,
    safeCaseView: input.safeCaseView,
    userText: "普通感冒。",
  };

  assertRejected(() =>
    validatePatientOutputV1(
      {
        ...base,
        diagnosisIntent: {
          decision: "submit_diagnosis",
          primaryDiagnosis: null,
          differentialDiagnoses: [],
          candidateDiagnoses: [],
        },
      },
      context,
    ),
  );
  assertRejected(() =>
    validatePatientOutputV1(
      {
        ...base,
        diagnosisIntent: {
          decision: "continue_dialogue",
          primaryDiagnosis: "普通感冒",
          differentialDiagnoses: [],
          candidateDiagnoses: [],
        },
      },
      context,
    ),
  );
});

test("Patient Agent gate rejects unknown fields and every unauthorized reference", () => {
  const { casePackage, input } = contractFixture();
  const base: PatientAgentOutput = {
    reply: "It started about two weeks ago.",
    interactionKind: "medical_chat",
    factIdsUsed: ["fact.onset"],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  };
  const context = { casePackage, safeCaseView: input.safeCaseView };

  assertRejected(() => validatePatientOutputV1({ ...base, secret: true }, context));
  assertRejected(() => validatePatientOutputV1({ ...base, factIdsUsed: ["fact.hidden_clue"] }, context));
  assertRejected(() => validatePatientOutputV1({ ...base, personaFactIdsUsed: ["persona.secret"] }, context));
  assertRejected(() => validatePatientOutputV1({ ...base, completedTestIdsUsed: ["test.basic_panel"] }, context));
  assertRejected(() => validatePatientOutputV1({ ...base, requestedTestId: "test.unknown", interactionKind: "test_order" }, context));
});

test("deterministic mock implements the same Patient Agent input and output contract", async () => {
  const { casePackage, input } = contractFixture();
  const provider = new DeterministicModelProvider();
  const output = await provider.generatePatientReply({
    operationId: "operation.fixture",
    ...input,
  });
  const validated = validatePatientOutputV1(output, {
    casePackage,
    safeCaseView: input.safeCaseView,
  });

  assert.equal(validated.interactionKind, "social_chat");
  assert.equal(validated.reply, "Hello, doctor.");
});
