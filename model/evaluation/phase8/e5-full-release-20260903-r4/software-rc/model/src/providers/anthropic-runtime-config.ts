import {
  ANTHROPIC_OFFICIAL_BASE_URL,
  anthropicEndpointSha256,
} from "./anthropic-model-provider.js";

export interface AnthropicRuntimeConfig {
  apiKey: string;
  baseURL: string;
  providerName: "anthropic";
  endpointSha256: string;
}

function configuredValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

export function resolveAnthropicRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): AnthropicRuntimeConfig {
  if (environment["NODE_TLS_REJECT_UNAUTHORIZED"] === "0") {
    throw new Error("Claude live eval 拒绝在关闭 TLS 证书校验时运行。");
  }
  const apiKey = configuredValue(environment["ANTHROPIC_API_KEY"]);
  if (apiKey === undefined) {
    throw new Error("缺少 ANTHROPIC_API_KEY；Claude live eval 未启动。");
  }
  return {
    apiKey,
    baseURL: ANTHROPIC_OFFICIAL_BASE_URL,
    providerName: "anthropic",
    endpointSha256: anthropicEndpointSha256(ANTHROPIC_OFFICIAL_BASE_URL),
  };
}
