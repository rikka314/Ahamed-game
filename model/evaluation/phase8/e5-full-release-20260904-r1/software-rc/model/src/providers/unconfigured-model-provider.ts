import type {
  ControllerDecision,
  ControllerInput,
  EvaluationInput,
  ModelProvider,
  ModelProviderIdentity,
  PatientInput,
  PatientReply,
  ProviderMedicalEvaluation,
} from "./model-provider.js";
import { ModelProviderRequestError } from "./model-provider.js";

export class UnconfiguredModelProvider implements ModelProvider {
  readonly identity: ModelProviderIdentity = Object.freeze({
    providerName: "unconfigured",
    modelId: "unconfigured",
    promptVersion: "unconfigured",
  });

  private unavailable(): never {
    throw new ModelProviderRequestError(
      "MODEL_PROVIDER_NOT_CONFIGURED",
      "A real Patient Agent provider is required.",
      { retryable: false },
    );
  }

  async classifyTurn(_input: ControllerInput): Promise<ControllerDecision> {
    return this.unavailable();
  }

  async generatePatientReply(_input: PatientInput): Promise<PatientReply> {
    return this.unavailable();
  }

  async evaluate(
    _input: EvaluationInput & { operationId: string },
  ): Promise<ProviderMedicalEvaluation> {
    return this.unavailable();
  }
}
