import {
  normalizeOpenAICompatibleBaseURL,
  openAIEndpointSha256,
  openAIProviderNameForBaseURL,
  OPENAI_OFFICIAL_BASE_URL,
} from "./openai-model-provider.js";

export interface OpenAIRuntimeConfig {
  apiKey: string;
  baseURL: string;
  providerName: string;
  endpointSha256: string;
  isOfficial: boolean;
}

function configuredValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

export function resolveOpenAIRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): OpenAIRuntimeConfig {
  if (environment["NODE_TLS_REJECT_UNAUTHORIZED"] === "0") {
    throw new Error("模型 live eval 拒绝在关闭 TLS 证书校验时运行。");
  }
  const configuredBaseURL = configuredValue(environment["MODEL_BASE_URL"]);
  const baseURL = configuredBaseURL === undefined
    ? OPENAI_OFFICIAL_BASE_URL
    : normalizeOpenAICompatibleBaseURL(configuredBaseURL);
  const isOfficial = baseURL === OPENAI_OFFICIAL_BASE_URL;
  const openAIKey = configuredValue(environment["OPENAI_API_KEY"]);
  const modelKey = configuredValue(environment["MODEL_API_KEY"]);
  if (isOfficial && modelKey !== undefined) {
    throw new Error(
      "MODEL_API_KEY 只能与第三方 MODEL_BASE_URL 成对使用；不会把第三方 Key 发送到官方 OpenAI。",
    );
  }
  const apiKey = isOfficial
    ? openAIKey
    : modelKey;
  if (apiKey === undefined) {
    throw new Error(
      isOfficial
        ? "缺少 OPENAI_API_KEY；官方 OpenAI live eval 未启动。"
        : "配置 MODEL_BASE_URL 时必须同时配置 MODEL_API_KEY；不会把 OPENAI_API_KEY 发送到第三方端点。",
    );
  }
  return {
    apiKey,
    baseURL,
    providerName: openAIProviderNameForBaseURL(baseURL),
    endpointSha256: openAIEndpointSha256(baseURL),
    isOfficial,
  };
}
