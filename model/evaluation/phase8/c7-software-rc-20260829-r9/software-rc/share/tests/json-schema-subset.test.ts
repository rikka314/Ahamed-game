import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateJsonSchemaDocument,
  validateJsonSchemaSubset,
  type JsonSchemaSubset,
} from "../testing/json-schema-subset.js";

const root: JsonSchemaSubset = { $defs: {
  Sample: { type: "object", additionalProperties: false, required: ["name", "items", "choice"], properties: {
    name: { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" },
    items: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "integer", minimum: 1, maximum: 3 } },
    choice: { anyOf: [{ const: "a" }, { const: "b" }] }, stamp: { type: "string", format: "date-time" }, nullable: { type: "null" }, flag: { type: "boolean" }
  } },
  Combined: { allOf: [{ $ref: "#/$defs/Sample" }] },
  Exclusive: { oneOf: [{ const: "x" }, { const: "y" }] },
  BadRef: { $ref: "external.json" }
} };

test("subset validator covers supported constraints", () => {
  assert.equal(validateJsonSchemaSubset(root, "Sample", { name: "abc", items: [1, 2], choice: "a", stamp: "2026-08-26T00:00:00Z", nullable: null, flag: true }).valid, true);
  const result = validateJsonSchemaSubset(root, "Sample", { name: "A", items: [0, 0, 4], choice: "c", stamp: "bad", nullable: 1, extra: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 8);
  assert.equal(validateJsonSchemaSubset(root, "Combined", { name: "abc", items: [1], choice: "b" }).valid, true);
  assert.equal(validateJsonSchemaSubset(root, "Exclusive", "x").valid, true);
  assert.equal(validateJsonSchemaSubset(root, "Exclusive", "z").valid, false);
  assert.equal(validateJsonSchemaSubset(root, "BadRef", {}).valid, false);
  assert.equal(validateJsonSchemaSubset(root, "Missing", {}).valid, false);
});

test("document validation covers conditionals, schema-valued additional properties, and external refs", () => {
  const rubric: JsonSchemaSubset = {
    type: "object",
    minProperties: 1,
    additionalProperties: { enum: ["required", "useful"] },
  };
  const document: JsonSchemaSubset = {
    type: "object",
    additionalProperties: false,
    required: ["status", "rubric"],
    properties: {
      status: { enum: ["draft", "published"] },
      hash: { type: "string" },
      rubric: { $ref: "rubric.json" },
    },
    if: { properties: { status: { const: "published" } } },
    then: { required: ["hash"] },
  };

  assert.equal(
    validateJsonSchemaDocument(document, {
      status: "published",
      hash: "sha256:fixture",
      rubric: { "test.basic": "required" },
    }, { "rubric.json": rubric }).valid,
    true,
  );
  assert.equal(
    validateJsonSchemaDocument(document, {
      status: "published",
      rubric: { "test.basic": "invalid" },
    }, { "rubric.json": rubric }).valid,
    false,
  );
});
