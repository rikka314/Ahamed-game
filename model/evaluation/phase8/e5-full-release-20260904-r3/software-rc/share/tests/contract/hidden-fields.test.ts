import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fixtureDocument } from "../helpers.js";

const forbiddenKeys = new Set([
  "answerKey",
  "rubric",
  "prompt",
  "systemPrompt",
  "hiddenFacts",
  "undisclosedFacts",
  "modelReasoning",
  "apiKey",
  "personaTemplateId",
  "behaviorInstructions",
  "targetDiagnosis",
  "patientFacts",
]);

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value !== null && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      keys.push(key);
      collectKeys(child, keys);
    });
  }
  return keys;
}

test("positive public fixtures contain no confidential field names", () => {
  for (const fixture of fixtureDocument.fixtures) {
    const leaked = collectKeys(fixture.positive).filter((key) => forbiddenKeys.has(key));
    assert.deepEqual(leaked, [], `${fixture.schema} contains ${leaked.join(", ")}`);
  }
});

test("public schema does not define confidential fields", () => {
  const source = readFileSync(resolve("schemas/v1-rc2/public-contracts.schema.json"), "utf8");
  for (const key of forbiddenKeys) assert.equal(source.includes(`\"${key}\"`), false, `schema contains ${key}`);
});
