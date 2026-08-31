import { createHash } from "node:crypto";

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";

import type { PromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAIModelProvider,
  OPENAI_STRUCTURED_OUTPUT_SCHEMA_VERSION,
} from "./openai-model-provider.js";
import {
  ModelProviderOutputError,
  ModelProviderRequestError,
  type StructuredProviderResponseSchema,
  type StructuredProviderTransport,
  type StructuredProviderTransportRequest,
  type StructuredProviderTransportResponse,
} from "./model-provider.js";

export interface AnthropicResponseSchema
  extends StructuredProviderResponseSchema {}

export interface AnthropicTransportRequest
  extends StructuredProviderTransportRequest {
  schema: AnthropicResponseSchema;
}

export interface AnthropicTransportResponse
  extends StructuredProviderTransportResponse {}

export interface AnthropicMessagesTransport extends StructuredProviderTransport {
  readonly providerName: "anthropic";
  readonly protocol: "anthropic-messages";
  create(
    request: AnthropicTransportRequest,
  ): Promise<AnthropicTransportResponse>;
}

export interface OfficialAnthropicTransportOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface AnthropicModelProviderOptions {
  transport: AnthropicMessagesTransport;
  modelId: string;
  promptVersion: string;
  promptRegistry: PromptRegistry;
  callTimeoutMs?: number;
  operationTimeoutMs?: number;
  maxRetries?: number;
  now?: () => number;
}

export const ANTHROPIC_SDK_VERSION = "0.119.0";
export const ANTHROPIC_PROVIDER_ADAPTER_VERSION = "anthropic-messages-v1";
export const ANTHROPIC_STRUCTURED_OUTPUT_SCHEMA_VERSION =
  OPENAI_STRUCTURED_OUTPUT_SCHEMA_VERSION;
export const ANTHROPIC_OFFICIAL_BASE_URL = "https://api.anthropic.com";

function normalizeAnthropicBaseURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError("Anthropic base URL must be a valid absolute HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("Anthropic base URL must be a credential-free HTTPS origin.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/gu, "");
  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function anthropicEndpointSha256(baseURL: string): string {
  return createHash("sha256")
    .update(normalizeAnthropicBaseURL(baseURL))
    .digest("hex");
}

function providerRequestId(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const candidate = error as {
    requestID?: unknown;
    request_id?: unknown;
    _request_id?: unknown;
  };
  if (typeof candidate.requestID === "string") return candidate.requestID;
  if (typeof candidate.request_id === "string") return candidate.request_id;
  if (typeof candidate._request_id === "string") return candidate._request_id;
  return undefined;
}

function mapAnthropicError(error: unknown): ModelProviderRequestError {
  if (error instanceof ModelProviderRequestError) return error;
  const requestId = providerRequestId(error);
  if (error instanceof APIConnectionTimeoutError) {
    return new ModelProviderRequestError(
      "ANTHROPIC_TIMEOUT",
      "Anthropic request failed.",
      {
        retryable: true,
        ...(requestId === undefined ? {} : { providerRequestId: requestId }),
      },
    );
  }
  if (error instanceof APIConnectionError) {
    return new ModelProviderRequestError(
      "ANTHROPIC_CONNECTION",
      "Anthropic request failed.",
      {
        retryable: true,
        ...(requestId === undefined ? {} : { providerRequestId: requestId }),
      },
    );
  }
  if (error instanceof APIError) {
    const status = error.status;
    const retryable =
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (typeof status === "number" && status >= 500);
    const code =
      status === 401
        ? "ANTHROPIC_AUTHENTICATION"
        : status === 402
          ? "ANTHROPIC_BILLING"
          : status === 403
            ? "ANTHROPIC_PERMISSION"
            : status === 429
              ? "ANTHROPIC_RATE_LIMIT"
              : retryable
                ? "ANTHROPIC_TRANSIENT"
                : "ANTHROPIC_REQUEST_REJECTED";
    return new ModelProviderRequestError(code, "Anthropic request failed.", {
      retryable,
      ...(status === undefined ? {} : { status }),
      ...(requestId === undefined ? {} : { providerRequestId: requestId }),
    });
  }
  return new ModelProviderRequestError(
    "ANTHROPIC_UNKNOWN",
    "Anthropic request failed.",
    { retryable: false },
  );
}

function extractStructuredText(content: readonly { type: string }[]): string {
  const textBlocks = content.filter(
    (block): block is { type: "text"; text: string } =>
      block.type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
  const hasUnsupportedBlock = content.some(
    ({ type }) =>
      type !== "text" &&
      type !== "thinking" &&
      type !== "redacted_thinking",
  );
  if (hasUnsupportedBlock || textBlocks.length !== 1) {
    throw new ModelProviderOutputError(
      "Anthropic structured output did not contain exactly one final text block.",
    );
  }
  return textBlocks[0]!.text;
}

export class OfficialAnthropicMessagesTransport
  implements AnthropicMessagesTransport
{
  readonly providerName = "anthropic";
  readonly protocol = "anthropic-messages";
  readonly endpointSha256 = anthropicEndpointSha256(
    ANTHROPIC_OFFICIAL_BASE_URL,
  );
  private readonly client: Anthropic;

  constructor(options: OfficialAnthropicTransportOptions) {
    const allowedOrigin = new URL(ANTHROPIC_OFFICIAL_BASE_URL).origin;
    const delegateFetch = options.fetch ?? fetch;
    const pinnedFetch: typeof fetch = async (input, init) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (requestUrl.origin !== allowedOrigin) {
        throw new TypeError("Anthropic transport blocked an origin change.");
      }
      return delegateFetch(input, { ...init, redirect: "manual" });
    };
    this.client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      baseURL: ANTHROPIC_OFFICIAL_BASE_URL,
      maxRetries: 0,
      fetch: pinnedFetch,
    });
  }

  async create(
    request: AnthropicTransportRequest,
  ): Promise<AnthropicTransportResponse> {
    try {
      const pending = this.client.messages.create(
        {
          model: request.modelId,
          max_tokens: request.maxOutputTokens,
          system: request.instructions,
          messages: [{ role: "user", content: request.input }],
          output_config: {
            format: {
              type: "json_schema",
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
      const stopReason = data.stop_reason ?? "missing_stop_reason";
      const status =
        stopReason === "end_turn" || stopReason === "stop_sequence"
          ? "completed"
          : stopReason === "max_tokens" || stopReason === "pause_turn"
            ? "incomplete"
            : "failed";
      const outputText =
        status === "completed" ? extractStructuredText(data.content) : "";
      const cacheCreationTokens = data.usage.cache_creation_input_tokens ?? 0;
      const cachedInputTokens = data.usage.cache_read_input_tokens ?? 0;
      const inputTokens =
        data.usage.input_tokens + cacheCreationTokens + cachedInputTokens;
      const usage = {
        inputTokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: inputTokens + data.usage.output_tokens,
        ...(cachedInputTokens === 0 ? {} : { cachedInputTokens }),
      };
      return {
        status,
        outputText,
        responseId: data.id,
        ...(requestId == null ? {} : { requestId }),
        modelId: String(data.model),
        finishReason: stopReason,
        ...(status === "completed" ? {} : { failureCode: stopReason }),
        usage,
      };
    } catch (error) {
      if (error instanceof ModelProviderOutputError) throw error;
      throw mapAnthropicError(error);
    }
  }
}

export class AnthropicModelProvider extends OpenAIModelProvider {
  constructor(options: AnthropicModelProviderOptions) {
    const providerName: string = options.transport.providerName;
    if (providerName !== "anthropic") {
      throw new TypeError(
        "Anthropic transport providerName must be anthropic.",
      );
    }
    if (options.transport.protocol !== "anthropic-messages") {
      throw new TypeError(
        "Anthropic transport protocol must be anthropic-messages.",
      );
    }
    super({
      ...options,
      adapterMetadata: {
        adapterVersion: ANTHROPIC_PROVIDER_ADAPTER_VERSION,
        sdkVersion: ANTHROPIC_SDK_VERSION,
        schemaVersion: ANTHROPIC_STRUCTURED_OUTPUT_SCHEMA_VERSION,
        protocol: "anthropic-messages",
        errorCodePrefix: "ANTHROPIC",
        providerLabel: "Anthropic",
      },
    });
  }
}
