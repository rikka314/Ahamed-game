import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createSessionAggregate } from "../src/domain/session.js";
import { InMemoryModelPersistence } from "../src/persistence/memory/in-memory-model-persistence.js";
import type {
  IdempotencyRecord,
  OperationJournalRecord,
  PersistenceTransaction,
} from "../src/persistence/ports.js";
import { SqliteModelPersistence } from "../src/persistence/sqlite/sqlite-model-persistence.js";
import { SQLITE_MIGRATIONS } from "../src/persistence/sqlite/migrations.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

function createSession(sessionId: string) {
  const fixture = createCaseFixture();
  return createSessionAggregate({
    sessionId,
    patientNpcId: "npc_fixture_patient",
    publicCaseId: fixture.publicCaseId,
    caseVersion: fixture.caseVersion,
    evaluationVersion: fixture.evaluationVersion,
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
}

const cleanupByTest = new WeakMap<
  test.TestContext,
  { directories: string[]; resources: Array<{ close(): void }> }
>();

async function createDatabase(t: test.TestContext, prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const databasePath = join(directory, "model.sqlite");
  let cleanup = cleanupByTest.get(t);
  if (cleanup === undefined) {
    cleanup = { directories: [], resources: [] };
    cleanupByTest.set(t, cleanup);
    t.after(async () => {
      for (const resource of [...(cleanup?.resources ?? [])].reverse()) {
        resource.close();
      }
      for (const path of cleanup?.directories ?? []) {
        await rm(path, { recursive: true, force: true });
      }
    });
  }
  cleanup.directories.push(directory);
  return databasePath;
}

function trackResource<T extends { close(): void }>(t: test.TestContext, resource: T): T {
  const cleanup = cleanupByTest.get(t);
  if (cleanup === undefined) {
    throw new Error("createDatabase must be called before trackResource.");
  }
  cleanup.resources.push(resource);
  return resource;
}

function createIdempotencyRecord(): IdempotencyRecord {
  return {
    scopeId: "session_corrupt",
    operation: "submit_turn",
    idempotencyKey: "request_1",
    requestHash: "hash_1",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    retainUntil: "2026-08-09T00:00:00.000Z",
  };
}

function createOperationRecord(): OperationJournalRecord {
  return {
    operationId: "operation_1",
    sessionId: "session_corrupt",
    idempotencyKey: "request_1",
    requestHash: "hash_1",
    kind: "turn",
    status: "response_validated",
    request: { text: "hello" },
    attemptCount: 1,
    providerName: "deterministic",
    modelId: "deterministic-v1",
    promptVersion: "v0.1.0",
    caseVersion: "1.0.0",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:01.000Z",
    buffer: {
      kind: "turn.v1",
      payload: { reply: "hello" },
      sha256: "buffer_hash",
      hmacSha256: `hmac-sha256:${"a".repeat(64)}`,
      validatedAt: "2026-08-01T00:00:01.000Z",
    },
    leaseToken: "lease_1",
    leaseExpiresAt: "2026-08-01T00:01:00.000Z",
  };
}

test("SQLite migrations are idempotent and create the Phase 2 tables", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-migration-"));
  const databasePath = join(directory, "model.sqlite");
  let database: DatabaseSync | undefined;
  t.after(async () => {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  });

  new SqliteModelPersistence(databasePath).close();
  new SqliteModelPersistence(databasePath).close();

  database = new DatabaseSync(databasePath, { readOnly: true });
  const migrations = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  const tables = new Set(
    (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map(({ name }) => name),
  );

  assert.deepEqual(
    migrations.map(({ version }) => version),
    [1, 2, 3, 4, 5, 6],
  );
  for (const table of [
    "sessions",
    "turns",
    "disclosed_facts",
    "completed_tests",
    "diagnosis_submissions",
    "evaluations",
    "idempotency_records",
    "operation_journal",
    "audit_events",
    "model_calls",
  ]) {
    assert.equal(tables.has(table), true, `missing table ${table}`);
  }
  const operationColumns = new Set(
    (
      database.prepare("PRAGMA table_info(operation_journal)").all() as Array<{
        name: string;
      }>
    ).map(({ name }) => name),
  );
  assert.equal(operationColumns.has("lease_token"), true);
  assert.equal(operationColumns.has("lease_expires_at"), true);
  for (const table of ["disclosed_facts", "completed_tests"]) {
    const tableInfo = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    const columns: Set<string> = new Set(tableInfo.map(({ name }) => name));
    assert.equal(columns.has("ordinal"), true, `missing ${table}.ordinal`);
  }
  const sessionColumns = new Set(
    (database.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>).map(({ name }) => name),
  );
  assert.equal(sessionColumns.has("consecutive_off_topic_turns"), true);
  assert.equal(sessionColumns.has("pending_test_suggestion_id"), true);
  assert.equal(sessionColumns.has("interaction_kind"), true);
  const turnColumns = new Set(
    (database.prepare("PRAGMA table_info(turns)").all() as Array<{
      name: string;
    }>).map(({ name }) => name),
  );
  for (const column of [
    "interaction_kind",
    "fact_ids_used_json",
    "persona_fact_ids_used_json",
    "completed_test_ids_used_json",
    "effects_json",
  ]) {
    assert.equal(turnColumns.has(column), true, `missing turns.${column}`);
  }
});

for (const legacyVersion of [1, 2]) {
test(`SQLite migration v6 upgrades an existing v${legacyVersion} database and preserves its deterministic projection`, async (t) => {
  const databasePath = await createDatabase(t, `ahamed-v${legacyVersion}-migration-`);
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  for (const migration of SQLITE_MIGRATIONS.filter(
    ({ version }) => version <= legacyVersion,
  )) {
    legacy.exec(migration.sql);
    legacy
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      )
      .run(migration.version, migration.name, "2026-08-01T00:00:00.000Z");
  }
  const legacySession = createSession(`session_legacy_v${legacyVersion}`);
  legacy
    .prepare(
      `INSERT INTO sessions (
        session_id, patient_npc_id, user_id, public_case_id, case_version,
        provider_name, model_id, prompt_version, evaluation_version,
        session_phase, turn_count, event_sequence, revision, created_at,
        expires_at, active_operation_id, failure_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      legacySession.sessionId,
      legacySession.patientNpcId,
      null,
      legacySession.publicCaseId,
      legacySession.caseVersion,
      legacySession.providerName,
      legacySession.modelId,
      legacySession.promptVersion,
      legacySession.evaluationVersion,
      legacySession.sessionPhase,
      legacySession.turnCount,
      legacySession.eventSequence,
      legacySession.revision,
      legacySession.createdAt,
      legacySession.expiresAt,
      null,
      null,
    );
  legacy
    .prepare(
      `INSERT INTO disclosed_facts
       (session_id, fact_id, display_text, disclosed_at_turn)
       VALUES (?, ?, ?, ?)`,
    )
    .run(legacySession.sessionId, "fact.z", "Z", 2);
  legacy
    .prepare(
      `INSERT INTO disclosed_facts
       (session_id, fact_id, display_text, disclosed_at_turn)
       VALUES (?, ?, ?, ?)`,
    )
    .run(legacySession.sessionId, "fact.a", "A", 1);
  legacy
    .prepare(
      `INSERT INTO completed_tests
       (session_id, test_id, status, report, asset_id, reason_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(legacySession.sessionId, "test.z", "completed", "Z", null, null);
  legacy
    .prepare(
      `INSERT INTO completed_tests
       (session_id, test_id, status, report, asset_id, reason_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(legacySession.sessionId, "test.a", "completed", "A", null, null);
  legacy.close();

  const persistence = trackResource(t, new SqliteModelPersistence(databasePath));
  const restored = persistence.transaction((transaction) =>
    transaction.sessions.get(legacySession.sessionId),
  );

  assert.deepEqual(restored?.disclosedFacts.map(({ factId }) => factId), [
    "fact.a",
    "fact.z",
  ]);
  assert.deepEqual(restored?.completedTests.map(({ testId }) => testId), [
    "test.a",
    "test.z",
  ]);
  assert.equal(restored?.turnAttemptCount, 0);
});
}

test("SQLite migration v6 reads historical v5 turns with safe dialogue defaults", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-v5-dialogue-migration-");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 5)) {
    legacy.exec(migration.sql);
    legacy.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migration.version, migration.name, "2026-08-01T00:00:00.000Z");
  }
  const session = createSession("session_legacy_dialogue_v5");
  legacy.prepare(
    `INSERT INTO sessions (
      session_id, patient_npc_id, user_id, public_case_id, case_version,
      provider_name, model_id, prompt_version, evaluation_version,
      session_phase, turn_count, medical_turn_count, repeat_turn_count,
      other_turn_count, turn_attempt_count, event_sequence, revision,
      created_at, expires_at, active_operation_id, failure_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.sessionId,
    session.patientNpcId,
    null,
    session.publicCaseId,
    session.caseVersion,
    session.providerName,
    session.modelId,
    session.promptVersion,
    session.evaluationVersion,
    "active",
    1,
    0,
    0,
    1,
    1,
    0,
    0,
    session.createdAt,
    session.expiresAt,
    null,
    null,
  );
  legacy.prepare(
    `INSERT INTO turns (
      turn_id, session_id, client_turn_id, text, reply,
      disclosed_fact_ids_json, action, requested_fact_ids_json,
      turn_number, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "turn_legacy_dialogue_v5",
    session.sessionId,
    "client_turn_legacy_dialogue_v5",
    "hello",
    "Hello, doctor.",
    "[]",
    "other",
    "[]",
    1,
    "2026-08-01T00:00:01.000Z",
  );
  legacy.close();

  const persistence = trackResource(t, new SqliteModelPersistence(databasePath));
  const restored = persistence.transaction((transaction) =>
    transaction.sessions.get(session.sessionId),
  );

  assert.equal(restored?.consecutiveOffTopicTurns, 0);
  assert.equal(restored?.pendingTestSuggestionId, undefined);
  assert.equal(restored?.interactionKind, undefined);
  assert.deepEqual(restored?.turns[0], {
    turnId: "turn_legacy_dialogue_v5",
    clientTurnId: "client_turn_legacy_dialogue_v5",
    text: "hello",
    reply: "Hello, doctor.",
    disclosedFactIds: [],
    action: "other",
    requestedFactIds: [],
    interactionKind: "social_chat",
    factIdsUsed: [],
    personaFactIdsUsed: [],
    completedTestIdsUsed: [],
    effects: [],
    turnNumber: 1,
    createdAt: "2026-08-01T00:00:01.000Z",
  });
});

test("SQLite round-trips disclosed facts and completed tests in aggregate array order", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-array-order-");
  const persistence = trackResource(t, new SqliteModelPersistence(databasePath));
  const session = createSession("session_array_order");
  session.disclosedFacts = [
    { factId: "fact.z", displayText: "Z", disclosedAtTurn: 1 },
    { factId: "fact.a", displayText: "A", disclosedAtTurn: 1 },
  ];
  session.completedTests = [
    { testId: "test.z", status: "completed", report: "Z" },
    { testId: "test.a", status: "completed", report: "A" },
  ];

  persistence.transaction((transaction) => transaction.sessions.save(session));
  persistence.close();
  const reopened = trackResource(t, new SqliteModelPersistence(databasePath));

  const restored = reopened.transaction((transaction) =>
    transaction.sessions.get(session.sessionId),
  );
  assert.deepEqual(restored?.disclosedFacts, session.disclosedFacts);
  assert.deepEqual(restored?.completedTests, session.completedTests);
});

test("SQLite transaction rolls back all writes when work fails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-rollback-"));
  const databasePath = join(directory, "model.sqlite");
  const persistence = new SqliteModelPersistence(databasePath);
  t.after(() => persistence.close());
  t.after(async () => rm(directory, { recursive: true, force: true }));

  assert.throws(
    () =>
      persistence.transaction((transaction) => {
        transaction.sessions.save(createSession("session_rollback"));
        throw new Error("force rollback");
      }),
    /force rollback/,
  );

  assert.equal(
    persistence.transaction((transaction) =>
      transaction.sessions.get("session_rollback"),
    ),
    undefined,
  );
});

test("in-memory adapter preserves the same rollback contract", () => {
  const persistence = new InMemoryModelPersistence();

  assert.throws(
    () =>
      persistence.transaction((transaction) => {
        transaction.sessions.save(createSession("session_memory_rollback"));
        throw new Error("force rollback");
      }),
    /force rollback/,
  );

  assert.equal(
    persistence.transaction((transaction) =>
      transaction.sessions.get("session_memory_rollback"),
    ),
    undefined,
  );
});

test("SQLite audit events are append-only", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-audit-"));
  const databasePath = join(directory, "model.sqlite");
  const persistence = new SqliteModelPersistence(databasePath);
  t.after(() => persistence.close());
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const session = createSession("session_audit_append_only");
  const first = {
    eventId: "event.audit.fixture",
    eventType: "fixture.first",
    sessionId: session.sessionId,
    sequence: 1,
    emittedAt: "2026-08-01T00:00:00.000Z",
    payload: { value: "first" },
  };

  persistence.transaction((transaction) => {
    transaction.sessions.save(session);
    transaction.events.append(first);
  });
  assert.throws(
    () =>
      persistence.transaction((transaction) => {
        transaction.events.append({
          ...first,
          eventType: "fixture.overwrite",
          payload: { value: "overwrite" },
        });
      }),
    /constraint/i,
  );
  assert.deepEqual(
    persistence.transaction((transaction) =>
      transaction.events.list(session.sessionId),
    ),
    [first],
  );
});

for (const [name, createPersistence] of [
  [
    "SQLite",
    async (t: test.TestContext) =>
      new SqliteModelPersistence(await createDatabase(t, "ahamed-transaction-")),
  ],
  [
    "in-memory",
    async (_t: test.TestContext) => new InMemoryModelPersistence(),
  ],
] as const) {
  test(`${name} rejects async transaction callbacks and rolls back their synchronous writes`, async (t) => {
    const persistence = await createPersistence(t);
    if (persistence instanceof SqliteModelPersistence) {
      trackResource(t, persistence);
    } else {
      t.after(() => persistence.close());
    }

    assert.throws(
      () =>
        persistence.transaction(async (transaction) => {
          transaction.sessions.save(createSession("session_async"));
          return "done";
        }),
      /synchronous callback/i,
    );
    assert.equal(
      persistence.transaction((transaction) =>
        transaction.sessions.get("session_async"),
      ),
      undefined,
    );
  });

  test(`${name} invalidates an escaped transaction handle`, async (t) => {
    const persistence = await createPersistence(t);
    if (persistence instanceof SqliteModelPersistence) {
      trackResource(t, persistence);
    } else {
      t.after(() => persistence.close());
    }
    let escaped: PersistenceTransaction | undefined;

    persistence.transaction((transaction) => {
      escaped = transaction;
    });

    assert.throws(
      () => escaped?.sessions.list(),
      /transaction is no longer active/i,
    );
  });
}

test("SQLite read-only mode neither migrates nor accepts writes", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-readonly-");
  new DatabaseSync(databasePath).close();

  const readOnly = new SqliteModelPersistence(databasePath, { readOnly: true });
  readOnly.close();

  const inspection = new DatabaseSync(databasePath);
  const tables = inspection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  assert.deepEqual(tables, []);
  inspection.close();

  new SqliteModelPersistence(databasePath).close();
  const persistence = trackResource(
    t,
    new SqliteModelPersistence(databasePath, { readOnly: true }),
  );
  assert.deepEqual(persistence.transaction((transaction) => transaction.sessions.list()), []);
  assert.throws(
    () =>
      persistence.transaction((transaction) => {
        transaction.sessions.save(createSession("session_readonly"));
      }),
    /read-only|readonly/i,
  );
});

test("SQLite closes its handle when migration setup fails", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-constructor-failure-");
  const malformed = new DatabaseSync(databasePath);
  malformed.exec("CREATE TABLE schema_migrations (wrong_column TEXT) STRICT");
  malformed.close();

  assert.throws(() => new SqliteModelPersistence(databasePath));

  const reopened = new DatabaseSync(databasePath);
  reopened.close();
});

test("SQLite rejects corrupted session scalar, enum, JSON array, and date fields", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-corrupt-session-");
  const persistence = trackResource(t, new SqliteModelPersistence(databasePath));
  persistence.transaction((transaction) => {
    const session = createSession("session_corrupt");
    session.turns.push({
      turnId: "turn_1",
      clientTurnId: "client_turn_1",
      text: "hello",
      reply: "hello",
      disclosedFactIds: ["fact_1"],
      action: "ask_patient",
      requestedFactIds: ["fact_1"],
      interactionKind: "medical_chat",
      factIdsUsed: ["fact_1"],
      personaFactIdsUsed: [],
      completedTestIdsUsed: [],
      effects: [],
      turnNumber: 1,
      createdAt: "2026-08-01T00:00:01.000Z",
    });
    transaction.sessions.save(session);
  });
  const raw = trackResource(t, new DatabaseSync(databasePath));

  for (const corruption of [
    {
      sql: "UPDATE sessions SET session_phase = 'corrupt' WHERE session_id = ?",
      restore: "UPDATE sessions SET session_phase = 'created' WHERE session_id = ?",
      pattern: /session_phase.*allowed values/i,
    },
    {
      sql: "UPDATE sessions SET turn_count = -1 WHERE session_id = ?",
      restore: "UPDATE sessions SET turn_count = 0 WHERE session_id = ?",
      pattern: /turn_count.*non-negative safe integer/i,
    },
    {
      sql: "UPDATE sessions SET turn_attempt_count = -1 WHERE session_id = ?",
      restore: "UPDATE sessions SET turn_attempt_count = 0 WHERE session_id = ?",
      pattern: /turn_attempt_count.*non-negative safe integer/i,
    },
    {
      sql: "UPDATE sessions SET expires_at = 'not-a-date' WHERE session_id = ?",
      restore: "UPDATE sessions SET expires_at = '2026-08-08T00:00:00.000Z' WHERE session_id = ?",
      pattern: /expires_at.*valid date/i,
    },
    {
      sql: "UPDATE turns SET disclosed_fact_ids_json = '{}' WHERE session_id = ?",
      restore: "UPDATE turns SET disclosed_fact_ids_json = '[\"fact_1\"]' WHERE session_id = ?",
      pattern: /disclosed_fact_ids_json.*array of strings/i,
    },
  ]) {
    raw.prepare(corruption.sql).run("session_corrupt");
    assert.throws(
      () =>
        persistence.transaction((transaction) =>
          transaction.sessions.get("session_corrupt"),
        ),
      corruption.pattern,
    );
    raw.prepare(corruption.restore).run("session_corrupt");
  }
});

test("SQLite rejects corrupted operation and idempotency enums and JSON objects", async (t) => {
  const databasePath = await createDatabase(t, "ahamed-corrupt-journal-");
  const persistence = trackResource(t, new SqliteModelPersistence(databasePath));
  persistence.transaction((transaction) => {
    transaction.sessions.save(createSession("session_corrupt"));
    transaction.idempotency.save(createIdempotencyRecord());
    transaction.operations.save(createOperationRecord());
  });
  assert.deepEqual(
    persistence.transaction((transaction) =>
      transaction.operations.get("operation_1"),
    )?.leaseToken,
    "lease_1",
  );
  const raw = trackResource(t, new DatabaseSync(databasePath));

  const corruptAndRestore = (
    sql: string,
    restore: string,
    read: () => unknown,
    pattern: RegExp,
  ) => {
    raw.exec(sql);
    assert.throws(read, pattern);
    raw.exec(restore);
  };

  corruptAndRestore(
    "UPDATE idempotency_records SET operation = 'corrupt'",
    "UPDATE idempotency_records SET operation = 'submit_turn'",
    () =>
      persistence.transaction((transaction) =>
        transaction.idempotency.get(
          "session_corrupt",
          "corrupt" as "submit_turn",
          "request_1",
        ),
      ),
    /operation.*allowed values/i,
  );
  corruptAndRestore(
    "UPDATE idempotency_records SET status = 'corrupt'",
    "UPDATE idempotency_records SET status = 'in_progress'",
    () =>
      persistence.transaction((transaction) =>
        transaction.idempotency.get("session_corrupt", "submit_turn", "request_1"),
      ),
    /status.*allowed values/i,
  );
  corruptAndRestore(
    "UPDATE operation_journal SET kind = 'corrupt'",
    "UPDATE operation_journal SET kind = 'turn'",
    () =>
      persistence.transaction((transaction) =>
        transaction.operations.get("operation_1"),
      ),
    /kind.*allowed values/i,
  );
  corruptAndRestore(
    "UPDATE operation_journal SET status = 'corrupt'",
    "UPDATE operation_journal SET status = 'response_validated'",
    () =>
      persistence.transaction((transaction) =>
        transaction.operations.get("operation_1"),
      ),
    /status.*allowed values/i,
  );
  corruptAndRestore(
    "UPDATE operation_journal SET request_json = '[]'",
    "UPDATE operation_journal SET request_json = '{\"text\":\"hello\"}'",
    () =>
      persistence.transaction((transaction) =>
        transaction.operations.get("operation_1"),
      ),
    /request_json.*JSON object/i,
  );
  corruptAndRestore(
    "UPDATE operation_journal SET buffer_json = '{\"kind\":\"turn.v1\"}'",
    `UPDATE operation_journal SET buffer_json = '{"kind":"turn.v1","payload":{"reply":"hello"},"sha256":"buffer_hash","validatedAt":"2026-08-01T00:00:01.000Z"}'`,
    () =>
      persistence.transaction((transaction) =>
        transaction.operations.get("operation_1"),
      ),
    /buffer_json.*validated operation buffer/i,
  );
  corruptAndRestore(
    "UPDATE operation_journal SET lease_expires_at = 'not-a-date'",
    "UPDATE operation_journal SET lease_expires_at = '2026-08-01T00:01:00.000Z'",
    () =>
      persistence.transaction((transaction) =>
        transaction.operations.get("operation_1"),
      ),
    /lease_expires_at.*valid date/i,
  );
});
