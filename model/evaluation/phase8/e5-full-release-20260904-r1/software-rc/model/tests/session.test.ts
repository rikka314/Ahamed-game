import assert from "node:assert/strict";
import test from "node:test";

import { ModelServiceError } from "../src/domain/errors.js";
import {
  SESSION_TTL_MS,
  assertSessionAcceptsWrites,
  createSessionAggregate,
  expireSessionIfNeeded,
  transitionSession,
  type SessionAggregate,
} from "../src/domain/session.js";

function createSession(): SessionAggregate {
  return createSessionAggregate({
    sessionId: "session_state_machine_001",
    patientNpcId: "npc_state_machine_001",
    publicCaseId: "case_state_machine_001",
    caseVersion: "1.0.0",
    evaluationVersion: "scoring-policy-v1",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

test("session aggregate freezes defaults, optional identity fields, and the original TTL", () => {
  const defaults = createSession();
  assert.equal(defaults.providerName, "deterministic");
  assert.equal(defaults.modelId, "deterministic-v1");
  assert.equal(defaults.promptVersion, "v0.1.0");
  assert.equal(
    Date.parse(defaults.expiresAt) - Date.parse(defaults.createdAt),
    SESSION_TTL_MS,
  );
  assert.equal("userId" in defaults, false);

  const explicit = createSessionAggregate({
    sessionId: "session_state_machine_002",
    patientNpcId: "npc_state_machine_002",
    userId: "user_state_machine_001",
    publicCaseId: "case_state_machine_001",
    caseVersion: "1.0.0",
    providerName: "openai",
    modelId: "candidate-model",
    promptVersion: "patient-v1",
    evaluationVersion: "scoring-policy-v1",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(explicit.userId, "user_state_machine_001");
  assert.equal(explicit.providerName, "openai");
  assert.equal(explicit.modelId, "candidate-model");
  assert.equal(explicit.promptVersion, "patient-v1");
});

test("session transitions are idempotent for the same phase and reject undeclared edges", () => {
  const session = createSession();
  transitionSession(session, "created");
  assert.equal(session.revision, 0);

  transitionSession(session, "active");
  assert.equal(session.sessionPhase, "active");
  assert.equal(session.revision, 1);

  assert.throws(
    () => transitionSession(session, "completed"),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "INVALID_SESSION_STATE",
  );
});

test("expiration skips terminal or live sessions and expires an overdue writable session", () => {
  const live = createSession();
  transitionSession(live, "active");
  assert.equal(expireSessionIfNeeded(live, new Date("2026-01-07T23:59:59.999Z")), false);

  for (const phase of ["completed", "expired", "cancelled", "failed"] as const) {
    const terminal = createSession();
    terminal.sessionPhase = phase;
    assert.equal(expireSessionIfNeeded(terminal, new Date("2026-01-09T00:00:00.000Z")), false);
  }

  assert.equal(expireSessionIfNeeded(live, new Date("2026-01-08T00:00:00.000Z")), true);
  assert.equal(live.sessionPhase, "expired");
});

test("write acceptance distinguishes active, expired, cancelled, and other phases", () => {
  const session = createSession();
  transitionSession(session, "active");
  assert.doesNotThrow(() => assertSessionAcceptsWrites(session));

  for (const [phase, code] of [
    ["expired", "SESSION_EXPIRED"],
    ["cancelled", "SESSION_CANCELLED"],
    ["created", "INVALID_SESSION_STATE"],
  ] as const) {
    session.sessionPhase = phase;
    assert.throws(
      () => assertSessionAcceptsWrites(session),
      (error: unknown) => error instanceof ModelServiceError && error.code === code,
    );
  }
});
