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

test("patient output gate permits natural fact-free social replies without a fixed phrase allowlist", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "Hello again, doctor. I was listening — what would you like to ask me?",
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView }));
});

test("patient output gate leaves contextual language understanding to the Patient Agent", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const context = {
    casePackage,
    safeCaseView,
    userText: "现在还这样么",
    previouslyDisclosedFactIds: ["fact.onset"],
  };
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "Yes, it is still bothering me about the same as before.",
    interactionKind: "medical_chat",
    factIdsUsed: ["fact.onset"],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, context));
});

test("patient output gate accepts AI-authored non-medical identity details", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "My full name is Taylor Chen, and I live near the east gate of campus.",
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, {
    casePackage,
    safeCaseView,
    userText: "What is your name again?",
  }));
});

test("patient output gate rejects out-of-character missing-case-data language", () => {
  const casePackage = createCaseFixture();
  const safeCaseView = buildSafePatientCaseView(casePackage);
  const context = { casePackage, safeCaseView };
  for (const reply of [
    "病例里没有特别说明我父母叫什么。",
    "这方面没有特别说明。",
    "The case does not specify where I live.",
  ]) {
    assertRejected(
      () => validatePatientOutputV1({
        reply,
        interactionKind: "social_chat",
        factIdsUsed: [],
        personaFactIdsUsed: [],
        completedTestIdsUsed: [],
        newFactsClaimed: [],
        diagnosisLeak: false,
      }, context),
      /meta language/iu,
    );
  }
});

test("patient output gate rejects unreferenced medical answers but lets the Patient Agent phrase social chat naturally", () => {
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
  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: "I would rather stay focused on why I came in today, doctor.",
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, context));
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
  const completedContext = {
    casePackage,
    safeCaseView: completedSafeCaseView,
    completedTests: [{
      testId: "test.basic_panel",
      status: "completed" as const,
      report: "A stable, fixture-only result.",
    }],
  };
  assertRejected(
    () => validatePatientOutputV1({
      ...base,
      interactionKind: "test_query",
      suggestedTestId: "test.basic_panel",
    }, completedContext),
    /test action gate/iu,
  );
});

test("patient output gate permits diagnosis-like text already disclosed by a bound completed report", () => {
  const casePackage = createCaseFixture();
  const completedReport = "Fixture Syndrome marker is positive.";
  casePackage.medicalTests["test.basic_panel"]!.report = completedReport;
  const completedTests = [{
    testId: "test.basic_panel",
    status: "completed" as const,
    report: completedReport,
  }];
  const safeCaseView = buildSafePatientCaseView(casePackage, completedTests);

  assert.doesNotThrow(() => validatePatientOutputV1({
    reply: completedReport,
    interactionKind: "test_query",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: ["test.basic_panel"],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView, completedTests }));
});

test("patient output gate rejects a diagnosis conclusion that reverses the bound completed report", () => {
  const casePackage = createCaseFixture();
  const completedReport = "Fixture Syndrome was NOT detected.";
  casePackage.medicalTests["test.basic_panel"]!.report = completedReport;
  const completedTests = [{
    testId: "test.basic_panel",
    status: "completed" as const,
    report: completedReport,
  }];
  const safeCaseView = buildSafePatientCaseView(casePackage, completedTests);

  assertRejected(() => validatePatientOutputV1({
    reply: "The test confirms Fixture Syndrome.",
    interactionKind: "test_query",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: ["test.basic_panel"],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView, completedTests }), /diagnosis leak/iu);
});

test("patient output gate rejects a bound report followed by a contradictory diagnosis conclusion", () => {
  const casePackage = createCaseFixture();
  const completedReport = "Fixture Syndrome was NOT detected.";
  casePackage.medicalTests["test.basic_panel"]!.report = completedReport;
  const completedTests = [{
    testId: "test.basic_panel",
    status: "completed" as const,
    report: completedReport,
  }];
  const safeCaseView = buildSafePatientCaseView(casePackage, completedTests);

  assertRejected(() => validatePatientOutputV1({
    reply: `${completedReport} However, the test confirms Fixture Syndrome.`,
    interactionKind: "test_query",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: ["test.basic_panel"],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView, completedTests }), /diagnosis leak/iu);
});

test("patient output gate rejects symbol-decorated diagnosis reports", () => {
  const casePackage = createCaseFixture();
  const completedReport = "Fixture Syndrome marker is positive.";
  casePackage.medicalTests["test.basic_panel"]!.report = completedReport;
  const completedTests = [{
    testId: "test.basic_panel",
    status: "completed" as const,
    report: completedReport,
  }];
  const safeCaseView = buildSafePatientCaseView(casePackage, completedTests);

  for (const reply of [
    `❌ ${completedReport}`,
    `¬${completedReport}`,
    `${completedReport}?`,
  ]) {
    assertRejected(() => validatePatientOutputV1({
      reply,
      interactionKind: "test_query",
      factIdsUsed: [],
      personaFactIdsUsed: [],
      completedTestIdsUsed: ["test.basic_panel"],
      newFactsClaimed: [],
      diagnosisLeak: false,
    }, { casePackage, safeCaseView, completedTests }), /diagnosis leak/iu);
  }
});

test("patient output gate rejects a forged completed-test safe view", () => {
  const casePackage = createCaseFixture();
  const forgedSafeCaseView = structuredClone(
    buildSafePatientCaseView(casePackage),
  );
  const forgedTest = forgedSafeCaseView.tests.find(
    ({ testId }) => testId === "test.basic_panel",
  )!;
  forgedTest.status = "completed";
  forgedTest.report = "Fixture Syndrome marker is positive.";

  assertRejected(() => validatePatientOutputV1({
    reply: "Fixture Syndrome marker is positive.",
    interactionKind: "test_query",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: ["test.basic_panel"],
    newFactsClaimed: [],
    diagnosisLeak: false,
  }, { casePackage, safeCaseView: forgedSafeCaseView }), /safe case view/iu);
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
