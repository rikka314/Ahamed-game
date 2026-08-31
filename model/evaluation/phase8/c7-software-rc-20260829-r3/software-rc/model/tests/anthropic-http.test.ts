import assert from "node:assert/strict";
import test from "node:test";

import {
  OfficialAnthropicMessagesTransport,
  type AnthropicTransportRequest,
} from "../src/providers/anthropic-model-provider.js";
import {
  ModelProviderRequestError,
} from "../src/providers/model-provider.js";

function request(): AnthropicTransportRequest {
  return {
    operationId: "operation_http",
    clientRequestId: "operation_http.controller.1",
    role: "controller",
    modelId: "claude-test",
    instructions: "controller prompt",
    input: JSON.stringify({ question: "你好", locale: "zh-CN", factIndex: [] }),
    schema: {
      name: "ahamed_controller_v1",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["action", "requestedFactIds", "safetyCode"],
        properties: {},
      },
    },
    store: false,
    timeoutMs: 1_000,
    maxOutputTokens: 400,
  };
}

function completedResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_http",
    type: "message",
    role: "assistant",
    model: "claude-test-snapshot",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          action: "other",
          requestedFactIds: [],
          safetyCode: null,
        }),
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 2,
    },
    ...overrides,
  };
}

test("official Claude SDK transport sends a strict non-streaming Messages request", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = input instanceof Request ? input.url : String(input);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify(completedResponse()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_http",
      },
    });
  };
  const previousBaseUrl = process.env["ANTHROPIC_BASE_URL"];
  process.env["ANTHROPIC_BASE_URL"] = "https://attacker.invalid";
  let result;
  try {
    const transport = new OfficialAnthropicMessagesTransport({
      apiKey: "test-key-not-secret",
      fetch: fakeFetch,
    });
    result = await transport.create(request());
  } finally {
    if (previousBaseUrl === undefined) delete process.env["ANTHROPIC_BASE_URL"];
    else process.env["ANTHROPIC_BASE_URL"] = previousBaseUrl;
  }

  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedBody?.["model"], "claude-test");
  assert.equal(capturedBody?.["max_tokens"], 400);
  assert.equal(capturedBody?.["system"], "controller prompt");
  assert.equal(capturedBody?.["store"], undefined);
  assert.equal(
    ((capturedBody?.["output_config"] as {
      format: { type: string };
    }).format.type),
    "json_schema",
  );
  assert.deepEqual(
    capturedBody?.["messages"],
    [{ role: "user", content: request().input }],
  );
  assert.equal(
    capturedHeaders?.get("x-client-request-id"),
    "operation_http.controller.1",
  );
  assert.equal(result.requestId, "req_http");
  assert.equal(result.modelId, "claude-test-snapshot");
  assert.equal(result.finishReason, "end_turn");
  assert.deepEqual(result.usage, {
    inputTokens: 16,
    outputTokens: 7,
    totalTokens: 23,
    cachedInputTokens: 2,
  });
});

test("Claude transport maps stop reasons and refuses non-text content", async () => {
  const maxTokens = new OfficialAnthropicMessagesTransport({
    apiKey: "test-key-not-secret",
    fetch: async () => new Response(
      JSON.stringify(completedResponse({ stop_reason: "max_tokens" })),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const incomplete = await maxTokens.create(request());
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.failureCode, "max_tokens");

  const refused = new OfficialAnthropicMessagesTransport({
    apiKey: "test-key-not-secret",
    fetch: async () => new Response(
      JSON.stringify(completedResponse({ stop_reason: "refusal" })),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const refusal = await refused.create(request());
  assert.equal(refusal.status, "failed");
  assert.equal(refusal.failureCode, "refusal");

  const toolUse = new OfficialAnthropicMessagesTransport({
    apiKey: "test-key-not-secret",
    fetch: async () => new Response(
      JSON.stringify(completedResponse({
        content: [{ type: "tool_use", id: "tool_1", name: "unexpected", input: {} }],
        stop_reason: "tool_use",
      })),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const unexpectedTool = await toolUse.create(request());
  assert.equal(unexpectedTool.status, "failed");
  assert.equal(unexpectedTool.finishReason, "tool_use");
  assert.equal(unexpectedTool.failureCode, "tool_use");
  assert.equal(unexpectedTool.outputText, "");
});

test("official Claude SDK automatic retries stay disabled and errors are normalized", async () => {
  let calls = 0;
  const transport = new OfficialAnthropicMessagesTransport({
    apiKey: "test-key-not-secret",
    fetch: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "temporary" },
          request_id: "req_overloaded",
        }),
        {
          status: 529,
          headers: {
            "content-type": "application/json",
            "request-id": "req_overloaded",
          },
        },
      );
    },
  });

  await assert.rejects(
    transport.create(request()),
    (error: unknown) =>
      error instanceof ModelProviderRequestError &&
      error.code === "ANTHROPIC_TRANSIENT" &&
      error.retryable &&
      error.status === 529 &&
      error.providerRequestId === "req_overloaded",
  );
  assert.equal(calls, 1);
});
