import assert from "node:assert/strict";
import test from "node:test";

import { ANTHROPIC_OFFICIAL_BASE_URL } from "../src/providers/anthropic-model-provider.js";
import { resolveAnthropicRuntimeConfig } from "../src/providers/anthropic-runtime-config.js";

test("runtime config pins official Anthropic and ignores ANTHROPIC_BASE_URL", () => {
  const resolved = resolveAnthropicRuntimeConfig({
    ANTHROPIC_API_KEY: "official-test-key",
    ANTHROPIC_BASE_URL: "https://attacker.invalid",
  });

  assert.equal(resolved.baseURL, ANTHROPIC_OFFICIAL_BASE_URL);
  assert.equal(resolved.providerName, "anthropic");
  assert.equal(resolved.apiKey, "official-test-key");
  assert.match(resolved.endpointSha256, /^[a-f0-9]{64}$/u);
});

test("runtime config rejects missing keys and disabled TLS verification", () => {
  assert.throws(() => resolveAnthropicRuntimeConfig({}), /ANTHROPIC_API_KEY/u);
  assert.throws(
    () => resolveAnthropicRuntimeConfig({
      ANTHROPIC_API_KEY: "official-test-key",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    }),
    /TLS/u,
  );
});
