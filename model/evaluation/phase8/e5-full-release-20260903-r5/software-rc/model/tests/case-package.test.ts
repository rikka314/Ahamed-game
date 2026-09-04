import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CasePackageValidationError,
  assertCasePackage,
  type CasePackage,
} from "../src/domain/case-package.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

test("accepts a reviewed synthetic fixture with explicit three-state facts", () => {
  const fixture = createCaseFixture();

  assert.doesNotThrow(() => assertCasePackage(fixture));
});

test("rejects a case version that can escape publication paths", () => {
  const fixture = createCaseFixture();
  fixture.caseVersion = "../../../escaped-version";
  fixture.redFlagExclusionMatrix.caseVersion = fixture.caseVersion;

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        "caseVersion must use a safe semantic version format",
      ),
  );
});

test("rejects a public case id that contains the hidden diagnosis", () => {
  const fixture = createCaseFixture();
  fixture.publicCaseId = "case_fixture_syndrome";

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        "publicCaseId must not reveal the target diagnosis or an accepted synonym",
      ),
  );
});

test("rejects a public case id that contains an accepted diagnosis synonym", () => {
  const fixture = createCaseFixture();
  fixture.answerKey.acceptedSynonyms = ["Secret Alias"];
  fixture.answerKey.diagnosisConcepts[0]!.acceptedSynonyms = ["Secret Alias"];
  fixture.publicCaseId = "case_secretalias_001";

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        "publicCaseId must not reveal the target diagnosis or an accepted synonym",
      ),
  );
});

test("rejects askable patient facts that reveal a diagnosis term", () => {
  const fixture = createCaseFixture();
  fixture.patientFacts["fact.onset"]!.value =
    "The Fixture Syndrome started two weeks ago.";

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.some((issue) => /must not reveal a diagnosis term/u.test(issue)),
  );
});

test("rejects client-visible case text that reveals a diagnosis term", () => {
  const fixture = createCaseFixture();
  fixture.playerVisible.chiefComplaint =
    `I think this is ${fixture.answerKey.targetDiagnosis}.`;

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        "playerVisible.chiefComplaint must not reveal a diagnosis term",
      ),
  );
});

test("rejects diagnosis terms in public case and fact identifiers", () => {
  const caseVersionLeak = createCaseFixture();
  caseVersionLeak.caseVersion = "fixture-syndrome-v1";
  assert.throws(
    () => assertCasePackage(caseVersionLeak),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes("caseVersion must not reveal a diagnosis term"),
  );

  const factIdLeak = createCaseFixture();
  factIdLeak.patientFacts["fact.fixture_syndrome"] =
    factIdLeak.patientFacts["fact.onset"]!;
  delete factIdLeak.patientFacts["fact.onset"];
  assert.throws(
    () => assertCasePackage(factIdLeak),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        'patient fact "fact.fixture_syndrome" ID must not reveal a diagnosis term',
      ),
  );
});

test("rejects a client-visible medical report that reveals a diagnosis term", () => {
  const fixture = createCaseFixture();
  fixture.medicalTests["test.basic_panel"]!.report =
    `Diagnostic result: ${fixture.answerKey.targetDiagnosis}.`;

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes(
        'medical test "test.basic_panel" report must not reveal a diagnosis term',
      ),
  );
});

test("rejects diagnosis terms in public medical-test identifiers", () => {
  const cases: Array<{
    mutate(fixture: CasePackage): void;
    issue: string;
  }> = [
    {
      mutate(fixture) {
        fixture.medicalTests["test.fixture_syndrome"] =
          fixture.medicalTests["test.basic_panel"]!;
        delete fixture.medicalTests["test.basic_panel"];
      },
      issue:
        'medical test "test.fixture_syndrome" testId must not reveal a diagnosis term',
    },
    {
      mutate(fixture) {
        fixture.medicalTests["test.basic_panel"]!.assetId =
          "asset_fixture_syndrome";
      },
      issue:
        'medical test "test.basic_panel" assetId must not reveal a diagnosis term',
    },
    {
      mutate(fixture) {
        fixture.medicalTests["test.basic_panel"]!.reasonCode =
          "reason_fixture_syndrome";
      },
      issue:
        'medical test "test.basic_panel" reasonCode must not reveal a diagnosis term',
    },
  ];

  for (const scenario of cases) {
    const fixture = createCaseFixture();
    scenario.mutate(fixture);
    assert.throws(
      () => assertCasePackage(fixture),
      (error: unknown) =>
        error instanceof CasePackageValidationError &&
        error.issues.includes(scenario.issue),
    );
  }
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
      assert.ok(error.issues.includes("patientFacts must be a non-empty object"));
      assert.ok(error.issues.includes("medicalTests must be a non-empty object"));
      assert.ok(error.issues.includes("rubric must be an object"));
      assert.ok(error.issues.includes("review.status is invalid"));
      assert.ok(error.issues.includes("redFlagExclusionMatrix is required"));
      return true;
    },
  );
});

test("accepts the positive private JSON fixture and exposes frozen schema metadata", () => {
  const fixture: unknown = JSON.parse(
    readFileSync("cases/fixtures/case-fixture-001.json", "utf8"),
  );
  const schema = JSON.parse(
    readFileSync("cases/schemas/case-package-v1-rc1.schema.json", "utf8"),
  ) as { properties?: Record<string, { const?: string }>; required?: string[] };

  assert.doesNotThrow(() => assertCasePackage(fixture));
  assert.equal(schema.properties?.schemaVersion?.const, "case-package-v1-rc1");
  assert.equal(schema.properties?.evaluationVersion?.const, "scoring-policy-v1");
  assert.ok(schema.required?.includes("answerKey"));
  assert.ok(schema.required?.includes("rubric"));
});

test("rejects the negative private JSON fixture with publication and scoring issues", () => {
  const fixture: unknown = JSON.parse(
    readFileSync("tests/fixtures/case-package-invalid.json", "utf8"),
  );

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("published cases require approved AI cross-validation"));
      assert.ok(error.issues.includes("published cases require provenance.contentHash"));
      assert.ok(error.issues.includes("provenance.contentHash must be sha256:<64 lowercase hex>"));
      assert.ok(error.issues.includes("redFlagExclusionMatrix is required"));
      assert.ok(error.issues.includes("rubric.requiredDifferentialCount must equal 2"));
      return true;
    },
  );
});

test("accepts a published case with approved AI cross-validation while human review stays pending", () => {
  const fixture = createCaseFixture();
  const contentHash = `sha256:${"a".repeat(64)}`;
  fixture.packageStatus = "published";
  fixture.provenance.contentHash = contentHash;
  fixture.review.status = "pending";
  fixture.releaseValidation = {
    schemaVersion: "ai-case-cross-validation-v1",
    caseId: fixture.internalCaseId,
    caseVersion: fixture.caseVersion,
    contentHash,
    decision: "approved",
    validations: [
      {
        validatorId: "ai.validator.clinical.001",
        role: "clinical_safety",
        modelId: "gpt-5.6-sol",
        promptVersion: "ai-case-cross-validation-v1",
        decision: "approved",
        validatedAt: "2026-08-28T00:00:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: [],
      },
      {
        validatorId: "ai.validator.diagnostic.001",
        role: "diagnostic_quality",
        modelId: "gpt-5.6-sol",
        promptVersion: "ai-case-cross-validation-v1",
        decision: "approved",
        validatedAt: "2026-08-28T00:01:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: [],
      },
    ],
  };

  assert.doesNotThrow(() => assertCasePackage(fixture));
});

test("rejects malformed rubric collections and turn limits", () => {
  const fixture = createCaseFixture();
  fixture.rubric.mustAskFactIds = "fact.onset" as unknown as string[];
  fixture.rubric.acceptableDifferentialConceptIds = [];
  fixture.rubric.recommendedTurnLimit = 0;

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("rubric.mustAskFactIds must be a non-empty string array"));
      assert.ok(
        error.issues.includes("rubric.acceptableDifferentialConceptIds must contain at least two concept IDs"),
      );
      assert.ok(
        error.issues.includes(
          "rubric.recommendedTurnLimit must be an integer from 1 to 20",
        ),
      );
      return true;
    },
  );
});

test("rejects rubric references to nonexistent tests", () => {
  const fixture = createCaseFixture();
  fixture.rubric.testClassifications["test.missing"] = "required";

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

test("runtime validation rejects fields and metadata forbidden by the private Schema", () => {
  const extraField = createCaseFixture() as CasePackage & {
    answerLeak?: string;
  };
  extraField.answerLeak = "secret";
  assert.throws(
    () => assertCasePackage(extraField),
    (error: unknown) =>
      error instanceof CasePackageValidationError &&
      error.issues.includes("casePackage.answerLeak is not allowed"),
  );

  const invalidMetadata = createCaseFixture();
  invalidMetadata.provenance.createdAt = "not-a-date";
  invalidMetadata.provenance.contentHash = "invalid";
  assert.throws(
    () => assertCasePackage(invalidMetadata),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("provenance.createdAt must be a date-time"));
      assert.ok(error.issues.includes("provenance.contentHash must be sha256:<64 lowercase hex>"));
      return true;
    },
  );
});

test("red-flag matrix is bound to the case and explicit absent evidence", () => {
  const fixture = createCaseFixture();
  fixture.redFlagExclusionMatrix.caseVersion = "different-version";
  fixture.redFlagExclusionMatrix.entries[0]!.evidenceFactIds = ["fact.onset"];

  assert.throws(
    () => assertCasePackage(fixture),
    (error: unknown) => {
      assert.ok(error instanceof CasePackageValidationError);
      assert.ok(error.issues.includes("redFlagExclusionMatrix.caseVersion must match caseVersion"));
      assert.ok(
        error.issues.includes(
          'redFlagExclusionMatrix.entries[0].evidence fact "fact.onset" must exist and be absent',
        ),
      );
      return true;
    },
  );
});
