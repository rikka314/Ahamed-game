import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqliteModelService as createSqliteModelServiceWithKey } from "../src/application/create-sqlite-model-service.js";
import { runOpsCli } from "../src/ops/runner.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const TEST_SAFETY_AUDIT_HMAC_KEY =
  "phase7-test-only-stable-hmac-key-000000000000";

type SqliteServiceOptions = Parameters<typeof createSqliteModelServiceWithKey>[0];

function createSqliteModelService(
  options: Omit<SqliteServiceOptions, "safetyAuditHmacKey">,
) {
  return createSqliteModelServiceWithKey({
    ...options,
    safetyAuditHmacKey: TEST_SAFETY_AUDIT_HMAC_KEY,
  });
}

test("ops inspect prints a redacted session summary", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-ops-"));
  const databasePath = join(directory, "model.sqlite");
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const service = createSqliteModelService({
    databasePath,
    cases: [createCaseFixture()],
    clock: { now: () => new Date("2026-08-01T00:00:00.000Z") },
  });
  const created = await service.createSession({
    patientNpcId: "npc_fixture_patient",
    publicCaseId: createCaseFixture().publicCaseId,
    clientRequestId: "request.ops.inspect",
    idempotencyScopeId: "ops.fixture",
  });
  service.close();

  const output: string[] = [];
  const exitCode = await runOpsCli(
    [
      "inspect",
      "--database",
      databasePath,
      "--session",
      created.session.sessionId,
    ],
    (line: string) => output.push(line),
  );

  assert.equal(exitCode, 0);
  const summary = JSON.parse(output.join("\n")) as Record<string, unknown>;
  assert.equal(summary["sessionId"], created.session.sessionId);
  assert.equal(summary["sessionPhase"], "active");
  assert.equal(summary["turnCount"], 0);
  assert.equal("turns" in summary, false);
  assert.equal("diagnosisSubmission" in summary, false);
});

test("ops CLI help documents explicit recovery metadata", async () => {
  const output: string[] = [];
  const exitCode = await runOpsCli(["recover", "--help"], (line: string) =>
    output.push(line),
  );

  assert.equal(exitCode, 0);
  assert.match(output.join("\n"), /--operator/);
  assert.match(output.join("\n"), /--reason/);
  assert.match(output.join("\n"), /--retry-same-provider/);
});

test("ops inspect never creates a database for a misspelled path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ahamed-ops-missing-"));
  const databasePath = join(directory, "missing.sqlite");
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const errors: string[] = [];

  const exitCode = await runOpsCli(
    ["inspect", "--database", databasePath, "--session", "session.missing"],
    () => undefined,
    (line: string) => errors.push(line),
  );

  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /not found/i);
  await assert.rejects(
    import("node:fs/promises").then(({ access }) => access(databasePath)),
  );
});
