import assert from "node:assert/strict";
import test from "node:test";

import {
  assessC7ChestCtJourney,
  assertC7DialogueAuditModelBinding,
  isC7ContextFollowupCorrect,
  type C7CommittedTurnEvidence,
  type C7PatientSessionSnapshot,
} from "../src/evaluation/c7-dialogue-live-runner.js";

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
const ctResult: C7CommittedTurnEvidence = {
  interactionKind: "medical_chat",
  disclosedFactIds: [],
  completedTestIdsUsed: ["test.chest_ct"],
  effects: [],
};

test("C7 CT tri-state is derived from real snapshots and committed effects", () => {
  const result = assessC7ChestCtJourney({
    querySnapshot: noTests,
    queryTurn: ctQuery,
    confirmationSnapshot: ctPending,
    confirmationTurn: ctConfirmation,
    resultQuerySnapshot: ctCompleted,
    resultQueryTurn: ctResult,
    resultQueryReply: "胸部 CT 已完成。",
  });

  assert.deepEqual(result.observedTestStates, [
    "not_completed",
    "pending_confirmation",
    "completed",
  ]);
  assert.equal(result.queryCorrect, true);
  assert.equal(result.confirmationCorrect, true);
  assert.equal(result.resultQueryCorrect, true);
});

test("C7 CT pending confirmation rejects a missing or different suggestion ID", () => {
  for (const confirmationSnapshot of [
    noTests,
    { pendingTestSuggestionId: "test.vital_signs", completedTests: [] },
  ] satisfies C7PatientSessionSnapshot[]) {
    const result = assessC7ChestCtJourney({
      querySnapshot: noTests,
      queryTurn: ctQuery,
      confirmationSnapshot,
      confirmationTurn: ctConfirmation,
      resultQuerySnapshot: ctCompleted,
      resultQueryTurn: ctResult,
      resultQueryReply: "胸部 CT 已完成。",
    });
    assert.deepEqual(result.observedTestStates, ["not_completed", "completed"]);
    assert.equal(result.queryCorrect, false);
    assert.equal(result.confirmationCorrect, false);
  }
});

test("C7 does not claim not-completed when CT was already in the query snapshot", () => {
  const result = assessC7ChestCtJourney({
    querySnapshot: ctCompleted,
    queryTurn: ctQuery,
    confirmationSnapshot: ctPending,
    confirmationTurn: ctConfirmation,
    resultQuerySnapshot: ctCompleted,
    resultQueryTurn: ctResult,
    resultQueryReply: "胸部 CT 已完成。",
  });

  assert.doesNotMatch(result.observedTestStates.join(","), /not_completed/u);
  assert.equal(result.queryCorrect, false);
});

test("C7 completed CT query requires the committed report text", () => {
  const result = assessC7ChestCtJourney({
    querySnapshot: noTests,
    queryTurn: ctQuery,
    confirmationSnapshot: ctPending,
    confirmationTurn: ctConfirmation,
    resultQuerySnapshot: ctCompleted,
    resultQueryTurn: ctResult,
    resultQueryReply: "检查做完了。",
  });

  assert.equal(result.observedTestStates.includes("completed"), true);
  assert.equal(result.resultQueryCorrect, false);
});

test("C7 context follow-up must reuse the most recently disclosed fact", () => {
  assert.equal(
    isC7ContextFollowupCorrect({
      expectedRecentFactIds: ["fact.chief_complaint"],
      committedTurn: {
        ...ctResult,
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
});
