import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelService } from "../application/model-service.js";
import { MemoryEventSink } from "../observability/event-sink.js";
import { DeterministicModelProvider } from "../providers/deterministic-model-provider.js";
import { FileCaseRepository } from "../repositories/file-case-repository.js";

const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const eventSink = new MemoryEventSink();
const service = new ModelService(
  new FileCaseRepository([
    resolve(modelRoot, "cases/fixtures/case-fixture-001.json"),
  ]),
  new DeterministicModelProvider(),
  eventSink,
);

const created = await service.createSession({
  clientRequestId: "headless-create-1",
  publicCaseId: "case_fixture_001",
  patientNpcId: "npc_headless_fixture",
});
const turn = await service.askPatient({
  sessionId: created.session.sessionId,
  clientTurnId: "headless-turn-1",
  text: "When did it start?",
});
const testResult = await service.orderTest({
  sessionId: created.session.sessionId,
  clientRequestId: "headless-test-1",
  testId: "test.basic_panel",
});
const evaluation = await service.submitDiagnosis({
  sessionId: created.session.sessionId,
  clientRequestId: "headless-diagnosis-1",
  primaryDiagnosis: "Synthetic Fixture Syndrome",
  differentials: ["Example Condition"],
});

process.stdout.write(
  `${JSON.stringify(
    {
      session: created.session,
      turn,
      test: testResult,
      evaluation: {
        diagnosis: evaluation.diagnosis,
        scores: evaluation.scores,
        evidence: evaluation.evidence,
        evaluationVersion: evaluation.evaluationVersion,
      },
      eventTypes: eventSink
        .list(created.session.sessionId)
        .map(({ eventType }) => eventType),
    },
    null,
    2,
  )}\n`,
);
