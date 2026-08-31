import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublicOpenAICompatibleAddress,
  normalizeOpenAICompatibleBaseURL,
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
  openAIEndpointSha256,
  openAIProviderNameForBaseURL,
  type OpenAITransportRequest,
} from "../src/providers/openai-model-provider.js";
import { ModelProviderRequestError } from "../src/providers/model-provider.js";

function request(): OpenAITransportRequest {
  return {
    operationId: "operation_http",
    clientRequestId: "operation_http.controller.1",
    role: "controller",
    modelId: "gpt-test",
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

function completedResponse(): Record<string, unknown> {
  return {
    id: "resp_http",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: "gpt-test-2026-08-01",
    output: [
      {
        id: "msg_http",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              action: "other",
              requestedFactIds: [],
              safetyCode: null,
            }),
            annotations: [],
            logprobs: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 11,
      input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 1 },
      total_tokens: 18,
    },
  };
}

test("official SDK transport sends non-stored strict Responses requests", async () => {
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
        "x-request-id": "req_http",
      },
    });
  };
  const previousBaseUrl = process.env["OPENAI_BASE_URL"];
  process.env["OPENAI_BASE_URL"] = "https://attacker.invalid/v1";
  let result;
  try {
    const transport = new OfficialOpenAIResponsesTransport({
      apiKey: "test-key-not-secret",
      fetch: fakeFetch,
    });
    result = await transport.create(request());
  } finally {
    if (previousBaseUrl === undefined) delete process.env["OPENAI_BASE_URL"];
    else process.env["OPENAI_BASE_URL"] = previousBaseUrl;
  }

  assert.match(capturedUrl ?? "", /^https:\/\/api\.openai\.com\/v1\//u);
  assert.equal(capturedBody?.["store"], false);
  assert.equal(capturedBody?.["model"], "gpt-test");
  assert.equal(
    (capturedBody?.["text"] as { format: { type: string; strict: boolean } }).format.type,
    "json_schema",
  );
  assert.equal(
    (capturedBody?.["text"] as { format: { type: string; strict: boolean } }).format.strict,
    true,
  );
  assert.equal(
    capturedHeaders?.get("x-client-request-id"),
    "operation_http.controller.1",
  );
  assert.equal(result.requestId, "req_http");
  assert.equal(result.modelId, "gpt-test-2026-08-01");
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
    cachedInputTokens: 2,
    reasoningOutputTokens: 1,
  });
});

test("official SDK automatic retries stay disabled", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ error: { message: "temporary", type: "server_error" } }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  };
  const transport = new OfficialOpenAIResponsesTransport({
    apiKey: "test-key-not-secret",
    fetch: fakeFetch,
  });

  await assert.rejects(
    transport.create(request()),
    (error: unknown) =>
      error instanceof ModelProviderRequestError && error.retryable,
  );
  assert.equal(calls, 1);
});

test("compatible SDK transport pins its URL and strips OpenAI account headers", async () => {
  let capturedUrl: string | undefined;
  let capturedAuthorization: string | null | undefined;
  let capturedOrganization: string | null | undefined;
  let capturedProject: string | null | undefined;
  let capturedRedirect: RequestInit["redirect"];
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    capturedUrl = input instanceof Request ? input.url : String(input);
    capturedAuthorization = headers.get("authorization");
    capturedOrganization = headers.get("openai-organization");
    capturedProject = headers.get("openai-project");
    capturedRedirect = init?.redirect;
    return new Response(JSON.stringify(completedResponse()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_compatible_http",
      },
    });
  };
  const previousOrganization = process.env["OPENAI_ORG_ID"];
  const previousProject = process.env["OPENAI_PROJECT_ID"];
  process.env["OPENAI_ORG_ID"] = "org-must-not-leak";
  process.env["OPENAI_PROJECT_ID"] = "project-must-not-leak";
  try {
    const transport = new OpenAICompatibleResponsesTransport({
      apiKey: "third-party-test-key",
      baseURL: "https://gateway.example/api/openai/v1/",
      fetch: fakeFetch,
    });
    await transport.create(request());
  } finally {
    if (previousOrganization === undefined) delete process.env["OPENAI_ORG_ID"];
    else process.env["OPENAI_ORG_ID"] = previousOrganization;
    if (previousProject === undefined) delete process.env["OPENAI_PROJECT_ID"];
    else process.env["OPENAI_PROJECT_ID"] = previousProject;
  }

  assert.equal(
    capturedUrl,
    "https://gateway.example/api/openai/v1/responses",
  );
  assert.equal(capturedAuthorization, "Bearer third-party-test-key");
  assert.equal(capturedOrganization, null);
  assert.equal(capturedProject, null);
  assert.equal(capturedRedirect, "manual");
  assert.match(
    openAIProviderNameForBaseURL("https://gateway.example/api/openai/v1"),
    /^openai-compatible\.[a-f0-9]{16}$/u,
  );
  assert.match(
    openAIEndpointSha256("https://gateway.example/api/openai/v1"),
    /^[a-f0-9]{64}$/u,
  );
});

test("compatible transport tolerates minimal Responses usage details", async () => {
  const fakeFetch: typeof fetch = async () => {
    const response = completedResponse();
    response["usage"] = {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const transport = new OpenAICompatibleResponsesTransport({
    apiKey: "third-party-test-key",
    baseURL: "https://gateway.example/v1",
    fetch: fakeFetch,
  });

  const result = await transport.create(request());

  assert.deepEqual(result.usage, {
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
  });
});

test("compatible base URL validation rejects unsafe endpoint forms", () => {
  for (const value of [
    "http://gateway.example/v1",
    "https://user:password@gateway.example/v1",
    "https://gateway.example/v1?token=secret",
    "https://gateway.example/v1?",
    "https://gateway.example/v1#fragment",
    "https://gateway.example/v1#",
    "https://localhost/v1",
    "https://localhost./v1",
    "https://service.local./v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.8/v1",
    "https://169.254.169.254/v1",
    "https://[::1]/v1",
    "https://[::ffff:127.0.0.1]/v1",
    "https://[::ffff:10.0.0.1]/v1",
  ]) {
    assert.throws(() => normalizeOpenAICompatibleBaseURL(value));
  }
  assert.equal(
    normalizeOpenAICompatibleBaseURL("https://gateway.example/v1///"),
    "https://gateway.example/v1",
  );
});

test("connection address validation rejects private DNS results", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "fe80::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "2001:db8::10",
    "3f80::1",
  ]) {
    assert.throws(() => assertPublicOpenAICompatibleAddress(address));
  }
  assert.doesNotThrow(() => assertPublicOpenAICompatibleAddress("8.8.8.8"));
  assert.doesNotThrow(() =>
    assertPublicOpenAICompatibleAddress("2606:4700:4700::1111"),
  );
});
