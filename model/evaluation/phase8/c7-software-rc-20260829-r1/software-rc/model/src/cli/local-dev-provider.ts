import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAICompatibleResponsesTransport,
  OpenAIModelProvider,
  type OpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import {
  ModelProviderRequestError,
  type ModelProvider,
} from "../providers/model-provider.js";
import { sha256Canonical } from "../release/phase8-release.js";
import { CliConfigurationError, type CliConfig } from "./config.js";

const LOCAL_DEV_MANIFEST_PATH =
  "evaluation/phase8/runtime-release-20260828-r2/runtime-release-manifest.v1.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function approvedProviderFromManifest(modelRoot: string): {
  providerName: string;
  protocol: string;
  endpointSha256: string;
  configuredModelId: string;
  actualModelId: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(resolve(modelRoot, LOCAL_DEV_MANIFEST_PATH), "utf8"),
    );
  } catch {
    throw new CliConfigurationError("Phase 8 运行时发布清单不可用。");
  }
  if (
    !isRecord(parsed) ||
    parsed["schemaVersion"] !== "runtime-release-manifest-v1" ||
    parsed["remoteInteractiveEnabled"] !== false ||
    !Array.isArray(parsed["approvedProviders"]) ||
    parsed["approvedProviders"].length !== 1 ||
    !isRecord(parsed["approvedProviders"][0])
  ) {
    throw new CliConfigurationError("Phase 8 运行时发布清单格式无效。");
  }
  const { manifestSha256, ...withoutHash } = parsed;
  if (
    typeof manifestSha256 !== "string" ||
    sha256Canonical(withoutHash) !== manifestSha256
  ) {
    throw new CliConfigurationError("Phase 8 运行时发布清单自校验失败。");
  }
  const provider = parsed["approvedProviders"][0];
  const fields = [
    "providerName",
    "protocol",
    "endpointSha256",
    "configuredModelId",
    "actualModelId",
  ] as const;
  if (fields.some((field) => typeof provider[field] !== "string")) {
    throw new CliConfigurationError("Phase 8 批准的 Provider 标识不完整。");
  }
  return {
    providerName: provider["providerName"] as string,
    protocol: provider["protocol"] as string,
    endpointSha256: provider["endpointSha256"] as string,
    configuredModelId: provider["configuredModelId"] as string,
    actualModelId: provider["actualModelId"] as string,
  };
}

export function pinLocalDevActualModel(
  transport: OpenAIResponsesTransport,
  expectedActualModelId: string,
): OpenAIResponsesTransport {
  return {
    protocol: transport.protocol,
    providerName: transport.providerName,
    endpointSha256: transport.endpointSha256,
    async create(request) {
      const response = await transport.create(request);
      if (
        response.status === "completed" &&
        response.modelId !== expectedActualModelId
      ) {
        throw new ModelProviderRequestError(
          "OPENAI_MODEL_ID_MISMATCH",
          "OpenAI-compatible response model did not match the approved model.",
          {
            retryable: false,
            ...(response.requestId === undefined
              ? {}
              : { providerRequestId: response.requestId }),
          },
        );
      }
      return response;
    },
  };
}

export function createLocalDevOpenAIProvider(
  config: CliConfig,
  environment: NodeJS.ProcessEnv = process.env,
  modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url))),
): ModelProvider {
  if (environment["AHAMED_CLI_LOCAL_DEV_REMOTE"] !== "1") {
    throw new CliConfigurationError(
      "本机远程测试必须显式设置 AHAMED_CLI_LOCAL_DEV_REMOTE=1。",
    );
  }
  if (config.providerName !== "openai") {
    throw new CliConfigurationError("cli:local-dev 仅支持 openai provider。");
  }
  let runtime;
  try {
    runtime = resolveOpenAIRuntimeConfig(environment);
  } catch (error) {
    throw new CliConfigurationError(
      error instanceof Error ? error.message : "远程 Provider 配置无效。",
    );
  }
  if (runtime.isOfficial) {
    throw new CliConfigurationError(
      "本机开发入口只允许 Phase 8 已批准的第三方 OpenAI-compatible 端点。",
    );
  }
  const approved = approvedProviderFromManifest(modelRoot);
  if (
    approved.protocol !== "openai-responses" ||
    runtime.providerName !== approved.providerName ||
    runtime.endpointSha256 !== approved.endpointSha256 ||
    config.modelId !== approved.configuredModelId ||
    config.modelId !== approved.actualModelId
  ) {
    throw new CliConfigurationError(
      "本机远程测试配置与 Phase 8 批准的 Provider、端点或模型不一致。",
    );
  }
  const transport = new OpenAICompatibleResponsesTransport({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseURL,
  });
  return new OpenAIModelProvider({
    modelId: config.modelId,
    promptVersion: "v0.2.0",
    promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
    transport: pinLocalDevActualModel(transport, approved.actualModelId),
  });
}
