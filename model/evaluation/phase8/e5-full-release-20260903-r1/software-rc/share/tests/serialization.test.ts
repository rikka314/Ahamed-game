import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestFingerprintMaterialV1 } from "../contracts/v1/idempotency.js";
import { fixtureDocument } from "./helpers.js";

test("all positive fixtures survive a JSON round trip", () => {
  for (const fixture of fixtureDocument.fixtures) {
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.positive)), fixture.positive);
  }
});

test("fingerprint material is key-order stable and excludes idempotency IDs", () => {
  const first = createRequestFingerprintMaterialV1("order_test", "session.1", { clientRequestId: "request.1", testId: "test.cbc", nested: { b: 2, a: 1 } });
  const second = createRequestFingerprintMaterialV1("order_test", "session.1", { nested: { a: 1, b: 2 }, testId: "test.cbc", clientRequestId: "request.2" });
  assert.equal(first, second);
  assert.equal(first.includes("request.1"), false);
});

test("fingerprint rejects invalid scope and non-JSON values", () => {
  assert.throws(() => createRequestFingerprintMaterialV1("order_test", "", {}), TypeError);
  assert.throws(() => createRequestFingerprintMaterialV1("order_test", "session.1", { value: Number.NaN }), TypeError);
  assert.throws(() => createRequestFingerprintMaterialV1("order_test", "session.1", { value: undefined }), TypeError);
  assert.throws(() => createRequestFingerprintMaterialV1("order_test", "session.1", { value: new Date() }), TypeError);
});
