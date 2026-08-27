import type { CasePackage } from "../domain/case-package.js";
import type { ModelProvider } from "../providers/model-provider.js";
import {
  runProviderC01LiveEval,
  type ProviderLiveEvalReport,
} from "./openai-live-eval.js";

export interface AnthropicLiveEvalReport extends ProviderLiveEvalReport {
  schemaVersion: "anthropic-c01-live-eval-v1";
}

export async function runAnthropicC01LiveEval(options: {
  casePackage: CasePackage;
  provider: ModelProvider;
}): Promise<AnthropicLiveEvalReport> {
  const report = await runProviderC01LiveEval({
    ...options,
    schemaVersion: "anthropic-c01-live-eval-v1",
    validateProvider(provider) {
      if (provider.identity.providerName !== "anthropic") {
        throw new TypeError(
          "The Claude live eval requires an Anthropic Messages provider.",
        );
      }
    },
  });
  return report as AnthropicLiveEvalReport;
}
