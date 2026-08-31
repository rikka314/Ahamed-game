import assert from "node:assert/strict";
import test from "node:test";

import { SCORING_CONTRACT_V1 } from "@ahamed/doctor-game-share";

import type { CasePackage } from "../src/domain/case-package.js";
import {
  ScoringPolicyInputError,
  scoreWithPolicyV1,
  type CommunicationAssessment,
  type ScoringComponents,
} from "../src/evaluation/scoring-policy-v1.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

interface GoldenVector {
  id: string;
  primaryDiagnosis: string;
  differentials: string[];
  disclosedFactIds: string[];
  completedTestIds: string[];
  medicalTurnCount: number;
  repeatTurnCount: number;
  otherTurnCount: number;
  communication: CommunicationAssessment;
  expected: ScoringComponents;
  total: number | null;
}

function caseForGroup(group: number): CasePackage {
  const fixture = createCaseFixture();
  fixture.internalCaseId = `internal_scoring_group_${group}`;
  fixture.publicCaseId = `case_scoring_group_${group}`;
  fixture.answerKey.targetConceptId = `concept.target_${group}`;
  fixture.answerKey.targetDiagnosis = `Target ${group}`;
  fixture.answerKey.acceptedSynonyms = [`Target synonym ${group}`];
  fixture.answerKey.diagnosisConcepts = [
    { conceptId: `concept.target_${group}`, preferredTerm: `Target ${group}`, acceptedSynonyms: [`Target synonym ${group}`] },
    { conceptId: `concept.diff_a_${group}`, preferredTerm: `Differential A ${group}`, acceptedSynonyms: [`Diff A synonym ${group}`] },
    { conceptId: `concept.diff_b_${group}`, preferredTerm: `Differential B ${group}`, acceptedSynonyms: [`Diff B synonym ${group}`] },
    { conceptId: `concept.wrong_${group}`, preferredTerm: `Wrong ${group}`, acceptedSynonyms: [] },
  ];
  fixture.rubric.acceptableDifferentialConceptIds = [`concept.diff_a_${group}`, `concept.diff_b_${group}`];
  fixture.medicalTests["test.useful"] = { status: "completed", report: "Useful result." };
  fixture.medicalTests["test.unnecessary"] = { status: "completed", report: "Unnecessary result." };
  fixture.rubric.testClassifications["test.useful"] = "useful";
  fixture.rubric.testClassifications["test.unnecessary"] = "unnecessary";
  return fixture;
}

function available(score: 0 | 50 | 100): CommunicationAssessment {
  return {
    status: "available",
    score,
    supportingTurnIds: ["turn-1"],
    rubricCriterionIds: score === 100
      ? ["communication.respectful_clear", "communication.summary_transition"]
      : ["communication.respectful_clear"],
  };
}

function vectorsForGroup(group: number): GoldenVector[] {
  const target = `Target ${group}`;
  const synonyms = `Target synonym ${group}`;
  const differentials = [`Differential A ${group}`, `Diff B synonym ${group}`];
  const common = {
    disclosedFactIds: ["fact.onset", "fact.rash"],
    completedTestIds: ["test.basic_panel", "test.useful"],
    medicalTurnCount: 4,
    repeatTurnCount: 0,
    otherTurnCount: 0,
    communication: available(100),
  };
  const vectors: GoldenVector[] = [
    {
      id: `g${group}-full-score-synonym-dedup`,
      ...common,
      primaryDiagnosis: synonyms,
      differentials: [differentials[0]!, differentials[0]!, differentials[1]!, synonyms],
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 100, efficiency: 100, communication: 100 },
      total: 100,
    },
    {
      id: `g${group}-wrong-diagnosis`,
      ...common,
      primaryDiagnosis: `Wrong ${group}`,
      differentials,
      expected: { diagnosis: 0, historyCoverage: 100, differentialReasoning: 100, testSelection: 100, efficiency: 100, communication: 100 },
      total: 55,
    },
    {
      id: `g${group}-half-history-final-rounding`,
      ...common,
      primaryDiagnosis: target,
      differentials,
      disclosedFactIds: ["fact.onset"],
      expected: { diagnosis: 100, historyCoverage: 50, differentialReasoning: 100, testSelection: 100, efficiency: 100, communication: 100 },
      total: 88,
    },
    {
      id: `g${group}-partial-differential`,
      ...common,
      primaryDiagnosis: target,
      differentials: [differentials[0]!],
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 50, testSelection: 100, efficiency: 100, communication: 100 },
      total: 95,
    },
    {
      id: `g${group}-communication-unavailable-no-total`,
      ...common,
      primaryDiagnosis: target,
      differentials,
      communication: { status: "unavailable", failureCode: "REVIEW_TIMEOUT" },
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 100, efficiency: 100, communication: null },
      total: null,
    },
  ];

  const special: Record<number, GoldenVector> = {
    1: {
      id: "g1-zero-differentials",
      ...common,
      primaryDiagnosis: target,
      differentials: [],
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 0, testSelection: 100, efficiency: 100, communication: 100 },
      total: 90,
    },
    2: {
      id: "g2-missed-required-test",
      ...common,
      primaryDiagnosis: target,
      differentials,
      completedTestIds: ["test.useful"],
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 0, efficiency: 100, communication: 100 },
      total: 90,
    },
    3: {
      id: "g3-unnecessary-test-final-rounding",
      ...common,
      primaryDiagnosis: target,
      differentials,
      completedTestIds: ["test.basic_panel", "test.unnecessary"],
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 80, efficiency: 100, communication: 100 },
      total: 98,
    },
    4: {
      id: "g4-excess-repeat-other-and-communication-50",
      ...common,
      primaryDiagnosis: target,
      differentials,
      medicalTurnCount: 7,
      repeatTurnCount: 1,
      otherTurnCount: 2,
      communication: available(50),
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 100, efficiency: 50, communication: 50 },
      total: 95,
    },
    5: {
      id: "g5-communication-0",
      ...common,
      primaryDiagnosis: target,
      differentials,
      communication: available(0),
      expected: { diagnosis: 100, historyCoverage: 100, differentialReasoning: 100, testSelection: 100, efficiency: 100, communication: 0 },
      total: 95,
    },
  };
  vectors.push(special[group]!);
  return vectors;
}

function expectedEvidenceIds(vector: GoldenVector, group: number): string[] {
  const disclosed = new Set(vector.disclosedFactIds);
  const completed = new Set(vector.completedTestIds);
  const primaryCorrect = vector.expected.diagnosis === 100;
  const differentialTerms = new Set(vector.differentials.map((term) => term.toLocaleLowerCase("en-US")));
  const diffAMet = [...differentialTerms].some((term) => term.includes("differential a"));
  const diffBMet = [...differentialTerms].some((term) => term.includes("diff b synonym"));
  const excess = Math.max(0, vector.medicalTurnCount - 4);
  return [
    `diagnosis.target.${primaryCorrect ? "met" : "missed"}`,
    `history.fact.onset.${disclosed.has("fact.onset") ? "met" : "missed"}`,
    `history.fact.rash.${disclosed.has("fact.rash") ? "met" : "missed"}`,
    `differential.concept.diff_a_${group}.${diffAMet ? "met" : "missed"}`,
    `differential.concept.diff_b_${group}.${diffBMet ? "met" : "missed"}`,
    `test.required.test.basic_panel.${completed.has("test.basic_panel") ? "met" : "missed"}`,
    ...(completed.has("test.unnecessary") ? ["test.unnecessary.test.unnecessary.penalty"] : []),
    `efficiency.excess.${excess}`,
    `efficiency.repeat.${vector.repeatTurnCount}`,
    `efficiency.other.${vector.otherTurnCount}`,
    vector.communication.status === "available"
      ? `communication.score.${vector.communication.score}`
      : `communication.unavailable.${vector.communication.failureCode}`,
  ];
}

const groups = [1, 2, 3, 4, 5].map((group) => ({ group, casePackage: caseForGroup(group), vectors: vectorsForGroup(group) }));

test("ScoringPolicy v1 freezes exactly 30 golden vectors with six vectors per logical case group", () => {
  assert.equal(groups.length, 5);
  assert.equal(groups.flatMap(({ vectors }) => vectors).length, 30);

  for (const { group, casePackage, vectors } of groups) {
    assert.equal(vectors.length, 6);
    for (const vector of vectors) {
      const result = scoreWithPolicyV1({
        casePackage,
        primaryDiagnosis: vector.primaryDiagnosis,
        differentials: vector.differentials,
        disclosedFactIds: vector.disclosedFactIds,
        completedTestIds: vector.completedTestIds,
        medicalTurnCount: vector.medicalTurnCount,
        repeatTurnCount: vector.repeatTurnCount,
        otherTurnCount: vector.otherTurnCount,
        sessionTurnIds: ["turn-1"],
        communication: vector.communication,
      });
      assert.deepEqual(result.components, vector.expected, vector.id);
      assert.equal(result.total, vector.total, vector.id);
      assert.deepEqual(result.evidence.map(({ evidenceId }) => evidenceId), expectedEvidenceIds(vector, group), vector.id);
      const communicationEvidence = result.evidence.at(-1);
      assert.ok(communicationEvidence, vector.id);
      if (vector.communication.status === "available") {
        assert.equal(
          communicationEvidence.outcome,
          vector.communication.score === 100
            ? "met"
            : vector.communication.score === 50
              ? "partial"
              : "missed",
          vector.id,
        );
        assert.deepEqual(
          communicationEvidence.supportingTurnIds,
          vector.communication.supportingTurnIds,
          vector.id,
        );
        assert.deepEqual(
          communicationEvidence.rubricCriterionIds,
          vector.communication.rubricCriterionIds,
          vector.id,
        );
      } else {
        assert.equal(communicationEvidence.outcome, "unavailable", vector.id);
        assert.equal(communicationEvidence.supportingTurnIds, undefined, vector.id);
        assert.equal(communicationEvidence.rubricCriterionIds, undefined, vector.id);
      }
      assert.equal(
        result.evaluationVersion,
        SCORING_CONTRACT_V1.evaluationVersion,
        vector.id,
      );
    }
  }
});

test("communication evidence rejects missing and unknown session or rubric IDs", () => {
  const casePackage = caseForGroup(1);
  const base = {
    casePackage,
    primaryDiagnosis: "Target 1",
    differentials: [],
    disclosedFactIds: [],
    completedTestIds: [],
    medicalTurnCount: 0,
    repeatTurnCount: 0,
    otherTurnCount: 0,
    sessionTurnIds: ["turn-1"],
  };

  assert.throws(
    () => scoreWithPolicyV1({ ...base, communication: { status: "available", score: 50, supportingTurnIds: [], rubricCriterionIds: [] } }),
    ScoringPolicyInputError,
  );
  assert.throws(
    () => scoreWithPolicyV1({ ...base, communication: { status: "available", score: 100, supportingTurnIds: ["turn-unknown"], rubricCriterionIds: ["communication.respectful_clear"] } }),
    ScoringPolicyInputError,
  );
  assert.throws(
    () => scoreWithPolicyV1({ ...base, communication: { status: "available", score: 100, supportingTurnIds: ["turn-1"], rubricCriterionIds: ["communication.respectful_clear"] } }),
    /at least two distinct rubric criteria/u,
  );
  assert.doesNotThrow(() =>
    scoreWithPolicyV1({ ...base, communication: { status: "available", score: 50, supportingTurnIds: ["turn-1"], rubricCriterionIds: ["communication.respectful_clear"] } }),
  );
});

test("ScoringPolicy v1 rejects unknown or duplicate fact, test, and turn evidence", () => {
  const casePackage = caseForGroup(1);
  const base = {
    casePackage,
    primaryDiagnosis: "Target 1",
    differentials: [],
    disclosedFactIds: [] as string[],
    completedTestIds: [] as string[],
    medicalTurnCount: 0,
    repeatTurnCount: 0,
    otherTurnCount: 0,
    sessionTurnIds: ["turn-1"],
    communication: {
      status: "available" as const,
      score: 50 as const,
      supportingTurnIds: ["turn-1"],
      rubricCriterionIds: ["communication.respectful_clear"],
    },
  };

  assert.throws(
    () => scoreWithPolicyV1({ ...base, disclosedFactIds: ["fact.unknown"] }),
    ScoringPolicyInputError,
  );
  assert.throws(
    () => scoreWithPolicyV1({ ...base, completedTestIds: ["test.unknown"] }),
    ScoringPolicyInputError,
  );
  assert.throws(
    () => scoreWithPolicyV1({ ...base, sessionTurnIds: ["turn-1", "turn-1"] }),
    ScoringPolicyInputError,
  );
});

test("ScoringPolicy v1 fails closed for an invalid runtime rubric", () => {
  const casePackage = structuredClone(caseForGroup(1));
  casePackage.rubric.mustAskFactIds = [];

  assert.throws(
    () => scoreWithPolicyV1({
      casePackage,
      primaryDiagnosis: "Target 1",
      differentials: [],
      disclosedFactIds: [],
      completedTestIds: [],
      medicalTurnCount: 0,
      repeatTurnCount: 0,
      otherTurnCount: 0,
      sessionTurnIds: ["turn-1"],
      communication: {
        status: "available",
        score: 50,
        supportingTurnIds: ["turn-1"],
        rubricCriterionIds: ["communication.respectful_clear"],
      },
    }),
    ScoringPolicyInputError,
  );
});
