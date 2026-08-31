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
