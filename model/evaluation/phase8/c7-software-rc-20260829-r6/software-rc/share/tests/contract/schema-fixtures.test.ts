import assert from "node:assert/strict";
import { test } from "node:test";
import { validateJsonSchemaSubset } from "../../testing/json-schema-subset.js";
import { fixtureDocument, schema, schemaManifest } from "../helpers.js";
import { SCORING_CONTRACT_V1 } from "../../contracts/v1/evaluation.js";

test("every public DTO and event has one positive and negative fixture", () => {
  const names = fixtureDocument.fixtures.map((fixture) => fixture.schema);
  assert.deepEqual([...names].sort(), [...schemaManifest.definitions].sort());
  assert.equal(new Set(names).size, names.length);
});

test("event envelopes and payloads reject non-allowlisted fields", () => {
  const source = fixtureDocument.fixtures.find((fixture) => fixture.schema === "SessionCreatedEventV1");
  assert.ok(source);
  const envelope = { ...(source.positive as Record<string, unknown>), answerKey: "secret" };
  assert.equal(validateJsonSchemaSubset(schema, source.schema, envelope).valid, false);
  const payload = { ...(source.positive as Record<string, unknown>), payload: { sessionPhase: "active", hiddenFacts: [] } };
  assert.equal(validateJsonSchemaSubset(schema, source.schema, payload).valid, false);
});

for (const fixture of fixtureDocument.fixtures) {
  test(`${fixture.schema} accepts its positive fixture`, () => {
    const result = validateJsonSchemaSubset(schema, fixture.schema, fixture.positive);
    assert.equal(result.valid, true, result.errors.join("\n"));
  });
  test(`${fixture.schema} rejects its negative fixture`, () => {
    assert.equal(validateJsonSchemaSubset(schema, fixture.schema, fixture.negative).valid, false);
  });
}

test("evaluation and reward fixtures obey the frozen scoring formula", () => {
  const evaluationFixtures = fixtureDocument.fixtures.filter((fixture) =>
    ["EvaluationScoresV1", "EvaluationResultV1", "EvaluationCompletedEventV1"].includes(fixture.schema),
  );

  for (const fixture of evaluationFixtures) {
    const positive = fixture.positive as Record<string, unknown>;
    const candidate = fixture.schema === "EvaluationScoresV1"
      ? positive
      : fixture.schema === "EvaluationResultV1"
        ? (positive.scores as Record<string, unknown>)
        : (((positive.payload as Record<string, unknown>).scores) as Record<string, unknown>);
    const weighted = Object.entries(SCORING_CONTRACT_V1.weights).reduce(
      (sum, [component, weight]) => sum + Number(candidate[component]) * weight,
      0,
    );
    assert.equal(candidate.total, Math.round(weighted), fixture.schema);
    if (fixture.schema !== "EvaluationScoresV1") {
      const evaluation = fixture.schema === "EvaluationResultV1"
        ? positive
        : (positive.payload as Record<string, unknown>);
      assert.equal(
        evaluation.evaluationVersion,
        SCORING_CONTRACT_V1.evaluationVersion,
        fixture.schema,
      );
    }
  }

  const reward = fixtureDocument.fixtures.find((fixture) => fixture.schema === "RewardInputV1");
  const result = fixtureDocument.fixtures.find((fixture) => fixture.schema === "EvaluationResultV1");
  assert.ok(reward && result);
  assert.equal(
    (reward.positive as { scoreTotal: number }).scoreTotal,
    (result.positive as { scores: { total: number } }).scores.total,
  );
});

test("evaluation schema rejects scoring policy version drift", () => {
  const source = fixtureDocument.fixtures.find(
    (fixture) => fixture.schema === "EvaluationResultV1",
  );
  assert.ok(source);
  const drifted = {
    ...(source.positive as Record<string, unknown>),
    evaluationVersion: "scoring-policy-drifted",
  };
  assert.equal(
    validateJsonSchemaSubset(schema, source.schema, drifted).valid,
    false,
  );
});
