import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import OpenAI from "openai";

import { evaluateDeterministically } from "../evaluation/deterministic-evaluator.js";
import { projectReviewEvaluationV1 } from "../evaluation/public-evaluation-projection.js";
import type { PromptRegistry, PromptTemplate } from "../prompts/prompt-registry.js";
import type {
  ControllerDecision,
  ControllerInput,
  EvaluationInput,
  ModelProvider,
  ModelProviderIdentity,
  PatientAgentOutput,
  PatientInput,
  PatientReply,
  ProviderCallRecord,
  ProviderCallUsage,
  ProviderMedicalEvaluation,
  ProviderRole,
  ReviewInput,
  ReviewOutput,
  ReviewProvider,
  StructuredProviderResponseSchema,
  StructuredProviderTransport,
  StructuredProviderTransportRequest,
  StructuredProviderTransportResponse,
} from "./model-provider.js";
import {
  ModelProviderOutputError,
  ModelProviderRequestError,
} from "./model-provider.js";

export interface OpenAIResponseSchema
  extends StructuredProviderResponseSchema {}

export interface OpenAITransportRequest
  extends StructuredProviderTransportRequest {
  schema: OpenAIResponseSchema;
}

export interface OpenAITransportResponse
  extends StructuredProviderTransportResponse {}

export interface OpenAIResponsesTransport extends StructuredProviderTransport {
  readonly protocol: "openai-responses";
  create(request: OpenAITransportRequest): Promise<OpenAITransportResponse>;
}

export interface OfficialOpenAITransportOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface OpenAICompatibleTransportOptions
  extends OfficialOpenAITransportOptions {
  baseURL: string;
}

export const OPENAI_SDK_VERSION = "7.7.0";
export const OPENAI_PROVIDER_ADAPTER_VERSION = "openai-compatible-responses-v2";
export const OPENAI_STRUCTURED_OUTPUT_SCHEMA_VERSION = "phase8-v2";
export const OPENAI_OFFICIAL_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_COMPATIBLE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return true;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function parseIpv6Bytes(hostname: string): Uint8Array | undefined {
  let normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized.includes("%")) return undefined;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const octets = normalized.slice(lastColon + 1).split(".").map(Number);
    if (
      lastColon < 0 ||
      octets.length !== 4 ||
      octets.some((octet) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255
      )
    ) {
      return undefined;
    }
    normalized = `${normalized.slice(0, lastColon)}:${(
      ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    ).toString(16)}:${(
      ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    ).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const head = (halves[0] ?? "").split(":").filter(Boolean);
  const tail = (halves[1] ?? "").split(":").filter(Boolean);
  const omitted = 8 - head.length - tail.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    return undefined;
  }
  const groups = [
    ...head,
    ...Array.from({ length: omitted }, () => "0"),
    ...tail,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/u.test(group))
  ) {
    return undefined;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function hasIpv6Prefix(
  address: Uint8Array,
  prefix: readonly number[],
  prefixBits: number,
): boolean {
  const wholeBytes = Math.floor(prefixBits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  const remainingBits = prefixBits % 8;
  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return ((address[wholeBytes] ?? 0) & mask) ===
    ((prefix[wholeBytes] ?? 0) & mask);
}

function isPrivateIpv6(hostname: string): boolean {
  const bytes = parseIpv6Bytes(hostname);
  if (bytes === undefined || ((bytes[0] ?? 0) & 0xe0) !== 0x20) return true;
  return (
    hasIpv6Prefix(bytes, [0x20, 0x01, 0x00], 23) ||
    hasIpv6Prefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    hasIpv6Prefix(bytes, [0x20, 0x02], 16) ||
    hasIpv6Prefix(bytes, [0x3f, 0x80], 10) ||
    hasIpv6Prefix(bytes, [0x3f, 0xfe], 16) ||
    hasIpv6Prefix(bytes, [0x3f, 0xff, 0x00], 20)
  );
}

function isPrivateEndpointHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  const addressKind = isIP(normalized);
  if (addressKind === 4) return isPrivateIpv4(normalized);
  if (addressKind === 6) return isPrivateIpv6(normalized);
  return false;
}

export function assertPublicOpenAICompatibleAddress(address: string): void {
  const addressKind = isIP(address);
  const unsafe = addressKind === 4
    ? isPrivateIpv4(address)
    : addressKind === 6
      ? isPrivateIpv6(address)
      : true;
  if (unsafe) {
    throw new TypeError(
      "MODEL_BASE_URL resolved to a local, private, or invalid network address.",
    );
  }
}

export function normalizeOpenAICompatibleBaseURL(value: string): string {
  const candidate = value.trim();
  if (candidate.includes("?") || candidate.includes("#")) {
    throw new TypeError("MODEL_BASE_URL must not contain query parameters or a fragment.");
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError("MODEL_BASE_URL must be a valid absolute HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError("MODEL_BASE_URL must use HTTPS.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("MODEL_BASE_URL must not contain credentials.");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("MODEL_BASE_URL must not contain query parameters or a fragment.");
  }
  if (parsed.hostname.endsWith(".")) {
    throw new TypeError("MODEL_BASE_URL hostname must not end with a dot.");
  }
  if (isPrivateEndpointHostname(parsed.hostname)) {
    throw new TypeError("MODEL_BASE_URL must not target a local or private network address.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/gu, "");
  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function openAIEndpointSha256(baseURL: string): string {
  return createHash("sha256")
    .update(normalizeOpenAICompatibleBaseURL(baseURL))
    .digest("hex");
}

export function openAIProviderNameForBaseURL(baseURL: string): string {
  const normalized = normalizeOpenAICompatibleBaseURL(baseURL);
  if (normalized === OPENAI_OFFICIAL_BASE_URL) return "openai";
  return `openai-compatible.${openAIEndpointSha256(normalized).slice(0, 16)}`;
}

function schemaSha256(schema: OpenAIResponseSchema): string {
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
}

function providerRequestId(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const candidate = error as { requestID?: unknown; request_id?: unknown };
  if (typeof candidate.requestID === "string") return candidate.requestID;
  if (typeof candidate.request_id === "string") return candidate.request_id;
  return undefined;
}

function mapOpenAIError(error: unknown): ModelProviderRequestError {
  const requestId = providerRequestId(error);
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ModelProviderRequestError(
      "OPENAI_TIMEOUT",
      "OpenAI request failed.",
      { retryable: true, ...(requestId === undefined ? {} : { providerRequestId: requestId }) },
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ModelProviderRequestError(
      "OPENAI_CONNECTION",
      "OpenAI request failed.",
      { retryable: true, ...(requestId === undefined ? {} : { providerRequestId: requestId }) },
    );
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const retryable =
      status === 408 ||
      status === 429 ||
      (typeof status === "number" && status >= 500);
    const code = status === 401
      ? "OPENAI_AUTHENTICATION"
      : status === 403
        ? "OPENAI_PERMISSION"
        : status === 429
          ? "OPENAI_RATE_LIMIT"
          : retryable
            ? "OPENAI_TRANSIENT"
            : "OPENAI_REQUEST_REJECTED";
    return new ModelProviderRequestError(code, "OpenAI request failed.", {
      retryable,
      ...(status === undefined ? {} : { status }),
      ...(requestId === undefined ? {} : { providerRequestId: requestId }),
    });
  }
  if (error instanceof ModelProviderRequestError) return error;
  return new ModelProviderRequestError(
    "OPENAI_UNKNOWN",
    "OpenAI request failed.",
    { retryable: false },
  );
}

function lookupError(message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code: "ENOTFOUND" });
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, "", 4);
      return;
    }
    try {
      for (const { address } of addresses) {
        assertPublicOpenAICompatibleAddress(address);
      }
    } catch (addressError) {
      callback(
        lookupError(
          addressError instanceof Error
            ? addressError.message
            : "MODEL_BASE_URL resolved to an unsafe network address.",
        ),
        "",
        4,
      );
      return;
    }
    const requestedFamily = options.family === 4 || options.family === 6
      ? options.family
      : undefined;
    const candidates = requestedFamily === undefined
      ? addresses
      : addresses.filter(({ family }) => family === requestedFamily);
    if (candidates.length === 0) {
      callback(lookupError("MODEL_BASE_URL has no public address for the requested family."), "", 4);
      return;
    }
    if (options.all === true) {
      callback(null, candidates);
      return;
    }
    const selected = candidates[0]!;
    callback(null, selected.address, selected.family);
  });
};

const directPublicHttpsFetch: typeof fetch = async (input, init) => {
  if (process.env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0") {
    throw new TypeError(
      "Third-party model requests require TLS certificate verification.",
    );
  }
  const request = new Request(input, init);
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "https:") {
    throw new TypeError("OpenAI-compatible transport requires HTTPS.");
  }
  const requestBody = request.body === null
    ? undefined
    : Buffer.from(await request.arrayBuffer());
  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    const outgoing = httpsRequest(
      requestUrl,
      {
        agent: false,
        headers: Object.fromEntries(request.headers.entries()),
        lookup: publicOnlyLookup,
        method: request.method,
        signal: request.signal,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        let settled = false;
        const rejectOnce = (error: Error): void => {
          if (settled) return;
          settled = true;
          rejectResponse(error);
        };
        incoming.on("error", rejectOnce);
        const declaredLength = Number(incoming.headers["content-length"]);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > OPENAI_COMPATIBLE_MAX_RESPONSE_BYTES
        ) {
          const error = new RangeError(
            "OpenAI-compatible response exceeded the configured byte limit.",
          );
          rejectOnce(error);
          incoming.destroy(error);
          return;
        }
        incoming.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > OPENAI_COMPATIBLE_MAX_RESPONSE_BYTES) {
            const error = new RangeError(
              "OpenAI-compatible response exceeded the configured byte limit.",
            );
            rejectOnce(error);
            incoming.destroy(error);
            return;
          }
          chunks.push(buffer);
        });
        incoming.on("end", () => {
          if (settled) return;
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }
          const status = incoming.statusCode ?? 500;
          const body = Buffer.concat(chunks);
          settled = true;
          resolveResponse(new Response(body.length === 0 ? null : body, {
            status,
            ...(incoming.statusMessage === undefined
              ? {}
              : { statusText: incoming.statusMessage }),
            headers,
          }));
        });
      },
    );
    outgoing.on("error", (error) => rejectResponse(error));
    outgoing.end(requestBody);
  });
};

const USE_OFFICIAL_OPENAI_ACCOUNT_HEADERS = Symbol("official-openai-account-headers");

export class OpenAICompatibleResponsesTransport
  implements OpenAIResponsesTransport
{
  readonly protocol = "openai-responses";
  readonly providerName: string;
  readonly endpointSha256: string;
  private readonly client: OpenAI;

  constructor(
    options: OpenAICompatibleTransportOptions,
    accountHeaderMode?: typeof USE_OFFICIAL_OPENAI_ACCOUNT_HEADERS,
  ) {
    const baseURL = normalizeOpenAICompatibleBaseURL(options.baseURL);
    this.providerName = openAIProviderNameForBaseURL(baseURL);
    this.endpointSha256 = openAIEndpointSha256(baseURL);
    const allowedOrigin = new URL(baseURL).origin;
    const useOfficialAccountHeaders =
      accountHeaderMode === USE_OFFICIAL_OPENAI_ACCOUNT_HEADERS;
    const delegateFetch = options.fetch ??
      (useOfficialAccountHeaders ? fetch : directPublicHttpsFetch);
    const pinnedFetch: typeof fetch = async (input, init) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (requestUrl.origin !== allowedOrigin) {
        throw new TypeError("OpenAI-compatible transport blocked an origin change.");
      }
      return delegateFetch(input, { ...init, redirect: "manual" });
    };
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL,
      maxRetries: 0,
      fetch: pinnedFetch,
      ...(useOfficialAccountHeaders
        ? {}
        : { organization: null, project: null }),
    });
  }

  async create(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
    try {
      const pending = this.client.responses.create(
        {
          model: request.modelId,
          instructions: request.instructions,
          input: request.input,
          store: false,
          max_output_tokens: request.maxOutputTokens,
          text: {
            format: {
              type: "json_schema",
              name: request.schema.name,
              strict: true,
              schema: request.schema.schema,
            },
          },
        },
        {
          timeout: request.timeoutMs,
          maxRetries: 0,
          headers: { "X-Client-Request-Id": request.clientRequestId },
        },
      );
      const { data, request_id: requestId } = await pending.withResponse();
      const cachedInputTokens = data.usage?.input_tokens_details?.cached_tokens ?? 0;
      const reasoningOutputTokens =
        data.usage?.output_tokens_details?.reasoning_tokens ?? 0;
      const usage = data.usage == null
        ? undefined
        : {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
            totalTokens: data.usage.total_tokens,
            ...(cachedInputTokens === 0
              ? {}
              : { cachedInputTokens }),
            ...(reasoningOutputTokens === 0
              ? {}
              : { reasoningOutputTokens }),
          };
      const status = data.status ?? "failed";
      const finishReason = status === "incomplete"
        ? data.incomplete_details?.reason
        : status === "failed"
          ? data.error?.code
          : status;
      return {
        status,
        outputText: data.output_text,
        responseId: data.id,
        ...(requestId == null ? {} : { requestId }),
        modelId: String(data.model),
        ...(finishReason === undefined || finishReason === null
          ? {}
          : { finishReason }),
        ...(data.error?.code !== undefined
          ? { failureCode: data.error.code }
          : data.incomplete_details?.reason === undefined
            ? {}
            : { failureCode: data.incomplete_details.reason }),
        ...(usage === undefined ? {} : { usage }),
      };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }
}

export class OfficialOpenAIResponsesTransport
  extends OpenAICompatibleResponsesTransport
{
  constructor(options: OfficialOpenAITransportOptions) {
    super(
      { ...options, baseURL: OPENAI_OFFICIAL_BASE_URL },
      USE_OFFICIAL_OPENAI_ACCOUNT_HEADERS,
    );
  }
}

const CONTROLLER_SCHEMA: OpenAIResponseSchema = {
  name: "ahamed_controller_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "requestedFactIds", "safetyCode"],
    properties: {
      action: { type: "string", enum: ["ask_patient", "other", "unsafe"] },
      requestedFactIds: { type: "array", items: { type: "string" } },
      safetyCode: {
        anyOf: [
          { type: "string", enum: ["SAFETY_PROMPT_INJECTION", "SAFETY_REAL_HEALTH_INPUT"] },
          { type: "null" },
        ],
      },
    },
  },
};

const PATIENT_SCHEMA: OpenAIResponseSchema = {
  name: "ahamed_patient_agent_v2",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "reply",
      "interactionKind",
      "factIdsUsed",
      "personaFactIdsUsed",
      "completedTestIdsUsed",
      "requestedTestId",
      "suggestedTestId",
      "newFactsClaimed",
      "diagnosisLeak",
    ],
    properties: {
      reply: { type: "string" },
      interactionKind: {
        type: "string",
        enum: ["medical_chat", "social_chat", "test_query", "test_order"],
      },
      factIdsUsed: { type: "array", items: { type: "string" } },
      personaFactIdsUsed: { type: "array", items: { type: "string" } },
      completedTestIdsUsed: { type: "array", items: { type: "string" } },
      requestedTestId: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      suggestedTestId: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      newFactsClaimed: {
        type: "array",
        maxItems: 0,
        items: { type: "string" },
      },
      diagnosisLeak: { type: "boolean" },
    },
  },
};

function constrainedStringArray(ids: readonly string[]): unknown {
  const values = [...new Set(ids)].sort();
  return values.length === 0
    ? { type: "array", maxItems: 0, items: { type: "string" } }
    : { type: "array", items: { type: "string", enum: values } };
}

function nullableConstrainedId(ids: readonly string[]): unknown {
  const values = [...new Set(ids)].sort();
  return values.length === 0
    ? { type: "null" }
    : {
        anyOf: [
          { type: "string", enum: values },
          { type: "null" },
        ],
      };
}

function patientSchemaForInput(
  input: PatientInput,
): OpenAIResponseSchema {
  const schema = structuredClone(PATIENT_SCHEMA);
  const properties = (schema.schema as {
    properties: Record<string, unknown>;
  }).properties;
  properties["factIdsUsed"] = constrainedStringArray(
    input.safeCaseView.facts.map(({ factId }) => factId),
  );
  properties["personaFactIdsUsed"] = constrainedStringArray(
    input.patientProfile.personaFacts.map(({ personaFactId }) => personaFactId),
  );
  properties["completedTestIdsUsed"] = constrainedStringArray(
    input.safeCaseView.tests
      .filter(({ status }) => status === "completed")
      .map(({ testId }) => testId),
  );
  const knownTestIds = input.safeCaseView.tests.map(({ testId }) => testId);
  properties["requestedTestId"] = nullableConstrainedId(knownTestIds);
  properties["suggestedTestId"] = nullableConstrainedId(knownTestIds);
  return schema;
}

const REVIEW_SCHEMA: OpenAIResponseSchema = {
  name: "ahamed_review_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "communicationScore",
      "supportingTurnIds",
      "rubricCriterionIds",
      "summary",
    ],
    properties: {
      communicationScore: { type: "integer", enum: [0, 50, 100] },
      supportingTurnIds: { type: "array", items: { type: "string" } },
      rubricCriterionIds: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function isUniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length;
}

function parseJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    throw new ModelProviderOutputError("OpenAI returned invalid JSON.");
  }
}

function parseController(outputText: string, allowedFactIds: Set<string>): ControllerDecision {
  const value = parseJson(outputText);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["action", "requestedFactIds", "safetyCode"]) ||
    !isUniqueStrings(value["requestedFactIds"]) ||
    value["requestedFactIds"].some((factId) => !allowedFactIds.has(factId))
  ) {
    throw new ModelProviderOutputError("Controller output failed validation.");
  }
  if (
    value["action"] === "ask_patient" &&
    value["safetyCode"] === null
  ) {
    return { action: "ask_patient", requestedFactIds: value["requestedFactIds"] };
  }
  if (
    value["action"] === "other" &&
    value["requestedFactIds"].length === 0 &&
    value["safetyCode"] === null
  ) {
    return { action: "other", requestedFactIds: [] };
  }
  if (
    value["action"] === "unsafe" &&
    value["requestedFactIds"].length === 0 &&
    (value["safetyCode"] === "SAFETY_PROMPT_INJECTION" ||
      value["safetyCode"] === "SAFETY_REAL_HEALTH_INPUT")
  ) {
    return {
      action: "unsafe",
      requestedFactIds: [],
      safetyCode: value["safetyCode"],
    };
  }
  throw new ModelProviderOutputError("Controller output failed validation.");
}

function parsePatient(
  outputText: string,
  input: PatientInput,
): PatientAgentOutput {
  const value = parseJson(outputText);
  const allowedFactIds = new Set(
    input.safeCaseView.facts.map(({ factId }) => factId),
  );
  const allowedPersonaFactIds = new Set(
    input.patientProfile.personaFacts.map(({ personaFactId }) => personaFactId),
  );
  const completedTestIds = new Set(
    input.safeCaseView.tests
      .filter(({ status }) => status === "completed")
      .map(({ testId }) => testId),
  );
  const knownTestIds = new Set(
    input.safeCaseView.tests.map(({ testId }) => testId),
  );
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "reply",
      "interactionKind",
      "factIdsUsed",
      "personaFactIdsUsed",
      "completedTestIdsUsed",
      "requestedTestId",
      "suggestedTestId",
      "newFactsClaimed",
      "diagnosisLeak",
    ]) ||
    typeof value["reply"] !== "string" ||
    value["reply"].length === 0 ||
    value["reply"].length > 4_000 ||
    !["medical_chat", "social_chat", "test_query", "test_order"].includes(
      String(value["interactionKind"]),
    ) ||
    !isUniqueStrings(value["factIdsUsed"]) ||
    value["factIdsUsed"].some((factId) => !allowedFactIds.has(factId)) ||
    !isUniqueStrings(value["personaFactIdsUsed"]) ||
    value["personaFactIdsUsed"].some(
      (factId) => !allowedPersonaFactIds.has(factId),
    ) ||
    !isUniqueStrings(value["completedTestIdsUsed"]) ||
    value["completedTestIdsUsed"].some(
      (testId) => !completedTestIds.has(testId),
    ) ||
    (value["requestedTestId"] !== null &&
      typeof value["requestedTestId"] !== "string") ||
    (typeof value["requestedTestId"] === "string" &&
      !knownTestIds.has(value["requestedTestId"])) ||
    (value["suggestedTestId"] !== null &&
      typeof value["suggestedTestId"] !== "string") ||
    (typeof value["suggestedTestId"] === "string" &&
      !knownTestIds.has(value["suggestedTestId"])) ||
    !isUniqueStrings(value["newFactsClaimed"]) ||
    value["newFactsClaimed"].length !== 0 ||
    typeof value["diagnosisLeak"] !== "boolean"
  ) {
    throw new ModelProviderOutputError("Patient output failed validation.");
  }
  return {
    reply: value["reply"],
    interactionKind: value["interactionKind"] as PatientAgentOutput["interactionKind"],
    factIdsUsed: value["factIdsUsed"],
    personaFactIdsUsed: value["personaFactIdsUsed"],
    completedTestIdsUsed: value["completedTestIdsUsed"],
    ...(value["requestedTestId"] === null
      ? {}
      : { requestedTestId: value["requestedTestId"] as string }),
    ...(value["suggestedTestId"] === null
      ? {}
      : { suggestedTestId: value["suggestedTestId"] as string }),
    newFactsClaimed: value["newFactsClaimed"],
    diagnosisLeak: value["diagnosisLeak"],
  };
}

function parseReview(outputText: string): ReviewOutput {
  const value = parseJson(outputText);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "communicationScore",
      "supportingTurnIds",
      "rubricCriterionIds",
      "summary",
    ]) ||
    (value["communicationScore"] !== 0 &&
      value["communicationScore"] !== 50 &&
      value["communicationScore"] !== 100) ||
    !isUniqueStrings(value["supportingTurnIds"]) ||
    value["supportingTurnIds"].length === 0 ||
    !isUniqueStrings(value["rubricCriterionIds"]) ||
    value["rubricCriterionIds"].length === 0 ||
    typeof value["summary"] !== "string" ||
    value["summary"].trim().length === 0 ||
    value["summary"].length > 4_000
  ) {
    throw new ModelProviderOutputError("Review output failed validation.");
  }
  return {
    communicationAssessment: {
      status: "available",
      score: value["communicationScore"],
      supportingTurnIds: value["supportingTurnIds"],
      rubricCriterionIds: value["rubricCriterionIds"],
    },
    summary: value["summary"],
  };
}

function addUsage(
  aggregate: ProviderCallUsage | undefined,
  value: ProviderCallUsage | undefined,
): ProviderCallUsage | undefined {
  if (value === undefined) return aggregate;
  return {
    inputTokens: (aggregate?.inputTokens ?? 0) + value.inputTokens,
    outputTokens: (aggregate?.outputTokens ?? 0) + value.outputTokens,
    totalTokens: (aggregate?.totalTokens ?? 0) + value.totalTokens,
    ...((aggregate?.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0) === 0
      ? {}
      : { cachedInputTokens: (aggregate?.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0) }),
    ...((aggregate?.reasoningOutputTokens ?? 0) + (value.reasoningOutputTokens ?? 0) === 0
      ? {}
      : { reasoningOutputTokens: (aggregate?.reasoningOutputTokens ?? 0) + (value.reasoningOutputTokens ?? 0) }),
  };
}

interface RoleCallOptions<T> {
  operationId: string;
  role: ProviderRole;
  input: unknown;
  schema: OpenAIResponseSchema;
  maxOutputTokens: number;
  retryOutputErrors?: boolean;
  parse(outputText: string): T;
}

export interface StructuredProviderAdapterMetadata {
  adapterVersion: string;
  sdkVersion: string;
  schemaVersion: string;
  protocol: string;
  errorCodePrefix: string;
  providerLabel: string;
}

export interface OpenAIModelProviderOptions {
  transport: StructuredProviderTransport;
  modelId: string;
  promptVersion: string;
  promptRegistry: PromptRegistry;
  adapterMetadata?: StructuredProviderAdapterMetadata;
  callTimeoutMs?: number;
  operationTimeoutMs?: number;
  maxRetries?: number;
  now?: () => number;
}

export class OpenAIModelProvider implements ModelProvider, ReviewProvider {
  readonly identity: ModelProviderIdentity;
  private readonly prompts: Record<ProviderRole, PromptTemplate>;
  private readonly records = new Map<string, ProviderCallRecord[]>();
  private readonly operationStartedAt = new Map<string, number>();
  private readonly operationRetryBudget = new Map<string, number>();
  private readonly callTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly endpointSha256: string;
  private readonly adapterMetadata: StructuredProviderAdapterMetadata;

  constructor(private readonly options: OpenAIModelProviderOptions) {
    this.adapterMetadata = options.adapterMetadata ?? {
      adapterVersion: OPENAI_PROVIDER_ADAPTER_VERSION,
      sdkVersion: OPENAI_SDK_VERSION,
      schemaVersion: OPENAI_STRUCTURED_OUTPUT_SCHEMA_VERSION,
      protocol: "openai-responses",
      errorCodePrefix: "OPENAI",
      providerLabel: "OpenAI",
    };
    if (options.transport.protocol !== this.adapterMetadata.protocol) {
      throw new TypeError(
        `${this.adapterMetadata.providerLabel} transport protocol must be ${this.adapterMetadata.protocol}.`,
      );
    }
    if (options.modelId.trim().length === 0) {
      throw new TypeError(`${this.adapterMetadata.providerLabel} modelId is required.`);
    }
    this.prompts = Object.freeze({
      controller: options.promptRegistry.load("controller", options.promptVersion),
      patient: options.promptRegistry.load("patient", options.promptVersion),
      review: options.promptRegistry.load("review", options.promptVersion),
    });
    const promptSetFingerprint = createHash("sha256")
      .update(JSON.stringify(
        (["controller", "patient", "review"] as const).map((role) => [
          role,
          this.prompts[role].version,
          this.prompts[role].sha256,
        ]),
      ))
      .digest("hex")
      .slice(0, 16);
    const providerName = options.transport.providerName;
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(providerName)) {
      throw new TypeError(`${this.adapterMetadata.providerLabel} providerName is invalid.`);
    }
    this.endpointSha256 = options.transport.endpointSha256;
    if (!/^[a-f0-9]{64}$/u.test(this.endpointSha256)) {
      throw new TypeError(`${this.adapterMetadata.providerLabel} endpointSha256 is invalid.`);
    }
    this.identity = Object.freeze({
      providerName,
      modelId: options.modelId,
      promptVersion: `${options.promptVersion}+set.${promptSetFingerprint}`,
    });
    this.callTimeoutMs = options.callTimeoutMs ?? 120_000;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 300_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.now = options.now ?? Date.now;
    if (this.callTimeoutMs <= 0 || this.operationTimeoutMs <= 0) {
      throw new RangeError(`${this.adapterMetadata.providerLabel} timeout values must be positive.`);
    }
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 1) {
      throw new RangeError(`${this.adapterMetadata.providerLabel} maxRetries must be 0 or 1.`);
    }
  }

  async classifyTurn(input: ControllerInput): Promise<ControllerDecision> {
    if (!this.operationStartedAt.has(input.operationId)) {
      this.operationStartedAt.set(input.operationId, this.now());
    }
    try {
      const decision = await this.callRole({
        operationId: input.operationId,
        role: "controller",
        input: {
          question: input.text,
          locale: input.locale,
          factIndex: input.factIndex.map(({ factId, questionMatchers }) => ({
            factId,
            questionMatchers: [...questionMatchers],
          })),
        },
        schema: CONTROLLER_SCHEMA,
        maxOutputTokens: 400,
        parse: (outputText) => parseController(
          outputText,
          new Set(input.factIndex.map(({ factId }) => factId)),
        ),
      });
      if (decision.action !== "ask_patient") {
        this.operationStartedAt.delete(input.operationId);
        this.operationRetryBudget.delete(input.operationId);
      }
      return decision;
    } catch (error) {
      this.operationStartedAt.delete(input.operationId);
      this.operationRetryBudget.delete(input.operationId);
      throw error;
    }
  }

  async generatePatientReply(input: PatientInput): Promise<PatientReply> {
    if (!this.operationStartedAt.has(input.operationId)) {
      this.operationStartedAt.set(input.operationId, this.now());
    }
    try {
      return await this.callRole({
        operationId: input.operationId,
        role: "patient",
        input: {
          userText: input.userText,
          patientProfile: structuredClone(input.patientProfile),
          safeCaseView: structuredClone(input.safeCaseView),
          recentTurns: structuredClone(input.recentTurns),
          disclosedFactIds: [...input.disclosedFactIds],
          completedTests: structuredClone(input.completedTests),
          consecutiveOffTopicTurns: input.consecutiveOffTopicTurns,
          ...(input.pendingTestSuggestionId === undefined
            ? {}
            : { pendingTestSuggestionId: input.pendingTestSuggestionId }),
          ...(input.regenerationInstruction === undefined
            ? {}
            : { regenerationInstruction: input.regenerationInstruction }),
        },
        schema: patientSchemaForInput(input),
        maxOutputTokens: 1_200,
        retryOutputErrors: false,
        parse: (outputText) => parsePatient(outputText, input),
      });
    } finally {
      this.operationStartedAt.delete(input.operationId);
      this.operationRetryBudget.delete(input.operationId);
    }
  }

  async evaluate(
    input: EvaluationInput & { operationId: string },
  ): Promise<ProviderMedicalEvaluation> {
    if (!this.operationStartedAt.has(input.operationId)) {
      this.operationStartedAt.set(input.operationId, this.now());
    }
    const provisional = evaluateDeterministically(input, {
      status: "unavailable",
      failureCode: "COMMUNICATION_REVIEW_PENDING",
    });
    try {
      const review = await this.review({
        operationId: input.operationId,
        locale: input.casePackage.locale,
        deterministicEvaluation: projectReviewEvaluationV1(provisional),
        turns: structuredClone(
          input.turns ?? input.turnIds.map((turnId) => ({ turnId, text: "", reply: "" })),
        ),
        completedTests: structuredClone(
          input.completedTests ?? input.completedTestIds.map((testId) => ({
            testId,
            status: "completed" as const,
          })),
        ).map((test) => ({
          testId: test.testId,
          status: test.status,
          ...(!("report" in test) || test.report === undefined
            ? {}
            : { report: test.report }),
        })),
        communicationRubricVersion:
          input.casePackage.rubric.communicationRubricVersion,
        communicationCriterionIds: [
          ...input.casePackage.rubric.communicationCriterionIds,
        ],
      });
      const evaluation = evaluateDeterministically(
        input,
        review.communicationAssessment,
      );
      if (review.communicationAssessment.status !== "available") {
        throw new ModelProviderOutputError(
          "Provider review did not return a communication assessment.",
        );
      }
      return {
        ...evaluation,
        communicationAssessment: review.communicationAssessment,
      };
    } finally {
      this.operationStartedAt.delete(input.operationId);
      this.operationRetryBudget.delete(input.operationId);
    }
  }

  async review(input: ReviewInput): Promise<ReviewOutput> {
    const startedHere = !this.operationStartedAt.has(input.operationId);
    if (startedHere) {
      this.operationStartedAt.set(input.operationId, this.now());
    }
    try {
      return await this.callRole({
        operationId: input.operationId,
        role: "review",
        input: {
          locale: input.locale,
          deterministicEvaluation: projectReviewEvaluationV1(
            input.deterministicEvaluation,
          ),
          turns: structuredClone(input.turns),
          completedTests: structuredClone(input.completedTests),
          communicationRubricVersion: input.communicationRubricVersion,
          communicationCriterionIds: [...input.communicationCriterionIds],
        },
        schema: REVIEW_SCHEMA,
        maxOutputTokens: 1_200,
        parse: parseReview,
      });
    } finally {
      if (startedHere) {
        this.operationStartedAt.delete(input.operationId);
        this.operationRetryBudget.delete(input.operationId);
      }
    }
  }

  drainCallRecords(operationId: string): ProviderCallRecord[] {
    const records = this.records.get(operationId) ?? [];
    this.records.delete(operationId);
    return structuredClone(records);
  }

  beginOperation(operationId: string, retryBudget: number): void {
    if (!Number.isInteger(retryBudget) || retryBudget < 0 || retryBudget > 1) {
      throw new RangeError(
        `${this.adapterMetadata.providerLabel} operation retry budget must be 0 or 1.`,
      );
    }
    this.operationStartedAt.set(operationId, this.now());
    this.operationRetryBudget.set(operationId, retryBudget);
  }

  finishOperation(operationId: string): void {
    this.operationStartedAt.delete(operationId);
    this.operationRetryBudget.delete(operationId);
  }

  reproducibilityManifest() {
    return {
      adapterVersion: this.adapterMetadata.adapterVersion,
      sdkVersion: this.adapterMetadata.sdkVersion,
      schemaVersion: this.adapterMetadata.schemaVersion,
      protocol: this.adapterMetadata.protocol,
      endpointSha256: this.endpointSha256,
      promptSha256ByRole: {
        controller: this.prompts.controller.sha256,
        patient: this.prompts.patient.sha256,
        review: this.prompts.review.sha256,
      },
      schemaSha256ByRole: {
        controller: schemaSha256(CONTROLLER_SCHEMA),
        patient: schemaSha256(PATIENT_SCHEMA),
        review: schemaSha256(REVIEW_SCHEMA),
      },
    };
  }

  private async callRole<T>(options: RoleCallOptions<T>): Promise<T> {
    const startedAt = this.operationStartedAt.get(options.operationId) ?? this.now();
    this.operationStartedAt.set(options.operationId, startedAt);
    const prompt = this.prompts[options.role];
    const callStartedAt = this.now();
    let usage: ProviderCallUsage | undefined;
    let lastResponse: OpenAITransportResponse | undefined;
    let lastError: unknown;
    let attemptsPerformed = 0;

    const configuredRetryBudget = this.operationRetryBudget.get(
      options.operationId,
    );
    const roleRetryBudget = Math.min(
      this.maxRetries,
      configuredRetryBudget ?? this.maxRetries,
    );
    for (let attempt = 0; attempt <= roleRetryBudget; attempt += 1) {
      lastResponse = undefined;
      const remainingMs = startedAt + this.operationTimeoutMs - this.now();
      if (remainingMs <= 0) {
        lastError = new ModelProviderRequestError(
          `${this.adapterMetadata.errorCodePrefix}_OPERATION_TIMEOUT`,
          `${this.adapterMetadata.providerLabel} request failed.`,
          { retryable: true },
        );
        break;
      }
      try {
        attemptsPerformed += 1;
        const response = await this.options.transport.create({
          operationId: options.operationId,
          clientRequestId: `${options.operationId}.${options.role}.${attempt + 1}`,
          role: options.role,
          modelId: this.identity.modelId,
          instructions: prompt.content,
          input: JSON.stringify(options.input),
          schema: structuredClone(options.schema),
          store: false,
          timeoutMs: Math.min(this.callTimeoutMs, remainingMs),
          maxOutputTokens: options.maxOutputTokens,
        });
        lastResponse = response;
        usage = addUsage(usage, response.usage);
        if (response.status !== "completed") {
          const retryableResponse =
            response.failureCode === "max_output_tokens" ||
            response.failureCode === "max_tokens" ||
            response.failureCode === "server_error" ||
            response.failureCode === "rate_limit_exceeded" ||
            response.failureCode === "overloaded_error" ||
            response.failureCode === "temporarily_unavailable";
          throw new ModelProviderRequestError(
            response.failureCode ??
              `${this.adapterMetadata.errorCodePrefix}_RESPONSE_${response.status.toUpperCase()}`,
            `${this.adapterMetadata.providerLabel} request failed.`,
            {
              retryable: retryableResponse,
              ...(response.requestId === undefined
                ? {}
                : { providerRequestId: response.requestId }),
            },
          );
        }
        const parsed = options.parse(response.outputText);
        this.appendRecord({
          operationId: options.operationId,
          role: options.role,
          providerName: this.identity.providerName,
          modelId: response.modelId,
          promptVersion: this.identity.promptVersion,
          promptSha256: prompt.sha256,
          schemaName: options.schema.name,
          status: "completed",
          responseStatus: response.status,
          ...(response.finishReason === undefined ? {} : { finishReason: response.finishReason }),
          ...(response.requestId === undefined ? {} : { providerRequestId: response.requestId }),
          retryCount: attempt,
          durationMs: Math.max(0, this.now() - callStartedAt),
          ...(usage === undefined ? {} : { usage }),
        });
        return parsed;
      } catch (error) {
        lastError = error;
        const retryable =
          (error instanceof ModelProviderOutputError &&
            options.retryOutputErrors !== false) ||
          (error instanceof ModelProviderRequestError && error.retryable);
        if (!retryable || attempt >= roleRetryBudget) break;
        if (configuredRetryBudget !== undefined) {
          const remaining = this.operationRetryBudget.get(options.operationId) ?? 0;
          if (remaining <= 0) break;
          this.operationRetryBudget.set(options.operationId, remaining - 1);
        }
      }
    }

    const finalError = lastError instanceof Error
      ? lastError
      : new ModelProviderRequestError(
          `${this.adapterMetadata.errorCodePrefix}_UNKNOWN`,
          `${this.adapterMetadata.providerLabel} request failed.`,
          { retryable: false },
        );
    const retryCount = Math.max(0, attemptsPerformed - 1);
    this.appendRecord({
      operationId: options.operationId,
      role: options.role,
      providerName: this.identity.providerName,
      modelId: lastResponse?.modelId ?? this.identity.modelId,
      promptVersion: this.identity.promptVersion,
      promptSha256: prompt.sha256,
      schemaName: options.schema.name,
      status: "failed",
      ...(lastResponse?.status === undefined ? {} : { responseStatus: lastResponse.status }),
      ...(lastResponse?.finishReason === undefined ? {} : { finishReason: lastResponse.finishReason }),
      ...(lastResponse?.requestId === undefined
        ? finalError instanceof ModelProviderRequestError && finalError.providerRequestId !== undefined
          ? { providerRequestId: finalError.providerRequestId }
          : {}
        : { providerRequestId: lastResponse.requestId }),
      retryCount,
      durationMs: Math.max(0, this.now() - callStartedAt),
      ...(usage === undefined ? {} : { usage }),
      failureCode: finalError instanceof ModelProviderRequestError
        ? finalError.code
        : "MODEL_OUTPUT_REJECTED",
    });
    throw finalError;
  }

  private appendRecord(record: ProviderCallRecord): void {
    const existing = this.records.get(record.operationId) ?? [];
    existing.push(structuredClone(record));
    this.records.set(record.operationId, existing);
  }
}
