import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { ModelService, type IdGenerator } from "./model-service.js";
import {
  MemoryEventSink,
  type EventSink,
} from "../observability/event-sink.js";
import { DeterministicModelProvider } from "../providers/deterministic-model-provider.js";
import type { ModelProvider } from "../providers/model-provider.js";
import { InMemoryCaseRepository } from "../repositories/case-repository.js";

export function createHeadlessModelService(options: {
  cases: CasePackage[];
  provider?: ModelProvider;
  eventSink?: EventSink;
  ids?: IdGenerator;
}): ModelService {
  for (const casePackage of options.cases) {
    assertCasePackage(casePackage);
  }

  return new ModelService(
    new InMemoryCaseRepository(options.cases),
    options.provider ?? new DeterministicModelProvider(),
    options.eventSink ?? new MemoryEventSink(),
    options.ids,
  );
}
