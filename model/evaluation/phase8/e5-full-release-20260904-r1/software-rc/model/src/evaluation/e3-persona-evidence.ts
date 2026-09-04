import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { E3_PERSONA_BENCHMARK_REPORT_VERSION } from "./e3-persona-benchmark.js";
import { sha256Canonical } from "../release/phase8-release.js";

const REPORT_FILENAME = "e3-persona-benchmark-report.v2.json";
const RULE_CORPUS_FILENAME = "e3-persona-rule-corpus.v1.json";
const SAMPLE_SET_FILENAME = "private/patient-samples.v1.json";
const AUDIT_FILENAME = "e3-persona-ai-cross-review.v1.json";
const SAMPLE_SET_SCHEMA_VERSION = "e3-private-patient-sample-set-v1";
const RUN_ID_PATTERN = /^e3-run-\d{2}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface E3JourneyArtifactBinding {
  path: string;
  sizeBytes: number;
  sha256: string;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredFile(evidenceRoot: string, relativePath: string): string {
  const path = resolve(evidenceRoot, ...relativePath.split("/"));
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`E3 required evidence file is missing: ${relativePath}`);
  }
  return path;
}

function boundSha256(bindings: Record<string, unknown>, key: string): string {
  const value = bindings[key];
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`E3 report binding is invalid: ${key}`);
  }
  return value;
}

function expectedJourneyPath(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new TypeError(`E3 journey run ID is invalid: ${runId}`);
  }
  return `private/journeys/${runId}.json`;
}

function assertExactPaths(actual: readonly string[], expected: readonly string[]): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error("E3 journey artifact set is missing, unexpected, or drifted");
  }
}

export function createE3JourneyArtifactBindings(
  evidenceRoot: string,
  runIds: readonly string[],
): E3JourneyArtifactBinding[] {
  if (new Set(runIds).size !== runIds.length || runIds.length !== 6) {
    throw new TypeError("E3 journey artifacts require six unique run IDs");
  }
  const expectedPaths = runIds.map(expectedJourneyPath).sort();
  const journeyRoot = resolve(evidenceRoot, "private", "journeys");
  if (!existsSync(journeyRoot)) {
    throw new Error("E3 journey artifact directory is missing");
  }
  const entries = readdirSync(journeyRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("E3 journey artifact directory contains a non-file entry");
  }
  const actualPaths = entries.map(
    ({ name }) => `private/journeys/${name}`,
  );
  assertExactPaths(actualPaths, expectedPaths);
  return expectedPaths.map((path) => {
    const absolutePath = resolve(evidenceRoot, ...path.split("/"));
    return {
      path,
      sizeBytes: statSync(absolutePath).size,
      sha256: sha256File(absolutePath),
    };
  });
}

function parseJourneyBindings(value: unknown): E3JourneyArtifactBinding[] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new TypeError("E3 report journey artifact bindings are invalid");
  }
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry["path"] !== "string" ||
      !Number.isSafeInteger(entry["sizeBytes"]) ||
      Number(entry["sizeBytes"]) < 1 ||
      typeof entry["sha256"] !== "string" ||
      !SHA256_PATTERN.test(entry["sha256"])
    ) {
      throw new TypeError("E3 report journey artifact binding is malformed");
    }
    return {
      path: entry["path"],
      sizeBytes: Number(entry["sizeBytes"]),
      sha256: entry["sha256"],
    };
  });
}

export function verifyE3PersonaEvidenceDirectory(evidenceRoot: string): {
  reportSha256: string;
  journeyArtifacts: E3JourneyArtifactBinding[];
} {
  const reportPath = resolve(evidenceRoot, REPORT_FILENAME);
  if (!existsSync(reportPath)) {
    throw new Error("E3 benchmark report is missing");
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
  if (
    !isRecord(report) ||
    report["schemaVersion"] !== E3_PERSONA_BENCHMARK_REPORT_VERSION ||
    !Array.isArray(report["runs"]) ||
    !isRecord(report["bindings"])
  ) {
    throw new TypeError("E3 benchmark report structure is invalid");
  }
  const runIds = report["runs"].map((run) => {
    if (!isRecord(run) || typeof run["runId"] !== "string") {
      throw new TypeError("E3 benchmark report run binding is invalid");
    }
    return run["runId"];
  });
  const bindings = report["bindings"];
  const ruleCorpusPath = requiredFile(evidenceRoot, RULE_CORPUS_FILENAME);
  const ruleCorpus = JSON.parse(readFileSync(ruleCorpusPath, "utf8")) as unknown;
  if (
    sha256Canonical(ruleCorpus) !== boundSha256(bindings, "ruleCorpusSha256")
  ) {
    throw new Error("E3 rule corpus canonical hash drifted");
  }
  const sampleSetPath = requiredFile(evidenceRoot, SAMPLE_SET_FILENAME);
  const sampleSet = JSON.parse(readFileSync(sampleSetPath, "utf8")) as unknown;
  if (
    !isRecord(sampleSet) ||
    sampleSet["schemaVersion"] !== SAMPLE_SET_SCHEMA_VERSION ||
    !Array.isArray(sampleSet["samples"]) ||
    !Number.isSafeInteger(sampleSet["sampleCount"]) ||
    Number(sampleSet["sampleCount"]) !== sampleSet["samples"].length ||
    typeof sampleSet["sampleSetSha256"] !== "string" ||
    !SHA256_PATTERN.test(sampleSet["sampleSetSha256"])
  ) {
    throw new TypeError("E3 private patient sample set is invalid");
  }
  const sampleSetSha256 = sha256Canonical(sampleSet["samples"]);
  if (
    sampleSetSha256 !== sampleSet["sampleSetSha256"] ||
    sampleSetSha256 !== boundSha256(bindings, "sampleSetSha256")
  ) {
    throw new Error("E3 patient sample set canonical hash drifted");
  }
  const auditPath = requiredFile(evidenceRoot, AUDIT_FILENAME);
  if (sha256File(auditPath) !== boundSha256(bindings, "auditSha256")) {
    throw new Error("E3 AI cross-review file hash drifted");
  }
  const providedBindings = parseJourneyBindings(
    bindings["journeyArtifacts"],
  ).sort((left, right) => left.path.localeCompare(right.path));
  const actualBindings = createE3JourneyArtifactBindings(
    evidenceRoot,
    runIds,
  ).sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(providedBindings) !== JSON.stringify(actualBindings)) {
    throw new Error("E3 journey artifact hash or size binding drifted");
  }
  return {
    reportSha256: sha256File(reportPath),
    journeyArtifacts: actualBindings,
  };
}

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    isAbsolute(requestedPath) ||
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("E3 evidence 路径必须是 model/ 内的相对路径。");
  }
  return resolvedPath;
}

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--evidence" || argv[1] === undefined) {
      throw new Error(
        "用法：npm run eval:e3:persona-verify -- --evidence <E3 evidence 目录>",
      );
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const evidenceRoot = resolveInsideModel(modelRoot, argv[1]);
    const result = verifyE3PersonaEvidenceDirectory(evidenceRoot);
    process.stdout.write(`${JSON.stringify({
      status: "E3_PERSONA_EVIDENCE_VERIFIED",
      evidenceDirectory: relative(modelRoot, evidenceRoot).replaceAll("\\", "/"),
      reportSha256: result.reportSha256,
      journeyArtifacts: result.journeyArtifacts.length,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "未知 E3 evidence 验证错误。";
    process.stderr.write(`E3 persona evidence 验证失败：${message}\n`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  main();
}
