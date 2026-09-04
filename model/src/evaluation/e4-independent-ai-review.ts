import { randomUUID } from "node:crypto";

import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
} from "../providers/openai-model-provider.js";
import { sha256E4Canonical } from "./e4-cross-layer-evidence.js";

export const E4_INDEPENDENT_AI_REVIEW_VERSION =
  "e4-independent-ai-review-v2" as const;

export const E4_REVIEWER_IDS = [
  "contract_projection_reviewer",
  "hidden_data_leakage_reviewer",
] as const;
export type E4ReviewerId = (typeof E4_REVIEWER_IDS)[number];

export interface E4ReviewFinding {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface E4IndependentAiReview {
  schemaVersion: typeof E4_INDEPENDENT_AI_REVIEW_VERSION;
  reviewerId: E4ReviewerId;
  reviewPolicy: "non_blocking";
  independentInvocation: true;
  counterpartOutputVisible: false;
  invocationId: string;
  attemptedAt: string;
  runStatus?: "completed" | "failed_to_run";
  decision: "passed" | "failed" | "not_run";
  modelId: string;
  promptVersion: string;
  contentSha256: string;
  assessedControls: string[];
  findings: E4ReviewFinding[];
  failureCode?: string;
}

export const E4_REQUIRED_REVIEW_CONTROLS: Readonly<
  Record<E4ReviewerId, readonly string[]>
> = {
  contract_projection_reviewer: [
    "share_only_projection",
    "thirty_unique_patient_roles",
    "fifteen_two_patient_shifts",
    "session_turn_identity_binding",
  ],
  hidden_data_leakage_reviewer: [
    "public_artifact_allowlist",
    "browser_storage_surfaces",
    "console_and_cache_surfaces",
    "private_evidence_separation",
  ],
};

function reviewSchema(role: E4ReviewerId): OpenAITransportRequest["schema"] {
  return {
    name: `ahamed_e4_${role}_v2`,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "assessedControls", "findings"],
      properties: {
        decision: { type: "string", enum: ["passed", "failed"] },
        assessedControls: {
          type: "array",
          minItems: E4_REQUIRED_REVIEW_CONTROLS[role].length,
          maxItems: E4_REQUIRED_REVIEW_CONTROLS[role].length,
          items: { type: "string", enum: [...E4_REQUIRED_REVIEW_CONTROLS[role]] },
        },
        findings: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "severity", "message"],
            properties: {
              code: { type: "string", minLength: 1, maxLength: 100 },
              severity: { type: "string", enum: ["info", "warning", "critical"] },
              message: { type: "string", minLength: 1, maxLength: 1000 },
            },
          },
        },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function parseReview(value: unknown, role: E4ReviewerId): {
  decision: "passed" | "failed";
  assessedControls: string[];
  findings: E4ReviewFinding[];
} {
  if (!isRecord(value) || !["passed", "failed"].includes(String(value["decision"])) || !Array.isArray(value["assessedControls"]) || !Array.isArray(value["findings"])) {
    throw new Error("E4 AI review output is structurally invalid.");
  }
  const assessedControls = value["assessedControls"];
  const required = E4_REQUIRED_REVIEW_CONTROLS[role];
  if (assessedControls.length !== required.length || new Set(assessedControls).size !== required.length || required.some((control) => !assessedControls.includes(control))) {
    throw new Error("E4 AI review did not assess every required control exactly once.");
  }
  const findings = value["findings"].map((finding) => {
    if (
      !isRecord(finding) ||
      typeof finding["code"] !== "string" || finding["code"].trim().length === 0 ||
      !["info", "warning", "critical"].includes(String(finding["severity"])) ||
      typeof finding["message"] !== "string" || finding["message"].trim().length === 0
    ) throw new Error("E4 AI review finding is invalid.");
    return {
      code: finding["code"],
      severity: finding["severity"] as E4ReviewFinding["severity"],
      message: finding["message"],
    };
  });
  const decision = value["decision"] as "passed" | "failed";
  if (decision === "passed" && findings.some(({ severity }) => severity === "critical")) {
    throw new Error("E4 AI review cannot pass with critical findings.");
  }
  return { decision, assessedControls: assessedControls as string[], findings };
}

export function assertE4IndependentAiReview(
  value: unknown,
  expectedContentSha256: string,
): asserts value is E4IndependentAiReview {
  if (!isRecord(value)) throw new Error("E4 persisted AI review is not an object.");
  const expectedKeys = [
    "schemaVersion",
    "reviewerId",
    "reviewPolicy",
    "independentInvocation",
    "counterpartOutputVisible",
    "invocationId",
    "attemptedAt",
    ...(value["runStatus"] === undefined ? [] : ["runStatus"]),
    "decision",
    "modelId",
    "promptVersion",
    "contentSha256",
    "assessedControls",
    "findings",
    ...(value["failureCode"] === undefined ? [] : ["failureCode"]),
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error("E4 persisted AI review fields drifted.");
  }
  const reviewerId = value["reviewerId"];
  if (
    value["schemaVersion"] !== E4_INDEPENDENT_AI_REVIEW_VERSION ||
    !E4_REVIEWER_IDS.includes(reviewerId as E4ReviewerId) ||
    value["reviewPolicy"] !== "non_blocking" ||
    value["independentInvocation"] !== true ||
    value["counterpartOutputVisible"] !== false ||
    typeof value["invocationId"] !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value["invocationId"]) ||
    !isExactIsoDate(value["attemptedAt"]) ||
    typeof value["modelId"] !== "string" || value["modelId"].trim().length === 0 ||
    value["contentSha256"] !== expectedContentSha256
  ) {
    throw new Error("E4 persisted AI review identity or isolation drifted.");
  }
  const role = reviewerId as E4ReviewerId;
  const expectedPromptVersions = role === "contract_projection_reviewer"
    ? ["e4-contract-projection-review-v2"]
    : ["e4-hidden-data-leakage-review-v2", "e4-hidden-data-leakage-review-v3"];
  if (!expectedPromptVersions.includes(String(value["promptVersion"]))) {
    throw new Error("E4 persisted AI review prompt version drifted.");
  }
  if (value["runStatus"] === "failed_to_run") {
    if (
      value["decision"] !== "not_run" ||
      typeof value["failureCode"] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value["failureCode"]) ||
      !Array.isArray(value["assessedControls"]) ||
      value["assessedControls"].length !== 0 ||
      !Array.isArray(value["findings"]) ||
      value["findings"].length !== 1 ||
      !isRecord(value["findings"][0]) ||
      value["findings"][0]["code"] !== "E4_AI_REVIEW_NOT_RUN" ||
      value["findings"][0]["severity"] !== "warning" ||
      typeof value["findings"][0]["message"] !== "string" ||
      value["findings"][0]["message"].trim().length === 0
    ) {
      throw new Error("E4 persisted not-run AI review drifted.");
    }
    return;
  }
  if (
    (value["runStatus"] !== undefined && value["runStatus"] !== "completed") ||
    value["failureCode"] !== undefined
  ) {
    throw new Error("E4 persisted completed AI review status drifted.");
  }
  const parsed = parseReview(value, role);
  if (
    value["decision"] !== parsed.decision ||
    sha256E4Canonical(value["assessedControls"]) !==
      sha256E4Canonical(parsed.assessedControls) ||
    sha256E4Canonical(value["findings"]) !== sha256E4Canonical(parsed.findings)
  ) {
    throw new Error("E4 persisted AI review decision or controls drifted.");
  }
}

export async function runE4IndependentAiReview(input: {
  reviewerId: E4ReviewerId;
  reviewTarget: unknown;
  transport: OpenAIResponsesTransport;
  modelId: string;
  expectedActualModelId?: string;
  invocationId?: string;
  now?: () => Date;
}): Promise<E4IndependentAiReview> {
  if (!E4_REVIEWER_IDS.includes(input.reviewerId)) throw new Error("Unknown E4 reviewer role.");
  if (input.modelId.trim().length === 0) throw new Error("E4 AI review modelId is required.");
  const promptVersion = input.reviewerId === "contract_projection_reviewer"
    ? "e4-contract-projection-review-v2"
    : "e4-hidden-data-leakage-review-v3";
  const instructions = input.reviewerId === "contract_projection_reviewer"
    ? "你是隔离运行的 Contract Projection Reviewer。只审核输入证据中的 share 公共投影、30 个唯一身份、15×2 槽位轮换和 session/turn 身份绑定。不要推断未提供内容，也看不到另一审核者输出。逐项覆盖所有 requiredControls。"
    : "你是隔离运行的 Hidden-data Leakage Reviewer。只审核公共制品 allowlist、浏览器 console/IndexedDB/localStorage/sessionStorage/CacheStorage/save surfaces 和私有证据分离。not_available 必须按证据如实评价，不得伪称已扫描；当产品确实未提供对应 surface 且证据如实记录 not_available 时，不应自动判定为 failed，可记录 warning。仅在发现敏感数据泄漏、scan_failed，或证据错误声称已扫描时判定 failed。你看不到另一审核者输出。逐项覆盖所有 requiredControls。";
  const common = {
    schemaVersion: E4_INDEPENDENT_AI_REVIEW_VERSION,
    reviewerId: input.reviewerId,
    reviewPolicy: "non_blocking" as const,
    independentInvocation: true as const,
    counterpartOutputVisible: false as const,
    invocationId: input.invocationId ?? `review.e4.${input.reviewerId}.${randomUUID()}`,
    attemptedAt: (input.now ?? (() => new Date()))().toISOString(),
    modelId: input.modelId,
    promptVersion,
    contentSha256: sha256E4Canonical(input.reviewTarget),
  };
  let response: Awaited<ReturnType<OpenAIResponsesTransport["create"]>>;
  try {
    response = await input.transport.create({
      operationId: `e4-review-${input.reviewerId}-${randomUUID()}`,
      clientRequestId: `e4_${input.reviewerId}`,
      role: "review",
      modelId: input.modelId,
      instructions,
      input: JSON.stringify({
        schemaVersion: "e4-independent-ai-review-input-v2",
        reviewerId: input.reviewerId,
        requiredControls: E4_REQUIRED_REVIEW_CONTROLS[input.reviewerId],
        reviewTarget: input.reviewTarget,
      }),
      schema: reviewSchema(input.reviewerId),
      store: false,
      timeoutMs: 300_000,
      maxOutputTokens: 4_000,
    });
  } catch (error) {
    return {
      ...common,
      runStatus: "failed_to_run",
      decision: "not_run",
      assessedControls: [],
      findings: [{
        code: "E4_AI_REVIEW_NOT_RUN",
        severity: "warning",
        message: "Independent E4 AI review did not run; the closure records this as non-blocking evidence.",
      }],
      failureCode: error !== null && typeof error === "object" && "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : error instanceof Error ? error.name : "UNKNOWN_PROVIDER_ERROR",
    };
  }
  if (input.expectedActualModelId !== undefined && response.modelId !== input.expectedActualModelId) {
    throw new Error("E4 AI review actual model ID drifted.");
  }
  let parsed: ReturnType<typeof parseReview>;
  try {
    if (response.status !== "completed" || response.outputText.trim().length === 0) {
      throw new Error("Provider response did not complete");
    }
    parsed = parseReview(JSON.parse(response.outputText) as unknown, input.reviewerId);
  } catch {
    return {
      ...common,
      runStatus: "failed_to_run",
      decision: "not_run",
      assessedControls: [],
      findings: [{
        code: "E4_AI_REVIEW_NOT_RUN",
        severity: "warning",
        message: "Independent E4 AI review returned no valid completed assessment; the closure records this as non-blocking evidence.",
      }],
      failureCode: "INVALID_PROVIDER_REVIEW_RESPONSE",
    };
  }
  return {
    ...common,
    runStatus: "completed",
    decision: parsed.decision,
    modelId: response.modelId,
    assessedControls: parsed.assessedControls,
    findings: parsed.findings,
  };
}
