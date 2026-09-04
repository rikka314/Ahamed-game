import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  OperationJournalRecord,
  ValidatedOperationBuffer,
} from "../persistence/ports.js";

export const OPERATION_BUFFER_INTEGRITY_VERSION_V1 =
  "operation-buffer-integrity.v1" as const;

type OperationIdentity = Pick<
  OperationJournalRecord,
  | "operationId"
  | "sessionId"
  | "idempotencyKey"
  | "requestHash"
  | "kind"
  | "providerName"
  | "modelId"
  | "promptVersion"
  | "caseVersion"
>;

type UnsignedBuffer = Pick<
  ValidatedOperationBuffer,
  "kind" | "payload" | "sha256" | "validatedAt"
>;

export function operationBufferSha256V1(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function operationBufferHmacSha256V1(
  operation: OperationIdentity,
  buffer: UnsignedBuffer,
  key: string,
): string {
  const material = JSON.stringify({
    version: OPERATION_BUFFER_INTEGRITY_VERSION_V1,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    idempotencyKey: operation.idempotencyKey,
    requestHash: operation.requestHash,
    operationKind: operation.kind,
    providerName: operation.providerName,
    modelId: operation.modelId,
    promptVersion: operation.promptVersion,
    caseVersion: operation.caseVersion,
    bufferKind: buffer.kind,
    payloadSha256: buffer.sha256,
    validatedAt: buffer.validatedAt,
    payload: buffer.payload,
  });
  return `hmac-sha256:${createHmac("sha256", key)
    .update(material)
    .digest("hex")}`;
}

export function operationBufferHmacMatchesV1(
  actual: string,
  operation: OperationIdentity,
  buffer: UnsignedBuffer,
  key: string,
): boolean {
  const expected = operationBufferHmacSha256V1(operation, buffer, key);
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
