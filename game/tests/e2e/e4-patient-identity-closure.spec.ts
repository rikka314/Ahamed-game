import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { CaseIdV1, CaseSummaryV1, CaseVersionV1, NpcIdV1, PatientRoleIdV1, SessionIdV1 } from "@ahamed/doctor-game-share";

import { createClinicFlowState, transitionClinicFlow, type ClinicFlowState } from "../../src/game/domain/clinic-flow/clinicFlow";
import { GRAYBOX_PATIENT_SLOTS } from "../../src/game/domain/clinic-flow/grayboxClinicContent";
import { createPatientQueueEntriesFromCaseSummaries } from "../../src/game/domain/patients/patientSessionBinding";

const SENSITIVE_PATTERNS = [
  { category: "server_confidential_field", pattern: /personaTemplateId|behaviorInstructions|answerKey|rubric|targetDiagnosis|patientFacts|medicalTests|releaseReview|systemPrompt/iu },
  { category: "credential", pattern: /api[_-]?key|authorization|bearer\s+[A-Za-z0-9._~-]+|password|passwd|secret|access[_-]?token|refresh[_-]?token|set-cookie|\bsk-[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/iu },
  { category: "direct_identifier", pattern: /身份证|手机号|家庭住址|电子邮箱|真实姓名|patient[_-]?(?:name|email|phone|address)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dX](?!\d)/iu },
] as const;
const EXPECTED_SLOTS = ["npc.patient.graybox-01", "npc.patient.graybox-02"] as const;
const GAME_SOURCE_DIRECTORIES = [
  "app", "assets", "components", "public", "scripts", "src", "tests",
] as const;
const GAME_SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "playwright.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "vitest.config.ts",
  ".npmrc",
] as const;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function gameSourceSnapshot() {
  const root = realpathSync(process.cwd());
  const paths: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("E4 source snapshot refuses symbolic links");
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error("E4 source snapshot found an unsupported entry");
    }
  };
  for (const directory of GAME_SOURCE_DIRECTORIES) {
    const path = resolve(root, directory);
    if (!lstatSync(path).isDirectory()) throw new Error(`Invalid E4 source directory: ${directory}`);
    walk(path);
  }
  for (const file of GAME_SOURCE_FILES) {
    const path = resolve(root, file);
    if (!lstatSync(path).isFile()) throw new Error(`Invalid E4 source file: ${file}`);
    paths.push(path);
  }
  const files = paths.map((path) => {
    const portableRelative = relative(root, path).split(sep).join("/");
    if (!portableRelative || portableRelative === ".." || portableRelative.startsWith("../")) {
      throw new Error("E4 source snapshot path escaped the game directory");
    }
    const bytes = readFileSync(path);
    return {
      path: `game/${portableRelative}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    };
  }).filter(({ path }) =>
    !(path.startsWith("game/assets/source/") && path.includes("/review/"))
  ).sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: "e4-game-source-snapshot-v1",
    files,
    sourceTreeSha256: sha256Canonical(files),
  };
}

async function browserRuntimeSnapshot(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const urls = new Set<string>([window.location.href]);
    document.querySelectorAll<HTMLScriptElement>("script[src]").forEach(({ src }) => urls.add(src));
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach(({ href }) => urls.add(href));
    const artifacts: Array<{
      path: string;
      status: number;
      contentType: string;
      sha256: string;
      bytes: number;
    }> = [];
    for (const value of [...urls].sort()) {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) continue;
      const response = await fetch(url.href, { cache: "no-store", credentials: "same-origin" });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      artifacts.push({
        path: `${url.pathname}${url.search}`,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        bytes: bytes.byteLength,
      });
    }
    return { pagePath: `${window.location.pathname}${window.location.search}`, artifacts };
  });
  const artifacts = snapshot.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: "e4-browser-runtime-snapshot-v1",
    browserName: "chromium" as const,
    freshWebServerRequired: true as const,
    pagePath: snapshot.pagePath,
    artifacts,
    artifactSetSha256: sha256Canonical(artifacts),
  };
}

function opaque<T extends string>(value: string): T { return value as T; }

function fixtureSummaries(): CaseSummaryV1[] {
  return Array.from({ length: 30 }, (_, index) => {
    const code = String(index + 1).padStart(2, "0");
    return {
      contractVersion: "1",
      sessionId: opaque<SessionIdV1>(`session.e4.${code}`),
      caseId: opaque<CaseIdV1>(`case.public-${code}`),
      caseVersion: opaque<CaseVersionV1>("case-v2"),
      patientNpcId: opaque<NpcIdV1>(EXPECTED_SLOTS[index % 2]!),
      patientRoleId: opaque<PatientRoleIdV1>(`patient-role.public-c${code}`),
      chiefComplaint: "虚构主诉",
      patientDisplay: { displayName: `患者${code}` },
      allowedActions: ["ask_patient", "order_test", "submit_diagnosis"],
      sessionPhase: "active",
    };
  });
}

function loadPublicJourneySummaries(): CaseSummaryV1[] {
  const configured = process.env["E4_PUBLIC_JOURNEY_PATH"]?.trim();
  if (configured === undefined || configured.length === 0) return fixtureSummaries();
  const value = JSON.parse(readFileSync(resolve(process.cwd(), configured), "utf8")) as {
    schemaVersion?: unknown;
    shifts?: Array<{ cases?: Array<{ summary?: CaseSummaryV1 }> }>;
  };
  expect(value.schemaVersion).toBe("e4-cross-layer-journey-v1");
  return (value.shifts ?? []).flatMap(({ cases }) => (cases ?? []).map(({ summary }) => summary!));
}

function apply(state: ClinicFlowState, command: Parameters<typeof transitionClinicFlow>[1]): ClinicFlowState {
  const result = transitionClinicFlow(state, command);
  expect(result.status).toBe("applied");
  return result.state;
}

test("binds the public E4 journey through 15 real two-slot game shifts", async () => {
  const summaries = loadPublicJourneySummaries();
  expect(summaries).toHaveLength(30);
  expect(GRAYBOX_PATIENT_SLOTS.map(({ npcId }) => npcId)).toEqual(EXPECTED_SLOTS);
  let state = createClinicFlowState();
  state = apply(state, { type: "intro.complete", commandId: "intro.e4.closure" });
  state = apply(state, { type: "computer.open", commandId: "computer.e4.closure" });
  for (let shiftIndex = 0; shiftIndex < 15; shiftIndex += 1) {
    const pair = summaries.slice(shiftIndex * 2, shiftIndex * 2 + 2);
    expect(pair.map(({ patientNpcId }) => patientNpcId)).toEqual(EXPECTED_SLOTS);
    const patients = createPatientQueueEntriesFromCaseSummaries(pair, GRAYBOX_PATIENT_SLOTS);
    state = apply(state, { type: "shift.start", commandId: `shift.start.e4.${shiftIndex}`, shiftId: `shift.e4.${String(shiftIndex + 1).padStart(2, "0")}`, patients });
    state = apply(state, { type: "queue.form", commandId: `queue.form.e4.${shiftIndex}` });
    state = apply(state, { type: "queue.formed", commandId: `queue.formed.e4.${shiftIndex}` });
    for (const [patientIndex, patient] of patients.entries()) {
      state = apply(state, { type: "patient.call", commandId: `call.e4.${shiftIndex}.${patientIndex}`, callId: `call-id.e4.${shiftIndex}.${patientIndex}` });
      state = apply(state, { type: "patient.seated", commandId: `seated.e4.${shiftIndex}.${patientIndex}`, arrivalId: patient.arrivalId });
      state = apply(state, { type: "patient.departure.start", commandId: `leave.e4.${shiftIndex}.${patientIndex}`, npcId: patient.npcId, sessionId: patient.sessionId });
      state = apply(state, { type: "patient.departure.complete", commandId: `left.e4.${shiftIndex}.${patientIndex}`, npcId: patient.npcId, sessionId: patient.sessionId });
    }
  }
  expect(state.phase).toBe("shift_completed");
  expect(new Set(state.completedSessionIds).size).toBe(30);
  expect(new Set(state.completedPatientRoleIds).size).toBe(30);
});

async function browserSurfaceValues(page: Page): Promise<Record<string, { availability: "observed" | "not_available" | "scan_failed"; serializedValues: string[]; reason?: string }>> {
  return await page.evaluate(async () => {
    const decodeUtf8 = (bytes: Uint8Array, label: string): string => {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`${label} contains bytes that cannot be decoded as UTF-8`);
      }
    };
    const serializeIndexedDbValue = async (value: unknown): Promise<string> => {
      const seen = new WeakSet<object>();
      const normalize = async (candidate: unknown, path: string): Promise<unknown> => {
        if (
          candidate === null || typeof candidate === "string" ||
          typeof candidate === "number" || typeof candidate === "boolean"
        ) return candidate;
        if (typeof candidate === "bigint") return candidate.toString();
        if (typeof candidate === "undefined") return "[undefined]";
        if (candidate instanceof Blob) {
          const bytes = new Uint8Array(await candidate.arrayBuffer());
          return {
            blob: { type: candidate.type, size: candidate.size },
            decodedUtf8: decodeUtf8(bytes, `${path}<Blob>`),
          };
        }
        if (candidate instanceof ArrayBuffer) {
          return {
            byteLength: candidate.byteLength,
            decodedUtf8: decodeUtf8(new Uint8Array(candidate), `${path}<ArrayBuffer>`),
          };
        }
        if (ArrayBuffer.isView(candidate)) {
          const bytes = new Uint8Array(
            candidate.buffer,
            candidate.byteOffset,
            candidate.byteLength,
          );
          return {
            viewType: candidate.constructor.name,
            byteLength: candidate.byteLength,
            decodedUtf8: decodeUtf8(bytes, `${path}<${candidate.constructor.name}>`),
          };
        }
        if (typeof candidate !== "object") return String(candidate);
        if (seen.has(candidate)) return "[Circular]";
        seen.add(candidate);
        if (candidate instanceof Date) return candidate.toISOString();
        if (candidate instanceof Map) {
          return await Promise.all([...candidate.entries()].map(async ([key, item], index) => [
            await normalize(key, `${path}.mapKey[${index}]`),
            await normalize(item, `${path}.mapValue[${index}]`),
          ]));
        }
        if (candidate instanceof Set) {
          return await Promise.all([...candidate].map(
            (item, index) => normalize(item, `${path}.set[${index}]`),
          ));
        }
        if (Array.isArray(candidate)) {
          if (
            candidate.length > 0 &&
            candidate.every((item) =>
              Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)
          ) {
            return {
              byteArray: candidate,
              decodedUtf8: decodeUtf8(
                Uint8Array.from(candidate as number[]),
                `${path}<number[]>`,
              ),
            };
          }
          return await Promise.all(candidate.map(
            (item, index) => normalize(item, `${path}[${index}]`),
          ));
        }
        const record = candidate as Record<string, unknown>;
        if (
          record["type"] === "Buffer" && Array.isArray(record["data"]) &&
          record["data"].every((item) =>
            Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)
        ) {
          return {
            type: "Buffer",
            data: record["data"],
            decodedUtf8: decodeUtf8(
              Uint8Array.from(record["data"] as number[]),
              `${path}<BufferJSON>`,
            ),
          };
        }
        return Object.fromEntries(await Promise.all(
          Object.entries(record).map(async ([key, item]) => [
            key,
            await normalize(item, `${path}.${key}`),
          ]),
        ));
      };
      return JSON.stringify(await normalize(value, "indexedDB"));
    };
    const storageValues = (storage: Storage): string[] => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return JSON.stringify([key, storage.getItem(key)]);
    });
    const indexedDBValues: string[] = [];
    let indexedDBAvailability: "observed" | "not_available" | "scan_failed" = "observed";
    let indexedDBReason: string | undefined;
    if (!("indexedDB" in window) || typeof indexedDB.databases !== "function") {
      indexedDBAvailability = "not_available";
      indexedDBReason = "indexedDB.databases() is unavailable in this browser context";
    } else {
      try {
        const databases = await indexedDB.databases();
        for (const database of databases) {
          if (database.name === undefined) continue;
          const databaseName = database.name;
          indexedDBValues.push(JSON.stringify(database));
          const opened = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
            const request = indexedDB.open(databaseName, database.version);
            request.onsuccess = () => resolveDatabase(request.result);
            request.onerror = () => rejectDatabase(request.error ?? new Error("IndexedDB open failed"));
            request.onupgradeneeded = () => rejectDatabase(new Error("IndexedDB scan refused to upgrade a database"));
          });
          try {
            for (const storeName of Array.from(opened.objectStoreNames)) {
              const values = await new Promise<unknown[]>((resolveValues, rejectValues) => {
                const transaction = opened.transaction(storeName, "readonly");
                const request = transaction.objectStore(storeName).getAll();
                request.onsuccess = () => resolveValues(request.result);
                request.onerror = () => rejectValues(request.error ?? new Error("IndexedDB getAll failed"));
              });
              indexedDBValues.push(await serializeIndexedDbValue({
                database: databaseName,
                storeName,
                values,
              }));
            }
          } finally {
            opened.close();
          }
        }
      } catch (error) {
        indexedDBAvailability = "scan_failed";
        indexedDBReason = error instanceof Error ? error.message : "IndexedDB scan failed";
      }
    }
    const cacheValues: string[] = [];
    let cacheAvailability: "observed" | "not_available" | "scan_failed" = "observed";
    let cacheReason: string | undefined;
    if (!("caches" in window)) {
      cacheAvailability = "not_available";
      cacheReason = "CacheStorage is unavailable in this browser context";
    } else {
      try {
        for (const name of await caches.keys()) {
          cacheValues.push(JSON.stringify({ name }));
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            const response = await cache.match(request);
            const body = response === undefined ? null : await response.clone().text();
            cacheValues.push(JSON.stringify({ name, url: request.url, headers: response === undefined ? [] : Array.from(response.headers.entries()), body }));
          }
        }
      } catch (error) {
        cacheAvailability = "scan_failed";
        cacheReason = error instanceof Error ? error.message : "CacheStorage scan failed";
      }
    }
    return {
      indexedDB: { availability: indexedDBAvailability, serializedValues: indexedDBValues, ...(indexedDBReason === undefined ? {} : { reason: indexedDBReason }) },
      localStorage: { availability: "observed", serializedValues: storageValues(localStorage) },
      sessionStorage: { availability: "observed", serializedValues: storageValues(sessionStorage) },
      cacheStorage: { availability: cacheAvailability, serializedValues: cacheValues, ...(cacheReason === undefined ? {} : { reason: cacheReason }) },
      saveExport: { availability: "not_available", serializedValues: [], reason: "The current game shell does not expose a save-export surface" },
    };
  });
}

test("records browser runtime surfaces without inventing unavailable storage", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "E4 runtime evidence is captured once in Chromium.");
  const output = process.env["E4_RUNTIME_SCAN_OUTPUT"]?.trim();
  if (output !== undefined && output.length > 0 && process.env["CI"] !== "1") {
    throw new Error("E4 immutable runtime evidence requires CI=1 so Playwright cannot reuse an existing server.");
  }
  const consoleValues: string[] = [];
  page.on("console", (message) => consoleValues.push(`${message.type()}:${message.text()}`));
  await page.goto("/world-preview");
  await expect(page.getByTestId("game-canvas").locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "电脑 打开诊所系统" }).click();
  await page.getByRole("dialog", { name: "诊所电脑" }).getByRole("button", { name: /开始接诊/ }).click();
  const callNext = page.getByRole("button", { name: "叫号 叫下一位患者" });
  for (let index = 0; index < 2; index += 1) {
    await callNext.click();
    await expect(page.getByText("患者已落座", { exact: true })).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "灰盒验证 完成本例并测试患者离场" }).click();
    if (index === 0) await expect(callNext).toBeVisible({ timeout: 8_000 });
  }
  const runtimeSnapshot = await browserRuntimeSnapshot(page);
  const browser = await browserSurfaceValues(page);
  const observations: Array<{
    surface: string;
    availability: "observed" | "not_available" | "scan_failed";
    serializedValues: string[];
    reason?: string;
  }> = [
    { surface: "console", availability: "observed", serializedValues: consoleValues },
    { surface: "indexedDB", ...browser.indexedDB! },
    { surface: "localStorage", ...browser.localStorage! },
    { surface: "sessionStorage", ...browser.sessionStorage! },
    { surface: "cacheStorage", ...browser.cacheStorage! },
    { surface: "saveExport", ...browser.saveExport! },
  ];
  const summarizedObservations = observations.map((item) => {
    const valueDigests = item.serializedValues.map((value, valueIndex) => ({
      valueIndex,
      sha256: createHash("sha256").update(value).digest("hex"),
      utf8Bytes: Buffer.byteLength(value, "utf8"),
    }));
    const sensitiveMatches = item.serializedValues.flatMap((value, valueIndex) =>
      SENSITIVE_PATTERNS.flatMap(({ category, pattern }) =>
        pattern.test(value) ? [{ ...valueDigests[valueIndex]!, category }] : []));
    return {
      surface: item.surface,
      availability: item.availability,
      valueCount: valueDigests.length,
      utf8Bytes: valueDigests.reduce((total, value) => total + value.utf8Bytes, 0),
      valueDigests,
      sensitiveMatches,
      ...(item.reason === undefined ? {} : { reason: item.reason }),
    };
  });
  const sensitiveMatches = summarizedObservations.flatMap(
    ({ surface, sensitiveMatches: matches }) =>
      matches.map((match) => ({ surface, ...match })),
  );
  expect(sensitiveMatches).toEqual([]);
  const scannerImplementationPath = "game/tests/e2e/e4-patient-identity-closure.spec.ts";
  const scannerSource = readFileSync(resolve(process.cwd(), "tests/e2e/e4-patient-identity-closure.spec.ts"));
  const report = {
    schemaVersion: "e4-runtime-surface-scan-v4",
    generatedAt: new Date().toISOString(),
    status: sensitiveMatches.length === 0 && observations.every(({ availability }) => availability !== "scan_failed") ? "pass" : "fail",
    scannerImplementation: {
      path: scannerImplementationPath,
      sha256: createHash("sha256").update(scannerSource).digest("hex"),
      bytes: scannerSource.byteLength,
    },
    subject: {
      gameSource: gameSourceSnapshot(),
      browserRuntime: runtimeSnapshot,
    },
    observations: summarizedObservations,
    metrics: {
      observedSurfaces: observations.filter(({ availability }) => availability === "observed").length,
      unavailableSurfaces: observations.filter(({ availability }) => availability === "not_available").length,
      failedSurfaces: observations.filter(({ availability }) => availability === "scan_failed").length,
      sensitiveMatches: sensitiveMatches.length,
    },
  };
  if (output !== undefined && output.length > 0) {
    writeFileSync(resolve(process.cwd(), output), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
});
