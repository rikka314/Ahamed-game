import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { createSqliteModelService } from "./application/create-sqlite-model-service.js";
import type { ModelService } from "./application/model-service.js";
import { loadPhase6CaseBundlesFromManifest } from "./cases/phase6-case-production.js";
import type { SupportedCasePackage } from "./domain/case-package.js";
import { createLocalDevOpenAIProvider } from "./cli/local-dev-provider.js";

export const WEB_CASE_MANIFEST = "manifest.launch-release-20260904-r9.json";
const WEB_PROVIDER_CALL_TIMEOUT_MS = 15_000;
const WEB_PROVIDER_OPERATION_TIMEOUT_MS = 20_000;

export interface WebPublicCase {
  publicCaseId: string;
  caseVersion: string;
  patientRoleId: string;
  displayName: string;
  chiefComplaint: string;
  ageBand?: string;
  genderDisplay?: string;
}

export interface WebModelRuntimeOptions {
  modelRoot: string;
  environment?: NodeJS.ProcessEnv;
  databasePath?: string;
  loadEnvironmentFile?: boolean;
}

export interface WebModelRuntime {
  service: ModelService;
  cases: WebPublicCase[];
  maintain: () => void;
}

export function resolvePackagedWebModelRoot(): string {
  return resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

function publicPatientRoleId(casePackage: SupportedCasePackage): string {
  if (casePackage.schemaVersion === "case-package-v2-rc1") {
    return casePackage.patientIdentity.patientRoleId;
  }

  const launchCaseCode = /^case_c(?<sequence>\d{2})_/u.exec(
    casePackage.publicCaseId,
  )?.groups?.sequence;
  if (launchCaseCode !== undefined) {
    return `patient-role.public-c${launchCaseCode}`;
  }

  const digest = createHash("sha256")
    .update(casePackage.publicCaseId, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `patient-role.legacy-${digest}`;
}

function projectPublicCase(casePackage: SupportedCasePackage): WebPublicCase {
  const identity = casePackage.schemaVersion === "case-package-v2-rc1"
    ? casePackage.patientIdentity
    : casePackage.playerVisible;
  return {
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    patientRoleId: publicPatientRoleId(casePackage),
    displayName: identity.patientDisplayName,
    chiefComplaint: casePackage.playerVisible.chiefComplaint,
    ...(identity.ageBand === undefined ? {} : { ageBand: identity.ageBand }),
    ...(identity.genderDisplay === undefined
      ? {}
      : { genderDisplay: identity.genderDisplay }),
  };
}

function loadRuntimeEnvironment(
  modelRoot: string,
  environment: NodeJS.ProcessEnv,
  loadEnvironmentFile: boolean,
): NodeJS.ProcessEnv {
  if (!loadEnvironmentFile) return { ...environment };
  const environmentPath = resolve(modelRoot, ".env");
  const fileEnvironment = existsSync(environmentPath)
    ? parseEnv(readFileSync(environmentPath, "utf8"))
    : {};
  return { ...fileEnvironment, ...environment };
}

function resolveDatabasePath(
  modelRoot: string,
  configuredPath: string | undefined,
  environment: NodeJS.ProcessEnv,
): string {
  const configured = configuredPath?.trim();
  if (
    environment["NODE_ENV"] === "production" &&
    (!configured || !isAbsolute(configured))
  ) {
    throw new Error(
      "生产环境必须配置绝对路径 AHAMED_WEB_MODEL_DATABASE_PATH。",
    );
  }
  const candidate = configured || "var/model-web.sqlite";
  return isAbsolute(candidate) ? candidate : resolve(modelRoot, candidate);
}

function retentionHours(environment: NodeJS.ProcessEnv): number {
  const configured = environment["AHAMED_WEB_EXPIRED_SESSION_RETENTION_HOURS"]
    ?.trim();
  if (!configured) return 168;
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 720) {
    throw new Error(
      "AHAMED_WEB_EXPIRED_SESSION_RETENTION_HOURS 必须是 0 到 720 的整数。",
    );
  }
  return parsed;
}

function pruneExpiredWebSessions(
  databasePath: string,
  retainedHours: number,
): void {
  const cutoff = new Date(
    Date.now() - retainedHours * 60 * 60 * 1000,
  ).toISOString();
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;",
    );
    const result = database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(cutoff);
    if (Number(result.changes) > 0) {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }
  } finally {
    database.close();
  }
}

function developmentSafetyKey(modelRoot: string): string {
  const keyPath = resolve(modelRoot, "var", "web-runtime-safety.key");
  if (!existsSync(keyPath)) {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, randomBytes(48).toString("hex"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  return readFileSync(keyPath, "utf8").trim();
}

function safetyAuditHmacKey(
  modelRoot: string,
  environment: NodeJS.ProcessEnv,
): string {
  const configured = environment["SAFETY_AUDIT_HMAC_KEY"]?.trim();
  if (configured !== undefined && configured.length >= 32) return configured;
  if (environment["NODE_ENV"] === "production") {
    throw new Error(
      "生产环境必须配置至少 32 字符的 SAFETY_AUDIT_HMAC_KEY。",
    );
  }
  return developmentSafetyKey(modelRoot);
}

function loadCasePackages(modelRoot: string): SupportedCasePackage[] {
  const casesDirectory = resolve(modelRoot, "cases");
  const approvedBundles = loadPhase6CaseBundlesFromManifest({
    casesDirectory,
    manifestPath: resolve(casesDirectory, WEB_CASE_MANIFEST),
  }).bundles.filter(({ manifestEntry }) =>
    manifestEntry?.packageStatus === "published" &&
    manifestEntry.reviewStatus === "approved"
  );
  if (approvedBundles.length === 0) {
    throw new Error("Web runtime launch manifest contains no approved published cases.");
  }
  return approvedBundles.map(({ casePackage }) => casePackage);
}

export function loadWebPublicCases(modelRoot: string): WebPublicCase[] {
  return loadCasePackages(modelRoot).map(projectPublicCase);
}

export function createWebModelRuntime(
  options: WebModelRuntimeOptions,
): WebModelRuntime {
  const modelRoot = resolve(options.modelRoot);
  const environment = loadRuntimeEnvironment(
    modelRoot,
    options.environment ?? process.env,
    options.loadEnvironmentFile ?? true,
  );
  const modelId = environment["AHAMED_MODEL_ID"]?.trim();
  if (modelId === undefined || modelId.length === 0) {
    throw new Error("缺少 AHAMED_MODEL_ID，标准病人模型未启动。");
  }
  const databasePath = resolveDatabasePath(
    modelRoot,
    options.databasePath ?? environment["AHAMED_WEB_MODEL_DATABASE_PATH"],
    environment,
  );
  const databaseDirectory = dirname(databasePath);
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(databaseDirectory, 0o700);
    if (!existsSync(databasePath)) {
      writeFileSync(databasePath, new Uint8Array(), {
        flag: "wx",
        mode: 0o600,
      });
    }
    chmodSync(databasePath, 0o600);
  }
  const cases = loadCasePackages(modelRoot);
  const provider = createLocalDevOpenAIProvider(
    {
      userId: "web-runtime",
      providerName: "openai",
      modelId,
      databasePath,
    },
    environment,
    modelRoot,
    {
      callTimeoutMs: WEB_PROVIDER_CALL_TIMEOUT_MS,
      operationTimeoutMs: WEB_PROVIDER_OPERATION_TIMEOUT_MS,
    },
  );
  const service = createSqliteModelService({
    databasePath,
    cases,
    provider,
    safetyAuditHmacKey: safetyAuditHmacKey(modelRoot, environment),
  });
  if (process.platform !== "win32") {
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }
  const retainedHours = retentionHours(environment);
  let nextMaintenanceAt = 0;
  const maintain = (): void => {
    const now = Date.now();
    if (now < nextMaintenanceAt) return;
    pruneExpiredWebSessions(databasePath, retainedHours);
    nextMaintenanceAt = now + 60 * 60 * 1000;
  };
  maintain();
  return {
    service,
    cases: cases.map(projectPublicCase),
    maintain,
  };
}
