import assert from "node:assert/strict";
import test from "node:test";

import { OPENAI_OFFICIAL_BASE_URL } from "../src/providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../src/providers/openai-runtime-config.js";

test("runtime config defaults to official OpenAI and ignores OPENAI_BASE_URL", () => {
  const resolved = resolveOpenAIRuntimeConfig({
    OPENAI_API_KEY: "official-test-key",
    OPENAI_BASE_URL: "https://attacker.invalid/v1",
  });

  assert.equal(resolved.baseURL, OPENAI_OFFICIAL_BASE_URL);
  assert.equal(resolved.providerName, "openai");
  assert.equal(resolved.apiKey, "official-test-key");
  assert.equal(resolved.isOfficial, true);
  assert.match(resolved.endpointSha256, /^[a-f0-9]{64}$/u);
});

test("runtime config requires a provider-neutral key for a third-party URL", () => {
  assert.throws(
    () =>
      resolveOpenAIRuntimeConfig({
        MODEL_BASE_URL: "https://gateway.example/v1",
        OPENAI_API_KEY: "must-not-be-forwarded",
      }),
    /must simultaneously configure MODEL_API_KEY|必须同时配置 MODEL_API_KEY/u,
  );

  const resolved = resolveOpenAIRuntimeConfig({
    MODEL_BASE_URL: "https://gateway.example/v1/",
    MODEL_API_KEY: "third-party-test-key",
    OPENAI_API_KEY: "must-not-be-forwarded",
  });
  assert.equal(resolved.baseURL, "https://gateway.example/v1");
  assert.equal(resolved.apiKey, "third-party-test-key");
  assert.equal(resolved.isOfficial, false);
  assert.match(resolved.providerName, /^openai-compatible\.[a-f0-9]{16}$/u);
});

test("runtime config never crosses official and third-party key boundaries", () => {
  assert.throws(
    () => resolveOpenAIRuntimeConfig({ MODEL_API_KEY: "third-party-test-key" }),
    /只能与第三方 MODEL_BASE_URL 成对使用/u,
  );
  assert.throws(
    () =>
      resolveOpenAIRuntimeConfig({
        MODEL_BASE_URL: OPENAI_OFFICIAL_BASE_URL,
        MODEL_API_KEY: "third-party-test-key",
      }),
    /不会把第三方 Key 发送到官方 OpenAI/u,
  );
});

test("runtime config rejects missing keys and unsafe third-party URLs", () => {
  assert.throws(() => resolveOpenAIRuntimeConfig({}), /OPENAI_API_KEY/u);
  assert.throws(
    () =>
      resolveOpenAIRuntimeConfig({
        OPENAI_API_KEY: "official-test-key",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      }),
    /TLS/u,
  );
  assert.throws(
    () =>
      resolveOpenAIRuntimeConfig({
        MODEL_BASE_URL: "http://gateway.example/v1",
        MODEL_API_KEY: "third-party-test-key",
      }),
    /HTTPS/u,
  );
});
