import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import type { Clock } from "../domain/session.js";
import { MemoryEventSink, type EventSink } from "../observability/event-sink.js";
import { SqliteModelPersistence } from "../persistence/sqlite/sqlite-model-persistence.js";
import type { CommunicationReviewProvider } from "../providers/communication-review-provider.js";
import { DeterministicModelProvider } from "../providers/deterministic-model-provider.js";
import type { ModelProvider } from "../providers/model-provider.js";
import { InMemoryCaseRepository } from "../repositories/case-repository.js";
import {
  ModelService,
  type IdGenerator,
  type ModelServiceOptions,
} from "./model-service.js";

export function createSqliteModelService(options: {
  databasePath: string;
  cases: CasePackage[];
  provider?: ModelProvider;
  communicationReviewer?: CommunicationReviewProvider;
  eventSink?: EventSink;
  ids?: IdGenerator;
  clock?: Clock;
  medicalSafetyPolicy?: ModelServiceOptions["medicalSafetyPolicy"];
  safetyAuditHmacKey: string;
}): ModelService {
  if (
    typeof options.safetyAuditHmacKey !== "string" ||
    options.safetyAuditHmacKey.trim().length < 32
  ) {
    throw new TypeError(
      "safetyAuditHmacKey must be a stable secret of at least 32 characters.",
    );
  }
  const safetyAuditHmacKey = options.safetyAuditHmacKey.trim();
  for (const casePackage of options.cases) {
    assertCasePackageJsonSchema(casePackage);
    assertCasePackage(casePackage);
  }

  const provider = options.provider ??
    new DeterministicModelProvider(options.communicationReviewer);
  const serviceOptions: ModelServiceOptions = {
    persistence: new SqliteModelPersistence(options.databasePath),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.medicalSafetyPolicy === undefined
      ? {}
      : { medicalSafetyPolicy: options.medicalSafetyPolicy }),
    safetyAuditHmacKey,
  };
  return new ModelService(
    new InMemoryCaseRepository(options.cases),
    provider,
    options.eventSink ?? new MemoryEventSink(),
    options.ids,
    serviceOptions,
  );
}
