import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptTurnOperationRequestV1,
  encryptTurnOperationRequestV1,
  type TurnRequestCryptoIdentityV1,
} from "../src/application/turn-request-crypto.js";

const KEY = "phase7-turn-request-aead-test-key-000000000000";
const IDENTITY: TurnRequestCryptoIdentityV1 = {
  operationId: "operation.crypto.fixture",
  sessionId: "session.crypto.fixture",
  idempotencyKey: "turn.crypto.fixture",
  requestHash: `hmac-sha256:${"a".repeat(64)}`,
  providerName: "fixture-provider",
  modelId: "fixture-model-v1",
  promptVersion: "fixture-prompt-v1",
  caseVersion: "1.0.0",
};

test("turn request AEAD round-trips without serializing plaintext", () => {
  const text = "Could you clarify timeline PHI_MARKER_crypto_01?";
  const first = encryptTurnOperationRequestV1(IDENTITY, text, KEY);
  const second = encryptTurnOperationRequestV1(IDENTITY, text, KEY);

  assert.equal(JSON.stringify(first).includes(text), false);
  assert.notEqual(first.encryptedText.iv, second.encryptedText.iv);
  assert.notEqual(first.encryptedText.ciphertext, second.encryptedText.ciphertext);
  assert.deepEqual(decryptTurnOperationRequestV1(IDENTITY, first, KEY), {
    clientTurnId: IDENTITY.idempotencyKey,
    text,
  });
});

test("turn request AEAD rejects key, identity, metadata, and ciphertext tampering", () => {
  const encrypted = encryptTurnOperationRequestV1(
    IDENTITY,
    "When did it start?",
    KEY,
  );
  const tamperedCiphertext = structuredClone(encrypted);
  const ciphertextBytes = Buffer.from(
    tamperedCiphertext.encryptedText.ciphertext,
    "base64url",
  );
  ciphertextBytes[0] = ciphertextBytes[0]! ^ 1;
  tamperedCiphertext.encryptedText.ciphertext =
    ciphertextBytes.toString("base64url");
  const tamperedLength = structuredClone(encrypted);
  tamperedLength.textLength += 1;
  const malformed = { ...encrypted, unexpected: true };

  for (const attempt of [
    () => decryptTurnOperationRequestV1(IDENTITY, encrypted, `${KEY}x`),
    () =>
      decryptTurnOperationRequestV1(
        { ...IDENTITY, operationId: "operation.crypto.changed" },
        encrypted,
        KEY,
      ),
    () => decryptTurnOperationRequestV1(IDENTITY, tamperedCiphertext, KEY),
    () => decryptTurnOperationRequestV1(IDENTITY, tamperedLength, KEY),
    () => decryptTurnOperationRequestV1(IDENTITY, malformed, KEY),
  ]) {
    assert.throws(attempt, /Encrypted turn request is invalid/u);
  }
});
