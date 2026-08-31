import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import {
  ModelService,
  type IdGenerator,
  type ModelServiceOptions,
} from "./model-service.js";
import {
  MemoryEventSink,
  type EventSink,
} from "../observability/event-sink.js";
import { DeterministicModelProvider } from "../providers/deterministic-model-provider.js";
import type { CommunicationReviewProvider } from "../providers/communication-review-provider.js";
import type { ModelProvider } from "../providers/model-provider.js";
import { InMemoryCaseRepository } from "../repositories/case-repository.js";

export function createHeadlessModelService(options: {
  cases: CasePackage[];
  provider?: ModelProvider;
  communicationReviewer?: CommunicationReviewProvider;
  eventSink?: EventSink;
  ids?: IdGenerator;
  medicalSafetyPolicy?: ModelServiceOptions["medicalSafetyPolicy"];
  safetyAuditHmacKey?: string;
}): ModelService {
  for (const casePackage of options.cases) {
    assertCasePackageJsonSchema(casePackage);
    assertCasePackage(casePackage);
  }

  return new ModelService(
    new InMemoryCaseRepository(options.cases),
    options.provider ?? new DeterministicModelProvider(options.communicationReviewer),
    options.eventSink ?? new MemoryEventSink(),
    options.ids,
    {
      defaultIdempotencyScopeId: "headless.fixture",
      ...(options.medicalSafetyPolicy === undefined
        ? {}
        : { medicalSafetyPolicy: options.medicalSafetyPolicy }),
      ...(options.safetyAuditHmacKey === undefined
        ? {}
        : { safetyAuditHmacKey: options.safetyAuditHmacKey }),
    },
  );
}
