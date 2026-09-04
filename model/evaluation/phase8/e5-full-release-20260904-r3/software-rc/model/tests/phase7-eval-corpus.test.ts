import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  PHASE7_CASE_EVAL_CATEGORIES,
  PHASE7_EVAL_CORPUS,
  PHASE7_SAFETY_CATEGORIES,
} from "../src/evaluation/phase7-eval-corpus.js";

interface DraftFact {
  disclosure: "spontaneous" | "if_asked" | "test_only" | "hidden";
}

interface DraftCase {
  publicCaseId: string;
  patientFacts: Record<string, DraftFact>;
}

interface LaunchManifest {
  cases: Array<{ publicCaseId: string; path: string }>;
}

const launchManifest = JSON.parse(
  readFileSync(resolve("cases/manifest.phase6-compat.v2-rc9.json"), "utf8"),
) as LaunchManifest;
const draftPathByCaseId = new Map(
  launchManifest.cases.map(({ publicCaseId, path }) => [publicCaseId, path]),
);

test("Phase 7 corpus contains thirty development-only launch cases with exactly twenty Chinese items each", () => {
  assert.equal(PHASE7_EVAL_CORPUS.caseCorpora.length, 30);

  for (const caseCorpus of PHASE7_EVAL_CORPUS.caseCorpora) {
    assert.equal(caseCorpus.evidenceStatus, "development_only");
    assert.equal(caseCorpus.caseStatus, "structurally_ready_draft");
    assert.equal(caseCorpus.locale, "zh-CN");
    assert.equal(caseCorpus.items.length, 20);
    assert.ok(caseCorpus.askableFactIds.length > 0);
    assert.equal(
      new Set(caseCorpus.askableFactIds).size,
      caseCorpus.askableFactIds.length,
    );
    assert.deepEqual(
      new Set(caseCorpus.items.map(({ category }) => category)),
      new Set(PHASE7_CASE_EVAL_CATEGORIES),
    );
    for (const item of caseCorpus.items) {
      assert.equal(item.caseId, caseCorpus.caseId);
      assert.equal(item.evidenceStatus, "development_only");
      assert.equal(item.caseStatus, "structurally_ready_draft");
      assert.match(item.input, /\p{Script=Han}/u);
      for (const factId of item.expectedFactIds) {
        assert.ok(caseCorpus.askableFactIds.includes(factId));
      }
      if (
        ["standard", "synonym", "multi_question", "repeat"].includes(
          item.category,
        )
      ) {
        assert.equal(item.expectedAction, "ask_patient");
        assert.ok(item.expectedFactIds.length > 0);
      } else {
        assert.equal(item.expectedAction, "other");
        assert.deepEqual(item.expectedFactIds, []);
      }
    }

    const draftPath = draftPathByCaseId.get(caseCorpus.caseId);
    assert.ok(draftPath);
    const draft = JSON.parse(
      readFileSync(resolve("cases", draftPath), "utf8"),
    ) as DraftCase;
    assert.equal(draft.publicCaseId, caseCorpus.caseId);
    for (const factId of caseCorpus.askableFactIds) {
      const fact = draft.patientFacts[factId];
      assert.ok(fact, `${factId} must exist in ${caseCorpus.caseId}`);
      assert.notEqual(fact.disclosure, "hidden");
      assert.notEqual(fact.disclosure, "test_only");
    }
  }
});

test("Phase 7 corpus adds at least thirty Chinese adversarial items across all four required categories", () => {
  const safetyCorpus = PHASE7_EVAL_CORPUS.safetyCorpus;
  assert.equal(safetyCorpus.evidenceStatus, "development_only");
  assert.equal(safetyCorpus.caseStatus, "structurally_ready_draft");
  assert.ok(safetyCorpus.items.length >= 30);
  assert.deepEqual(
    new Set(safetyCorpus.items.map(({ category }) => category)),
    new Set(PHASE7_SAFETY_CATEGORIES),
  );
  for (const category of PHASE7_SAFETY_CATEGORIES) {
    assert.ok(
      safetyCorpus.items.filter((item) => item.category === category).length >= 1,
    );
  }
  for (const item of safetyCorpus.items) {
    assert.equal(item.evidenceStatus, "development_only");
    assert.equal(item.caseStatus, "structurally_ready_draft");
    assert.match(item.input, /\p{Script=Han}/u);
  }
});

test("Phase 7 corpus IDs are globally unique and repeat items bind to their own case", () => {
  const allItems = [
    ...PHASE7_EVAL_CORPUS.caseCorpora.flatMap(({ items }) => items),
    ...PHASE7_EVAL_CORPUS.safetyCorpus.items,
  ];
  assert.equal(new Set(allItems.map(({ itemId }) => itemId)).size, allItems.length);

  for (const caseCorpus of PHASE7_EVAL_CORPUS.caseCorpora) {
    const caseItemIds = new Set(caseCorpus.items.map(({ itemId }) => itemId));
    for (const item of caseCorpus.items) {
      if (item.category === "repeat") {
        assert.ok(item.repeatOfItemId);
        assert.ok(caseItemIds.has(item.repeatOfItemId));
        const repeated = caseCorpus.items.find(
          ({ itemId }) => itemId === item.repeatOfItemId,
        );
        assert.ok(repeated);
        assert.deepEqual(item.expectedFactIds, repeated.expectedFactIds);
      }
    }
  }
});
