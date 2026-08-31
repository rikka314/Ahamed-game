import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelService, type RecoveryAction } from "../application/model-service.js";
import { ModelServiceError } from "../domain/errors.js";
import { MemoryEventSink } from "../observability/event-sink.js";
import type { OperationJournalRecord } from "../persistence/ports.js";
import { SqliteModelPersistence } from "../persistence/sqlite/sqlite-model-persistence.js";
import {
  DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY,
  DeterministicModelProvider,
} from "../providers/deterministic-model-provider.js";
import { FileCaseRepository } from "../repositories/file-case-repository.js";

type WriteLine = (line: string) => void;

interface ParsedArguments {
  command?: string;
  flags: Set<string>;
  values: Map<string, string[]>;
}

const INSPECT_HELP = `Usage:
  npm run ops:inspect -- --database <path> --session <session-id>
  npm run ops:inspect -- --database <path> --operation <operation-id>`;

const RECOVER_HELP = `Usage:
  npm run ops:recover -- --database <path> --operation <operation-id> \\
    (--commit-buffered | --retry-same-provider | --fail) \\
    --operator <operator-id> --reason <audit-reason> [--case <case.json> ...]

Recovery is explicit and audited. Stop normal writers before recovery.
SAFETY_AUDIT_HMAC_KEY must contain the same stable secret used by the service.
--retry-same-provider is limited to the deterministic MVP provider identity,
the operation's recovery lease, and the remaining retry budget.`;

function parseArguments(args: string[]): ParsedArguments {
  const [command, ...tokens] = args;
  const parsed: ParsedArguments = {
    ...(command === undefined ? {} : { command }),
    flags: new Set(),
    values: new Map(),
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token ?? ""}`);
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed.flags.add(token);
      continue;
    }
    const values = parsed.values.get(token) ?? [];
    values.push(next);
    parsed.values.set(token, values);
    index += 1;
  }
  return parsed;
}

function valueOf(parsed: ParsedArguments, name: string): string | undefined {
  const values = parsed.values.get(name);
  if (!values || values.length === 0) return undefined;
  if (values.length > 1) {
    throw new Error(`${name} may be specified only once.`);
  }
  return values[0];
}

function requiredValue(parsed: ParsedArguments, name: string): string {
  const value = valueOf(parsed, name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function databasePath(
  parsed: ParsedArguments,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = valueOf(parsed, "--database") ?? environment["MODEL_SQLITE_PATH"];
  if (!configured?.trim()) {
    throw new Error("--database or MODEL_SQLITE_PATH is required.");
  }
  return resolve(configured);
}

function operationSummary(operation: OperationJournalRecord) {
  return {
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    kind: operation.kind,
    status: operation.status,
    attemptCount: operation.attemptCount,
    providerName: operation.providerName,
    modelId: operation.modelId,
    promptVersion: operation.promptVersion,
    caseVersion: operation.caseVersion,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    hasValidatedBuffer: operation.buffer !== undefined,
    ...(operation.buffer === undefined
      ? {}
      : {
          bufferKind: operation.buffer.kind,
          bufferSha256: operation.buffer.sha256,
          ...(operation.buffer.hmacSha256 === undefined
            ? { bufferIntegrity: "legacy_unsigned" }
            : { bufferHmacSha256: operation.buffer.hmacSha256 }),
          validatedAt: operation.buffer.validatedAt,
        }),
    ...(operation.failureCode === undefined
      ? {}
      : { failureCode: operation.failureCode }),
    ...(operation.operator === undefined ? {} : { operator: operation.operator }),
    ...(operation.recoveryReason === undefined
      ? {}
      : { recoveryReason: operation.recoveryReason }),
  };
}

function recoveryAction(parsed: ParsedArguments): RecoveryAction {
  const actions: ReadonlyArray<readonly [string, RecoveryAction]> = [
    ["--commit-buffered", "commit-buffered"],
    ["--retry-same-provider", "retry-same-provider"],
    ["--fail", "fail"],
  ];
  const selected = actions.filter(([flag]) => parsed.flags.has(flag));
  if (selected.length !== 1) {
    throw new Error("Select exactly one recovery action.");
  }
  return selected[0]![1];
}

function inspect(
  parsed: ParsedArguments,
  writeLine: WriteLine,
  environment: NodeJS.ProcessEnv,
): number {
  const sessionId = valueOf(parsed, "--session")?.trim();
  const operationId = valueOf(parsed, "--operation")?.trim();
  if ((sessionId ? 1 : 0) + (operationId ? 1 : 0) !== 1) {
    throw new Error("Select exactly one of --session or --operation.");
  }
  const path = databasePath(parsed, environment);
  if (!existsSync(path)) throw new Error("Database file was not found.");
  const persistence = new SqliteModelPersistence(path, { readOnly: true });
  try {
    const summary = persistence.transaction((transaction) => {
      if (operationId) {
        const operation = transaction.operations.get(operationId);
        if (!operation) throw new Error("Operation was not found.");
        return operationSummary(operation);
      }
      const session = transaction.sessions.get(sessionId!);
      if (!session) throw new Error("Session was not found.");
      return {
        sessionId: session.sessionId,
        sessionPhase: session.sessionPhase,
        publicCaseId: session.publicCaseId,
        caseVersion: session.caseVersion,
        evaluationVersion: session.evaluationVersion,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        revision: session.revision,
        turnCount: session.turnCount,
        disclosedFactCount: session.disclosedFacts.length,
        completedTestCount: session.completedTests.length,
        diagnosisSubmitted: session.diagnosisSubmission !== undefined,
        ...(session.activeOperationId === undefined
          ? {}
          : { activeOperationId: session.activeOperationId }),
        operations: transaction.operations
          .listForSession(session.sessionId)
          .map(operationSummary),
      };
    });
    writeLine(JSON.stringify(summary, null, 2));
    return 0;
  } finally {
    persistence.close();
  }
}

async function recover(
  parsed: ParsedArguments,
  writeLine: WriteLine,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const operationId = requiredValue(parsed, "--operation");
  const action = recoveryAction(parsed);
  const operator = requiredValue(parsed, "--operator");
  const reason = requiredValue(parsed, "--reason");
  const path = databasePath(parsed, environment);
  if (!existsSync(path)) throw new Error("Database file was not found.");
  const safetyAuditHmacKey = environment["SAFETY_AUDIT_HMAC_KEY"]?.trim();
  if (safetyAuditHmacKey === undefined || safetyAuditHmacKey.length < 32) {
    throw new Error(
      "SAFETY_AUDIT_HMAC_KEY must contain at least 32 characters for recovery.",
    );
  }

  const inspectionPersistence = new SqliteModelPersistence(path, {
    readOnly: true,
  });
  let operation: OperationJournalRecord | undefined;
  try {
    operation = inspectionPersistence.transaction((transaction) =>
      transaction.operations.get(operationId),
    );
  } finally {
    inspectionPersistence.close();
  }
  if (!operation) throw new Error("Operation was not found.");
  if (
    action === "retry-same-provider" &&
    (operation.providerName !==
      DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.providerName ||
      operation.modelId !==
        DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.modelId ||
      operation.promptVersion !==
        DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.promptVersion)
  ) {
    throw new Error(
      "This CLI cannot reconstruct the operation's original provider implementation.",
    );
  }

  const casePaths = parsed.values.get("--case")?.map((item) => resolve(item)) ?? [
    resolve("cases/fixtures/case-fixture-001.json"),
  ];
  const service = new ModelService(
    new FileCaseRepository(casePaths),
    new DeterministicModelProvider(),
    new MemoryEventSink(),
    undefined,
    {
      persistence: new SqliteModelPersistence(path),
      recoverOnStartup: false,
      safetyAuditHmacKey,
    },
  );
  try {
    const recovered = await service.recoverOperation({
      operationId,
      action,
      operator,
      reason,
    });
    writeLine(JSON.stringify(operationSummary(recovered), null, 2));
    return 0;
  } finally {
    service.close();
  }
}

export async function runOpsCli(
  args: string[],
  writeLine: WriteLine = console.log,
  writeError: WriteLine = console.error,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    if (parsed.command === "inspect") {
      if (parsed.flags.has("--help")) {
        writeLine(INSPECT_HELP);
        return 0;
      }
      return inspect(parsed, writeLine, environment);
    }
    if (parsed.command === "recover") {
      if (parsed.flags.has("--help")) {
        writeLine(RECOVER_HELP);
        return 0;
      }
      return await recover(parsed, writeLine, environment);
    }
    writeError("Expected the inspect or recover command.");
    return 2;
  } catch (error) {
    const message =
      error instanceof ModelServiceError || error instanceof Error
        ? error.message
        : "Unknown operations error.";
    writeError(JSON.stringify({ error: message }));
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  void runOpsCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
