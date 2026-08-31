import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const TURN_REQUEST_ENCRYPTION_VERSION_V1 =
  "turn-request-aead.v1" as const;

export interface TurnRequestCryptoIdentityV1 {
  operationId: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  providerName: string;
  modelId: string;
  promptVersion: string;
  caseVersion: string;
}

export interface EncryptedTurnOperationRequestV1 {
  clientTurnId: string;
  textLength: number;
  inputHmac: string;
  encryptedText: {
    version: typeof TURN_REQUEST_ENCRYPTION_VERSION_V1;
    algorithm: "aes-256-gcm";
    iv: string;
    ciphertext: string;
    authTag: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update("ahamed.turn-request-encryption.v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function additionalAuthenticatedData(
  identity: TurnRequestCryptoIdentityV1,
  clientTurnId: string,
  textLength: number,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: TURN_REQUEST_ENCRYPTION_VERSION_V1,
      operationId: identity.operationId,
      sessionId: identity.sessionId,
      idempotencyKey: identity.idempotencyKey,
      requestHash: identity.requestHash,
      providerName: identity.providerName,
      modelId: identity.modelId,
      promptVersion: identity.promptVersion,
      caseVersion: identity.caseVersion,
      clientTurnId,
      textLength,
    }),
    "utf8",
  );
}

export function encryptTurnOperationRequestV1(
  identity: TurnRequestCryptoIdentityV1,
  text: string,
  secret: string,
): EncryptedTurnOperationRequestV1 {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(
    additionalAuthenticatedData(
      identity,
      identity.idempotencyKey,
      text.length,
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return {
    clientTurnId: identity.idempotencyKey,
    textLength: text.length,
    inputHmac: identity.requestHash,
    encryptedText: {
      version: TURN_REQUEST_ENCRYPTION_VERSION_V1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
    },
  };
}

export function decryptTurnOperationRequestV1(
  identity: TurnRequestCryptoIdentityV1,
  value: unknown,
  secret: string,
): { clientTurnId: string; text: string } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "clientTurnId",
      "textLength",
      "inputHmac",
      "encryptedText",
    ]) ||
    typeof value["clientTurnId"] !== "string" ||
    !Number.isSafeInteger(value["textLength"]) ||
    Number(value["textLength"]) < 1 ||
    typeof value["inputHmac"] !== "string" ||
    !isRecord(value["encryptedText"])
  ) {
    throw new Error("Encrypted turn request is invalid.");
  }
  const encrypted = value["encryptedText"];
  if (
    !hasExactKeys(encrypted, [
      "version",
      "algorithm",
      "iv",
      "ciphertext",
      "authTag",
    ]) ||
    encrypted["version"] !== TURN_REQUEST_ENCRYPTION_VERSION_V1 ||
    encrypted["algorithm"] !== "aes-256-gcm" ||
    typeof encrypted["iv"] !== "string" ||
    typeof encrypted["ciphertext"] !== "string" ||
    typeof encrypted["authTag"] !== "string" ||
    value["clientTurnId"] !== identity.idempotencyKey ||
    value["inputHmac"] !== identity.requestHash
  ) {
    throw new Error("Encrypted turn request is invalid.");
  }
  const iv = Buffer.from(encrypted["iv"], "base64url");
  const ciphertext = Buffer.from(encrypted["ciphertext"], "base64url");
  const authTag = Buffer.from(encrypted["authTag"], "base64url");
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Encrypted turn request is invalid.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      iv,
    );
    decipher.setAAD(
      additionalAuthenticatedData(
        identity,
        value["clientTurnId"],
        Number(value["textLength"]),
      ),
    );
    decipher.setAuthTag(authTag);
    const text = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (text.length !== value["textLength"]) {
      throw new Error("Encrypted turn request is invalid.");
    }
    return { clientTurnId: value["clientTurnId"], text };
  } catch {
    throw new Error("Encrypted turn request is invalid.");
  }
}
