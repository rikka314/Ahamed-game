import assert from "node:assert/strict";
import test from "node:test";

import {
  CasePackageValidationError,
  assertCasePackage,
} from "../src/domain/case-package.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

test("accepts a reviewed synthetic fixture with explicit three-state facts", () => {
  const fixture = createCaseFixture();

  assert.doesNotThrow(() => assertCasePackage(fixture));
});

test("rejects a public case id that contains the hidden diagnosis", () => {
  const fixture = createCaseFixture();
  fixture.publicCaseId = "case_fixture_syndrome";

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes("publicCaseId must not reveal the target diagnosis"),
  );
});

test("rejects rubric references to hidden patient facts", () => {
  const fixture = createCaseFixture();
  fixture.rubric.mustAskFactIds.push("fact.hidden_clue");

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        'rubric mustAsk fact "fact.hidden_clue" is not askable',
      ),
  );
});

test("reports missing top-level case sections together", () => {
  assert.throws(
    () => assertCasePackage({}),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("publicCaseId is required"));
      assert.ok(error.issues.includes("answerKey.targetDiagnosis is required"));
      assert.ok(error.issues.includes("patientFacts must be an object"));
      assert.ok(error.issues.includes("medicalTests must be an object"));
      assert.ok(error.issues.includes("rubric must be an object"));
      assert.ok(error.issues.includes("review.status must be fixture or approved"));
      return true;
    },
  );
});

test("rejects malformed rubric collections and turn limits", () => {
  const fixture = createCaseFixture();
  fixture.rubric.mustAskFactIds = "fact.onset" as unknown as string[];
  fixture.rubric.importantTestIds = "test.basic_panel" as unknown as string[];
  fixture.rubric.recommendedTurnLimit = 0;

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("rubric.mustAskFactIds must be an array"));
      assert.ok(
        error.issues.includes("rubric.importantTestIds must be an array"),
      );
      assert.ok(
        error.issues.includes(
          "rubric.recommendedTurnLimit must be a positive integer",
        ),
      );
      return true;
    },
  );
});

test("rejects rubric references to nonexistent tests", () => {
  const fixture = createCaseFixture();
  fixture.rubric.importantTestIds = ["test.missing"];

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes('rubric test "test.missing" does not exist'),
  );
});

test("rejects non-object case data", () => {
  assert.throws(
    () => assertCasePackage(null),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes("case package must be an object"),
  );
});

test("rejects malformed facts and deterministic test definitions", () => {
  const fixture = createCaseFixture();
  fixture.patientFacts["fact.onset"] = {
    status: "present",
    value: "invalid matcher collection",
    disclosure: "if_asked",
    questionMatchers: "when" as unknown as string[],
  };
  fixture.medicalTests["test.basic_panel"] = {
    status: "completed",
  };

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(
        error.issues.includes(
          'patient fact "fact.onset" questionMatchers must be a string array',
        ),
      );
      assert.ok(
        error.issues.includes(
          'completed medical test "test.basic_panel" requires a report',
        ),
      );
      return true;
    },
  );
});
