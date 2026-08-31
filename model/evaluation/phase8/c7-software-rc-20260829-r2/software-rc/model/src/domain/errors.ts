export type ModelServiceErrorCode =
  | "CASE_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_CANCELLED"
  | "INVALID_REQUEST"
  | "INVALID_SESSION_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "OPERATION_IN_PROGRESS"
  | "OPERATION_RECOVERY_REQUIRED"
  | "TURN_LIMIT_REACHED"
  | "TEST_NOT_AVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "MODEL_OUTPUT_REJECTED"
  | "EVALUATION_UNAVAILABLE"
  | "SAFETY_PROMPT_INJECTION"
  | "SAFETY_REAL_HEALTH_INPUT"
  | "SAFETY_INTERRUPTED";

export class ModelServiceError extends Error {
  readonly code: ModelServiceErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ModelServiceErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ModelServiceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
