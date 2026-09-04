import type { DatabaseSync } from "node:sqlite";

export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "phase2_model_persistence",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        patient_npc_id TEXT NOT NULL,
        user_id TEXT,
        public_case_id TEXT NOT NULL,
        case_version TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        evaluation_version TEXT NOT NULL,
        session_phase TEXT NOT NULL,
        turn_count INTEGER NOT NULL,
        event_sequence INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        active_operation_id TEXT,
        failure_code TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        client_turn_id TEXT NOT NULL,
        text TEXT NOT NULL,
        reply TEXT NOT NULL,
        disclosed_fact_ids_json TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, turn_number),
        UNIQUE(session_id, client_turn_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS disclosed_facts (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        fact_id TEXT NOT NULL,
        display_text TEXT NOT NULL,
        disclosed_at_turn INTEGER NOT NULL,
        PRIMARY KEY(session_id, fact_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS completed_tests (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        test_id TEXT NOT NULL,
        status TEXT NOT NULL,
        report TEXT,
        asset_id TEXT,
        reason_code TEXT,
        PRIMARY KEY(session_id, test_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS diagnosis_submissions (
        submission_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        primary_diagnosis TEXT NOT NULL,
        differentials_json TEXT NOT NULL,
        accepted_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS evaluations (
        session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
        evaluation_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS idempotency_records (
        scope_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        operation_id TEXT,
        response_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        retain_until TEXT NOT NULL,
        PRIMARY KEY(scope_id, operation, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idempotency_retain_until_idx
        ON idempotency_records(retain_until);

      CREATE TABLE IF NOT EXISTS operation_journal (
        operation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        case_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        provider_request_id TEXT,
        buffer_json TEXT,
        failure_code TEXT,
        operator TEXT,
        recovery_reason TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS operation_journal_session_idx
        ON operation_journal(session_id, created_at);
      CREATE INDEX IF NOT EXISTS operation_journal_status_idx
        ON operation_journal(status);

      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        emitted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS model_calls (
        model_call_id TEXT PRIMARY KEY,
        operation_id TEXT REFERENCES operation_journal(operation_id) ON DELETE SET NULL,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        role TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        provider_request_id TEXT,
        latency_ms INTEGER,
        usage_json TEXT,
        attempt_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        failure_code TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "operation_recovery_lease",
    sql: `
      ALTER TABLE operation_journal ADD COLUMN lease_token TEXT;
      ALTER TABLE operation_journal ADD COLUMN lease_expires_at TEXT;
    `,
  },
  {
    version: 3,
    name: "preserve_session_projection_order",
    sql: `
      ALTER TABLE disclosed_facts
        ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE completed_tests
        ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;

      UPDATE disclosed_facts AS target
      SET ordinal = (
        SELECT COUNT(*) - 1
        FROM disclosed_facts AS preceding
        WHERE preceding.session_id = target.session_id
          AND (
            preceding.disclosed_at_turn < target.disclosed_at_turn
            OR (
              preceding.disclosed_at_turn = target.disclosed_at_turn
              AND preceding.fact_id <= target.fact_id
            )
          )
      );

      UPDATE completed_tests AS target
      SET ordinal = (
        SELECT COUNT(*) - 1
        FROM completed_tests AS preceding
        WHERE preceding.session_id = target.session_id
          AND preceding.test_id <= target.test_id
      );

      CREATE UNIQUE INDEX disclosed_facts_session_ordinal_idx
        ON disclosed_facts(session_id, ordinal);
      CREATE UNIQUE INDEX completed_tests_session_ordinal_idx
        ON completed_tests(session_id, ordinal);
    `,
  },
  {
    version: 4,
    name: "persist_turn_classification_and_efficiency_counts",
    sql: `
      ALTER TABLE sessions
        ADD COLUMN medical_turn_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions
        ADD COLUMN repeat_turn_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions
        ADD COLUMN other_turn_count INTEGER NOT NULL DEFAULT 0;
      UPDATE sessions SET medical_turn_count = turn_count;

      ALTER TABLE turns
        ADD COLUMN action TEXT NOT NULL DEFAULT 'ask_patient';
      ALTER TABLE turns
        ADD COLUMN requested_fact_ids_json TEXT NOT NULL DEFAULT '[]';
      UPDATE turns
      SET requested_fact_ids_json = disclosed_fact_ids_json;
    `,
  },
  {
    version: 5,
    name: "persist_bounded_turn_attempt_budget",
    sql: `
      ALTER TABLE sessions
        ADD COLUMN turn_attempt_count INTEGER NOT NULL DEFAULT 0;
      UPDATE sessions
      SET turn_attempt_count = MAX(
        medical_turn_count + other_turn_count,
        (
          SELECT COUNT(*)
          FROM operation_journal
          WHERE operation_journal.session_id = sessions.session_id
            AND operation_journal.kind = 'turn'
        )
      );
    `,
  },
  {
    version: 6,
    name: "persist_dialogue_tool_effects_and_confirmation_state",
    sql: `
      ALTER TABLE sessions
        ADD COLUMN consecutive_off_topic_turns INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions
        ADD COLUMN pending_test_suggestion_id TEXT;
      ALTER TABLE sessions
        ADD COLUMN interaction_kind TEXT;

      ALTER TABLE turns
        ADD COLUMN interaction_kind TEXT NOT NULL DEFAULT 'medical_chat';
      ALTER TABLE turns
        ADD COLUMN fact_ids_used_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE turns
        ADD COLUMN persona_fact_ids_used_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE turns
        ADD COLUMN completed_test_ids_used_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE turns
        ADD COLUMN effects_json TEXT NOT NULL DEFAULT '[]';

      UPDATE turns
      SET interaction_kind = CASE
        WHEN action = 'other' THEN 'social_chat'
        ELSE 'medical_chat'
      END,
      fact_ids_used_json = disclosed_fact_ids_json;
    `,
  },
];

export function applySqliteMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const hasMigration = database.prepare(
    "SELECT 1 AS applied FROM schema_migrations WHERE version = ?",
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of SQLITE_MIGRATIONS) {
    if (hasMigration.get(migration.version) !== undefined) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      recordMigration.run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
