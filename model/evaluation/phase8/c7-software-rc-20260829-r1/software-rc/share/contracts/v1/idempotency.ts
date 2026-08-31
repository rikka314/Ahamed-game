export const IDEMPOTENCY_OPERATIONS_V1 = ["create_session", "submit_turn", "order_test", "submit_diagnosis", "cancel_session"] as const;
export type IdempotencyOperationV1 = (typeof IDEMPOTENCY_OPERATIONS_V1)[number];
export const IDEMPOTENCY_FINGERPRINT_ALGORITHM_V1 = "canonical-json-v1+sha256" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Fingerprint payload objects must be plain JSON objects");
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => key !== "clientRequestId" && key !== "clientTurnId")
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Fingerprint payload numbers must be finite");
  if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Fingerprint payload must be JSON-compatible");
  }
  return value;
}

export function createRequestFingerprintMaterialV1(operation: IdempotencyOperationV1, scopeId: string, payload: unknown): string {
  if (!scopeId) throw new TypeError("Fingerprint scopeId must not be empty");
  return JSON.stringify({ contractVersion: "1", operation, scopeId, payload: canonicalize(payload) });
}
