import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
  OpenAIModelProvider,
  type OpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import {
  ModelProviderRequestError,
  type ModelProvider,
} from "../providers/model-provider.js";
import { CliConfigurationError, type CliConfig } from "./config.js";

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
  const transport = runtime.isOfficial
    ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
    : new OpenAICompatibleResponsesTransport({
        apiKey: runtime.apiKey,
        baseURL: runtime.baseURL,
      });
  return new OpenAIModelProvider({
    modelId: config.modelId,
    promptVersion: "v0.5.0",
    promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
    transport: pinLocalDevActualModel(transport, config.modelId),
  });
}
