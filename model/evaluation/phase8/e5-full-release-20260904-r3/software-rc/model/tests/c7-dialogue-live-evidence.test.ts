import assert from "node:assert/strict";
import test from "node:test";

import {
  assertC7DialogueAuditModelBinding,
  collectC7ActualModelIds,
  countC7ProviderCalls,
  isC7ContextFollowupCorrect,
  type C7CommittedTurnEvidence,
  type C7PatientSessionSnapshot,
} from "../src/evaluation/c7-dialogue-live-runner.js";
import {
  assessC7BenchmarkTestJourney,
  type C7BenchmarkJourneyTurn,
} from "../src/release/c7-runtime-release.js";
import type { ModelEvent } from "../src/observability/event-sink.js";

const noTests: C7PatientSessionSnapshot = { completedTests: [] };
const ctPending: C7PatientSessionSnapshot = {
  pendingTestSuggestionId: "test.chest_ct",
  completedTests: [],
};
const ctCompleted: C7PatientSessionSnapshot = {
  completedTests: [
    {
      testId: "test.chest_ct",
      status: "completed",
      report: "胸部 CT 已完成。",
    },
  ],
};
const ctQuery: C7CommittedTurnEvidence = {
  interactionKind: "test_query",
  disclosedFactIds: [],
  completedTestIdsUsed: [],
  effects: [],
};
const ctConfirmation: C7CommittedTurnEvidence = {
  interactionKind: "test_order",
  disclosedFactIds: [],
  completedTestIdsUsed: [],
  effects: [
    {
      type: "test_completed",
      result: { testId: "test.chest_ct", status: "completed" },
    },
  ],
};
const vitalOrder: C7CommittedTurnEvidence = {
  interactionKind: "test_order",
  disclosedFactIds: [],
  completedTestIdsUsed: [],
  effects: [
    {
      type: "test_completed",
      result: { testId: "test.vital_signs", status: "completed" },
    },
  ],
};
const ctResult: C7CommittedTurnEvidence = {
  interactionKind: "test_query",
  disclosedFactIds: [],
  completedTestIdsUsed: ["test.chest_ct"],
  effects: [],
};

function assessCt(input: {
  querySnapshot?: C7PatientSessionSnapshot;
  confirmationSnapshot?: C7PatientSessionSnapshot;
  resultQuerySnapshot?: C7PatientSessionSnapshot;
  resultQueryReply?: string;
  vitalInteractionKind?: string;
  confirmationInteractionKind?: string;
  resultInteractionKind?: string;
}) {
  const turn = (
    evidence: C7CommittedTurnEvidence,
    sessionSnapshotBeforeTurn: C7PatientSessionSnapshot,
    reply = "",
  ): C7BenchmarkJourneyTurn => ({
    ...evidence,
    sessionSnapshotBeforeTurn,
    reply,
  });
  const turns = Array.from({ length: 12 }, () =>
    turn(ctQuery, noTests)) as C7BenchmarkJourneyTurn[];
  turns[8] = turn({
    ...vitalOrder,
    interactionKind: input.vitalInteractionKind ?? vitalOrder.interactionKind,
  }, noTests);
  turns[9] = turn(ctQuery, input.querySnapshot ?? noTests);
  turns[10] = turn({
    ...ctConfirmation,
    interactionKind:
      input.confirmationInteractionKind ?? ctConfirmation.interactionKind,
  }, input.confirmationSnapshot ?? ctPending);
  turns[11] = turn(
    {
      ...ctResult,
      interactionKind: input.resultInteractionKind ?? ctResult.interactionKind,
    },
    input.resultQuerySnapshot ?? ctCompleted,
    input.resultQueryReply ?? "胸部 CT 已完成。",
  );
  return assessC7BenchmarkTestJourney({ testId: "test.chest_ct", turns });
}

test("C7 CT tri-state is derived from real snapshots and committed effects", () => {
  const result = assessCt({});

  assert.deepEqual(result.observedTestStates, [
    "not_completed",
    "pending_confirmation",
    "completed",
  ]);
  assert.equal(result.testActionsEvaluated, 4);
  assert.equal(result.testActionsCorrect, 4);
});

test("C7 CT pending confirmation rejects a missing or different suggestion ID", () => {
  for (const confirmationSnapshot of [
    noTests,
    { pendingTestSuggestionId: "test.vital_signs", completedTests: [] },
  ] satisfies C7PatientSessionSnapshot[]) {
    const result = assessCt({ confirmationSnapshot });
    assert.deepEqual(result.observedTestStates, ["not_completed", "completed"]);
    assert.equal(result.testActionsCorrect, 2);
  }
});

test("C7 does not claim not-completed when CT was already in the query snapshot", () => {
  const result = assessCt({ querySnapshot: ctCompleted });

  assert.doesNotMatch(result.observedTestStates.join(","), /not_completed/u);
  assert.equal(result.testActionsCorrect, 3);
});

test("C7 completed CT action accepts a natural paraphrase bound to the completed test", () => {
  const result = assessCt({ resultQueryReply: "检查做完了。" });

  assert.equal(result.observedTestStates.includes("completed"), true);
  assert.equal(result.testActionsCorrect, 4);
  assert.equal(
    assessCt({ resultInteractionKind: "medical_chat" }).testActionsCorrect,
    4,
  );
});

test("C7 test actions reject effects or reports committed under the wrong interaction kind", () => {
  for (const input of [
    { vitalInteractionKind: "medical_chat" },
    { confirmationInteractionKind: "social_chat" },
    { resultInteractionKind: "social_chat" },
    { resultInteractionKind: "test_order" },
  ]) {
    assert.equal(assessCt(input).testActionsCorrect, 3);
  }
});

test("C7 context follow-up must reuse the most recently disclosed fact", () => {
  assert.equal(
    isC7ContextFollowupCorrect({
      expectedRecentFactIds: ["fact.chief_complaint"],
      committedTurn: {
        ...ctResult,
        interactionKind: "medical_chat",
        disclosedFactIds: ["fact.chief_complaint"],
      },
    }),
    true,
  );
  assert.equal(
    isC7ContextFollowupCorrect({
      expectedRecentFactIds: ["fact.chief_complaint"],
      committedTurn: {
        ...ctResult,
        disclosedFactIds: ["fact.unrelated"],
      },
    }),
    false,
  );
  assert.equal(
    isC7ContextFollowupCorrect({
      expectedRecentFactIds: [],
      committedTurn: {
        ...ctResult,
        disclosedFactIds: ["fact.any"],
      },
    }),
    false,
  );
});

test("C7 dialogue audit model binding rejects any validator model drift", () => {
  assert.doesNotThrow(() =>
    assertC7DialogueAuditModelBinding(
      [{ modelId: "gpt-release" }, { modelId: "gpt-release" }],
      "gpt-release",
    ),
  );
  assert.throws(
    () =>
      assertC7DialogueAuditModelBinding(
        [{ modelId: "gpt-release" }, { modelId: "gpt-drift" }],
        "gpt-release",
      ),
    /model ID drifted/u,
  );
  assert.throws(
    () => assertC7DialogueAuditModelBinding([], "gpt-release"),
    /model ID drifted/u,
  );
  assert.doesNotThrow(() => assertC7DialogueAuditModelBinding(
    [{ modelId: "gpt-release-snapshot", runStatus: "failed_to_run", subcallCount: 1 }],
    "gpt-release",
    "gpt-release-snapshot",
  ));
  assert.throws(
    () => assertC7DialogueAuditModelBinding(
      [{ modelId: "gpt-release", runStatus: "failed_to_run", subcallCount: 1 }],
      "gpt-release",
      "gpt-release-snapshot",
    ),
    /model ID drifted/u,
  );
});

test("C7 Provider call accounting includes failed logical calls while generated replies require completion", () => {
  const events = [
    {
      eventType: "provider.call.failed",
      payload: {
        role: "patient",
        attemptCount: 2,
        modelId: "model-snapshot-malformed",
        responseStatus: "completed",
      },
    },
    {
      eventType: "provider.call.completed",
      payload: { role: "patient", attemptCount: 1, modelId: "model-snapshot-ok" },
    },
    {
      eventType: "provider.call.failed",
      payload: {
        role: "controller",
        attemptCount: 1,
        modelId: "configured-model",
        responseStatus: null,
      },
    },
  ].map((event, index): ModelEvent => ({
    eventId: `event-${index}`,
    sessionId: "session-c7-accounting",
    sequence: index + 1,
    emittedAt: "2026-09-04T00:00:00.000Z",
    ...event,
  }));

  assert.equal(countC7ProviderCalls(events, "patient"), 2);
  assert.equal(countC7ProviderCalls(events, "patient", ["completed"]), 1);
  assert.equal(countC7ProviderCalls(events, "controller"), 1);
  assert.deepEqual(
    collectC7ActualModelIds(events, "patient"),
    ["model-snapshot-malformed", "model-snapshot-ok"],
  );
  assert.deepEqual(collectC7ActualModelIds(events, "controller"), []);
});
