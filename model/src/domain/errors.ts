export type ModelServiceErrorCode =
  | "CASE_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "INVALID_SESSION_STATE"
  | "TEST_NOT_AVAILABLE"
  | "MODEL_OUTPUT_REJECTED"
  | "SAFETY_PROMPT_INJECTION"
  | "SAFETY_REAL_HEALTH_INPUT";

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
