import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDeterministically } from "../src/evaluation/deterministic-evaluator.js";
import {
  validateEvaluationOutputV1,
} from "../src/safety/evaluation-output-gate.js";
import {
  validatePatientOutputV1,
} from "../src/safety/patient-output-gate.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { buildSafePatientCaseView } from "../src/domain/safe-patient-case-view.js";
import type {
  CommunicationAssessment,
} from "../src/evaluation/scoring-policy-v1.js";
import type { EvaluationInput } from "../src/providers/model-provider.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

function assertRejected(action: () => unknown, message: RegExp): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_OUTPUT_REJECTED" &&
      message.test(error.message),
  );
}

test("patient output gate accepts only allowlisted grounded facts", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const output = validatePatientOutputV1(
    {
      reply: "It started about two weeks ago.",
      interactionKind: "medical_chat",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    },
    { casePackage, safeCaseView },
  );

  assert.deepEqual(output.factIdsUsed, ["fact.onset"]);

  assert.doesNotThrow(() => validatePatientOutputV1(
    {
      reply: "I enjoy fixture puzzles.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: ["persona.interest.1"],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    },
    { casePackage, safeCaseView },
  ));
});

test("patient output gate permits fact-free social replies", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "Hello, doctor.",
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView }));
});

test("patient output gate requires a previously disclosed fact for an explicit context follow-up", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const context = {
    casePackage,
    safeCaseView,
    userText: "现在还这样么",
    previouslyDisclosedFactIds: ["fact.onset"],
  };
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I am not sure about that.",
      interactionKind: "medical_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /context follow-up/iu,
  );
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "It started about two weeks ago.",
    interactionKind: "medical_chat",
    factIdsUsed: ["fact.onset"],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, context));
});

test("patient output gate rejects a generic acknowledgement for a direct persona question", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  assertRejected(
    () => validatePatientOutputV1({
      reply: "Okay.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, {
      casePackage,
      safeCaseView,
      userText: "Are you busy lately?",
    }),
    /persona question/iu,
  );
});

test("patient output gate rejects ungrounded medical claims and uncited social background", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const context = { casePackage, safeCaseView };

  assertRejected(
    () => validatePatientOutputV1({
      reply: "I suddenly have severe chest pain.",
      interactionKind: "medical_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I enjoy skiing every weekend.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I enjoy nice weather.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I suddenly have severe chest pain.",
      interactionKind: "medical_chat",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "It started about two weeks ago, and I have severe chest pain.",
      interactionKind: "medical_chat",
      factIdsUsed: ["fact.onset"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  const completedSafeCaseView = buildSafePatientCaseView(casePackage, [{
    testId: "test.basic_panel",
    status: "completed",
    report: "A stable, fixture-only result.",
  }]);
  assertRejected(
    () => validatePatientOutputV1({
      reply: "Basic panel shows severe chest pain.",
      interactionKind: "test_query",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: ["test.basic_panel"],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, { casePackage, safeCaseView: completedSafeCaseView }),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I have severe chest pain.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I have symptoms.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  for (const reply of ["I have no symptoms.", "我现在没有不舒服。"]) {
    assertRejected(
      () => validatePatientOutputV1({
        reply,
        interactionKind: "medical_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      }, context),
      /grounding/iu,
    );
  }
  assertRejected(
    () => validatePatientOutputV1({
      reply: "Basic panel shows severe chest pain.",
      interactionKind: "test_query",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      suggestedTestId: "test.basic_panel",
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({
      reply: "I am a teacher and live in Shanghai.",
      interactionKind: "social_chat",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, context),
    /grounding/iu,
  );
});

test("patient output gate rejects extra fields, hidden facts, diagnosis leaks, and forged tests", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const context = {
    casePackage,
    safeCaseView,
  };
  const base = {
    reply: "It started about two weeks ago.",
    interactionKind: "medical_chat",
    factIdsUsed: ["fact.onset"],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  };

  assertRejected(
    () => validatePatientOutputV1({ ...base, internalReasoning: "secret" }, context),
    /schema/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({ ...base, factIdsUsed: ["fact.hidden_clue"] }, context),
    /safe case view/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({ ...base, reply: "This is Fixture Syndrome." }, context),
    /diagnosis leak/iu,
  );
  assertRejected(
    () => validatePatientOutputV1({ ...base, reply: "A stable, fixture-only result." }, context),
    /uncompleted test-result leak/iu,
  );
  const completedSafeCaseView = buildSafePatientCaseView(casePackage, [{
    testId: "test.basic_panel",
    status: "completed",
    report: "A stable, fixture-only result.",
  }]);
  assertRejected(
    () => validatePatientOutputV1({
      ...base,
      interactionKind: "test_query",
      suggestedTestId: "test.basic_panel",
    }, { casePackage, safeCaseView: completedSafeCaseView }),
    /test action gate/iu,
  );
});

function evaluationFixture(): {
  input: EvaluationInput;
  communication: CommunicationAssessment;
  providerOutput: Record<string, unknown>;
} {
  const casePackage = createCaseFixture();
  const input: EvaluationInput = {
    casePackage,
    primaryDiagnosis: casePackage.answerKey.targetDiagnosis,
    differentials: ["Example Differential", "Alternate Differential"],
    disclosedFactIds: ["fact.onset", "fact.rash"],
    completedTestIds: ["test.basic_panel"],
    turnIds: ["turn.1"],
    turns: [{ turnId: "turn.1", text: "When?", reply: "Two weeks." }],
    completedTests: [
      {
        testId: "test.basic_panel",
        status: "completed",
        report: "A stable, fixture-only result.",
      },
    ],
    medicalTurnCount: 1,
    repeatTurnCount: 0,
    otherTurnCount: 0,
  };
  const communication: CommunicationAssessment = {
    status: "available",
    score: 100,
    supportingTurnIds: ["turn.1"],
    rubricCriterionIds: [
      "communication.respectful_clear",
      "communication.summary_transition",
    ],
  };
  const deterministic = evaluateDeterministically(input, communication);
  return {
    input,
    communication,
    providerOutput: {
      ...deterministic,
      summary: "Provider-authored text is treated as untrusted.",
      communicationAssessment: communication,
    },
  };
}

test("evaluation output gate recomputes the frozen score and discards provider prose", () => {
  const fixture = evaluationFixture();
  const result = validateEvaluationOutputV1(
    fixture.providerOutput,
    fixture.input,
    fixture.input.casePackage.evaluationVersion,
  );

  assert.equal(result.evaluation.scores.total, 100);
  assert.notEqual(result.evaluation.summary, fixture.providerOutput["summary"]);
  assert.deepEqual(result.communicationAssessment, fixture.communication);
});

test("evaluation output gate rejects forged totals, evidence IDs, and non-allowlisted fields", () => {
  const fixture = evaluationFixture();
  const scores = structuredClone(
    fixture.providerOutput["scores"] as Record<string, unknown>,
  );
  scores["total"] = 99;
  assertRejected(
    () => validateEvaluationOutputV1(
      { ...fixture.providerOutput, scores },
      fixture.input,
      fixture.input.casePackage.evaluationVersion,
    ),
    /frozen scoring policy/iu,
  );

  const evidence = structuredClone(
    fixture.providerOutput["evidence"] as Array<Record<string, unknown>>,
  );
  evidence[0] = {
    ...evidence[0],
    supportingTurnIds: ["turn.unknown"],
  };
  assertRejected(
    () => validateEvaluationOutputV1(
      { ...fixture.providerOutput, evidence },
      fixture.input,
      fixture.input.casePackage.evaluationVersion,
    ),
    /validation/iu,
  );

  assertRejected(
    () => validateEvaluationOutputV1(
      { ...fixture.providerOutput, answerKey: "secret" },
      fixture.input,
      fixture.input.casePackage.evaluationVersion,
    ),
    /validation/iu,
  );
});

test("evaluation output gate requires two positive criteria for communication 100", () => {
  const fixture = evaluationFixture();
  const oneCriterion = {
    status: "available",
    score: 100,
    supportingTurnIds: ["turn.1"],
    rubricCriterionIds: ["communication.respectful_clear"],
  };
  assertRejected(
    () => validateEvaluationOutputV1(
      {
        ...fixture.providerOutput,
        communicationAssessment: oneCriterion,
      },
      fixture.input,
      fixture.input.casePackage.evaluationVersion,
    ),
    /validation/iu,
  );

  const fifty = { ...oneCriterion, score: 50 };
  const deterministic = evaluateDeterministically(
    fixture.input,
    fifty as CommunicationAssessment,
  );
  assert.doesNotThrow(() =>
    validateEvaluationOutputV1(
      {
        ...deterministic,
        summary: "Provider-authored text is treated as untrusted.",
        communicationAssessment: fifty,
      },
      fixture.input,
      fixture.input.casePackage.evaluationVersion,
    ),
  );
});

test("evaluation output gate preserves the unavailable communication state without inventing a total", () => {
  const fixture = evaluationFixture();
  const communication: CommunicationAssessment = {
    status: "unavailable",
    failureCode: "MODEL_TIMEOUT",
  };
  const deterministic = evaluateDeterministically(fixture.input, communication);
  const result = validateEvaluationOutputV1(
    {
      ...deterministic,
      communicationAssessment: communication,
    },
    fixture.input,
    fixture.input.casePackage.evaluationVersion,
  );

  assert.equal(result.evaluation.scores.communication, null);
  assert.equal(result.evaluation.scores.total, null);
});
