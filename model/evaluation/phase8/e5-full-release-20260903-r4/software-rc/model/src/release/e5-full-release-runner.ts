import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PHASE7_EVAL_CORPUS } from "../evaluation/phase7-eval-corpus.js";
import { PHASE7_SAFETY_CORPUS_V1 } from "../evaluation/phase7-safety-corpus.js";
import { buildE3PersonaRuleCorpus } from "../evaluation/e3-persona-benchmark.js";
import {
  E5_MINIMUM_TARGET_COUNTS,
  buildE5AcceptanceReport,
  buildE5RuntimeReleaseManifest,
  verifyE5RuntimeReleaseManifest,
  type E5EvidenceBinding,
  type E5LocalCommandReport,
  type E5ObservationStatus,
  type E5ObservedCounts,
  type E5RuntimeReleaseManifestV1,
  type E5SourceState,
} from "./e5-full-release.js";
import { scanE5StaticClientArtifacts } from "./e5-static-client-security.js";
import { sha256Canonical } from "./phase8-release.js";
import { scanRuntimeArtifactSet } from "./runtime-artifact-security.js";

const DEFAULT_E3_EVIDENCE = "evaluation/phase8/e3-persona-live-20260903-r7";
const ACCEPTANCE_FILENAME = "e5-full-acceptance-report.v1.json";
const MANIFEST_FILENAME = "e5-runtime-release-manifest.v1.json";
const INDEX_FILENAME = "e5-software-rc-index.v1.json";
const ARCHIVE_FILENAME = "e5-software-rc.tar.gz";
const SUMS_FILENAME = "SHA256SUMS.json";
const WALK_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
  "var",
]);
const SAFE_RELATIVE_ARGUMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

interface Arguments {
  outputDirectory: string;
  e3EvidenceDirectory: string;
}

export interface E5RecordedCommand extends E5LocalCommandReport {
  durationMs: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function resolveInside(root: string, requestedPath: string, label: string): string {
  if (isAbsolute(requestedPath)) throw new Error(`${label} must be relative.`);
  const resolvedPath = resolve(root, requestedPath);
  const relativePath = relative(root, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside model/.`);
  }
  return resolvedPath;
}

function requireRegularFile(path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${path}`);
  }
  return path;
}

function assertExistingDirectoryInside(root: string, directory: string, label: string): void {
  const realRoot = realpathSync(root);
  const realDirectory = realpathSync(directory);
  const relativePath = relative(realRoot, realDirectory);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !statSync(realDirectory).isDirectory()
  ) {
    throw new Error(`${label} must resolve to a directory inside model/.`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(requireRegularFile(path, "JSON artifact"), "utf8")) as unknown;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export function parseE5FullReleaseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  const allowed = new Set(["--output", "--e3-evidence"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === undefined || !allowed.has(key) || values.has(key)) {
      throw new Error(`未知或重复参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`参数 ${key} 缺少值。`);
    values.set(key, value);
    index += 1;
  }
  const outputDirectory = values.get("--output");
  if (outputDirectory === undefined) {
    throw new Error("用法：node e5-full-release-runner.js --output <model内相对目录> [--e3-evidence <model内相对目录>]");
  }
  const e3EvidenceDirectory = values.get("--e3-evidence") ?? DEFAULT_E3_EVIDENCE;
  for (const [label, value] of [
    ["--output", outputDirectory],
    ["--e3-evidence", e3EvidenceDirectory],
  ] as const) {
    if (
      !SAFE_RELATIVE_ARGUMENT_PATTERN.test(value) ||
      value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`${label} 只能使用安全的 ASCII 相对路径字符。`);
    }
  }
  if (!e3EvidenceDirectory.startsWith("evaluation/phase8/")) {
    throw new Error("--e3-evidence 必须位于 model/evaluation/phase8/。");
  }
  return {
    outputDirectory,
    e3EvidenceDirectory,
  };
}

export function sanitizedE5Environment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const retained = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "CI", "NO_COLOR"];
  return Object.fromEntries(retained.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])) as NodeJS.ProcessEnv;
}

export function runE5NpmCommand(input: {
  name: string;
  script: string;
  args?: readonly string[];
  cwd: string;
  timeoutMs: number;
}): E5RecordedCommand {
  const scriptArgs = input.args ?? [];
  const command = process.platform === "win32" ? (process.env["ComSpec"] ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${[input.script, ...scriptArgs].join(" ")}`]
    : ["run", input.script, ...scriptArgs];
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: sanitizedE5Environment(),
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  if (result.error !== undefined || result.status === null) {
    throw new Error(`E5 command could not execute: ${input.name} (${result.error?.message ?? result.signal ?? "unknown process failure"})`);
  }
  return {
    name: input.name,
    command: `npm run ${[input.script, ...scriptArgs].join(" ")}`,
    exitCode: result.status,
    stdoutSha256: sha256Bytes(result.stdout ?? ""),
    stderrSha256: sha256Bytes(result.stderr ?? ""),
    durationMs,
  };
}

function runRequiredProcess(command: string, args: readonly string[], cwd: string, timeoutMs: number): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: sanitizedE5Environment(),
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status === null || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`);
  }
  return result.stdout ?? "";
}

export function collectE5SourceState(gameRoot: string): E5SourceState {
  const head = runRequiredProcess("git", ["rev-parse", "HEAD"], gameRoot, 30_000).trim();
  const porcelain = runRequiredProcess("git", ["status", "--porcelain=v1", "--untracked-files=all"], gameRoot, 30_000);
  const lines = porcelain.split(/\r?\n/u).filter(Boolean);
  return {
    headCommit: head.length > 0 ? head : null,
    dirty: lines.length > 0,
    statusSha256: sha256Bytes(porcelain),
    trackedChanges: lines.filter((line) => !line.startsWith("?? ")).length,
    untrackedChanges: lines.filter((line) => line.startsWith("?? ")).length,
  };
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`E5 source tree must not contain symlinks: ${path}`);
      if (entry.isDirectory() && WALK_IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  walk(directory);
  return result.sort();
}

function shouldIncludeRuntimeFile(gameRoot: string, absolutePath: string): boolean {
  const path = portableRelative(gameRoot, absolutePath);
  const segments = path.split("/");
  if (!(["model", "share", "game"].includes(segments[0] ?? ""))) return false;
  if (segments.some((segment) => ["node_modules", "dist", ".next", "var", "coverage", ".git"].includes(segment))) return false;
  if (basename(path).startsWith(".env")) return false;
  if (/\.(?:db|sqlite|sqlite3|wal|shm|log)$/iu.test(path)) return false;
  if (path.startsWith("model/evaluation/phase8/") || path.includes("/private/") || path.startsWith("model/cases/review/")) return false;
  if (path.startsWith("game/test-results/") || path.startsWith("game/playwright-report/")) return false;
  if (path.startsWith("game/assets/source/") && path.includes("/review/")) return false;
  return true;
}

export function collectE5RuntimeArtifactPaths(
  gameRoot: string,
  additionalPaths: readonly string[] = [],
): string[] {
  const discovered = ["model", "share", "game"]
    .flatMap((name) => walkFiles(resolve(gameRoot, name)))
    .filter((path) => shouldIncludeRuntimeFile(gameRoot, path))
    .map((path) => portableRelative(gameRoot, path));
  for (const path of additionalPaths) {
    requireRegularFile(resolve(gameRoot, ...path.split("/")), "additional E5 artifact");
  }
  return [...new Set([...discovered, ...additionalPaths])].sort();
}

function copyArtifact(root: string, destinationRoot: string, portablePath: string): void {
  const source = requireRegularFile(resolve(root, ...portablePath.split("/")), "E5 source artifact");
  const destination = resolve(destinationRoot, ...portablePath.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  if (sha256File(source) !== sha256File(destination)) throw new Error(`E5 artifact copy hash mismatch: ${portablePath}`);
}

function numberAt(value: unknown, ...path: string[]): number {
  let current = value;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current = value;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return typeof current === "string" ? current : undefined;
}

function arrayAt(value: unknown, ...path: string[]): unknown[] {
  let current = value;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return Array.isArray(current) ? current : [];
}

function mapObservationStatus(value: unknown): E5ObservationStatus {
  if (value === "passed" || value === "approved") return "passed";
  if (value === "failed" || value === "rejected" || value === "revision_recommended") return "failed";
  return value === "not_run" || value === "stale" ? value : "not_run";
}

function countRegressionTrajectories(modelRoot: string, manifest: unknown): number {
  return arrayAt(manifest, "cases").reduce<number>((total, entry) => {
    const regressionPath = isRecord(entry) ? entry["regressionPath"] : undefined;
    if (typeof regressionPath !== "string") return total;
    const artifact = readJson(resolve(modelRoot, "cases", regressionPath));
    return total + arrayAt(artifact, "trajectories").length;
  }, 0);
}

function collectEvidenceBinding(modelRoot: string, name: string, relativePath: string, status: E5EvidenceBinding["status"]): E5EvidenceBinding {
  const path = requireRegularFile(resolve(modelRoot, ...relativePath.split("/")), name);
  return { name, path: relativePath, sha256: sha256File(path), status };
}

function fileBindingMatches(
  modelRoot: string,
  relativePath: unknown,
  expectedSha256: unknown,
): boolean {
  if (
    typeof relativePath !== "string" ||
    typeof expectedSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(expectedSha256)
  ) {
    return false;
  }
  try {
    const path = resolveInside(modelRoot, relativePath, "E3 bound source path");
    return sha256File(requireRegularFile(path, "E3 bound source")) === expectedSha256;
  } catch {
    return false;
  }
}

function e3JourneyPaths(report: unknown): string[] {
  const paths = arrayAt(report, "bindings", "journeyArtifacts").map((binding) =>
    isRecord(binding) ? binding["path"] : undefined,
  );
  if (
    paths.length !== 6 ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        !path.startsWith("private/journeys/") ||
        path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    )
  ) {
    throw new Error("E3 journey artifact paths are invalid for E5 packaging.");
  }
  return paths as string[];
}

function renameDirectoryWithRetry(source: string, destination: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : "";
      if (!["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 6) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
  throw lastError;
}

function main(): void {
  const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const gameRoot = resolve(modelRoot, "..");
  let temporaryDirectory: string | undefined;
  try {
    const args = parseE5FullReleaseArguments(process.argv.slice(2));
    const outputDirectory = resolveInside(modelRoot, args.outputDirectory, "E5 output path");
    const e3Directory = resolveInside(modelRoot, args.e3EvidenceDirectory, "E3 evidence path");
    assertExistingDirectoryInside(modelRoot, dirname(outputDirectory), "E5 output parent");
    assertExistingDirectoryInside(modelRoot, e3Directory, "E3 evidence path");
    if (existsSync(outputDirectory)) throw new Error("E5 输出目录已存在；不会覆盖。");
    requireRegularFile(resolve(e3Directory, "e3-persona-benchmark-report.v2.json"), "E3 report");

    const commands: E5RecordedCommand[] = [];
    const commandPlan = [
      ["share.build", "build", [], resolve(gameRoot, "share"), 300_000],
      ["share.typecheck", "typecheck", [], resolve(gameRoot, "share"), 300_000],
      ["share.test:contract", "test:contract", [], resolve(gameRoot, "share"), 600_000],
      ["share.test:coverage", "test:coverage", [], resolve(gameRoot, "share"), 900_000],
      ["model.build", "build", [], modelRoot, 600_000],
      ["model.typecheck", "typecheck", [], modelRoot, 600_000],
      ["model.test", "test", [], modelRoot, 1_200_000],
      ["model.test:coverage", "test:coverage", [], modelRoot, 1_800_000],
      ["model.test:contract", "test:contract", [], modelRoot, 900_000],
      ["model.cases:validate:launch-policy", "cases:validate:launch-policy", [], modelRoot, 600_000],
      ["model.cases:validate:manifest", "cases:validate:manifest", [], modelRoot, 600_000],
      ["model.cases:validate", "cases:validate", [], modelRoot, 900_000],
      ["model.eval:phase7:offline", "eval:phase7:offline", [], modelRoot, 900_000],
      ["model.eval:e3:persona-verify", "eval:e3:persona-verify", ["--", "--evidence", args.e3EvidenceDirectory], modelRoot, 600_000],
      ["game.lint", "lint", [], resolve(gameRoot, "game"), 600_000],
      ["game.typecheck", "typecheck", [], resolve(gameRoot, "game"), 600_000],
      ["game.test", "test", [], resolve(gameRoot, "game"), 900_000],
      ["game.test:contract", "test:contract", [], resolve(gameRoot, "game"), 900_000],
      ["game.build", "build", [], resolve(gameRoot, "game"), 1_200_000],
      ["game.test:e2e", "test:e2e", [], resolve(gameRoot, "game"), 1_800_000],
    ] as const;
    for (const [name, script, scriptArgs, cwd, timeoutMs] of commandPlan) {
      commands.push(runE5NpmCommand({ name, script, args: scriptArgs, cwd, timeoutMs }));
    }

    const gameBuildPassed = commands.find(({ name }) => name === "game.build")?.exitCode === 0;
    const staticScan = gameBuildPassed
      ? scanE5StaticClientArtifacts(resolve(gameRoot, "game"))
      : { status: "not_run" as const, scannedFiles: 0, sensitiveMatches: 0, matches: [] };

    const launchPolicyPath = "cases/policy/launch-content-policy-v1.json";
    const manifestPath = "cases/manifest.phase6-compat.v2-rc1.json";
    const scoringTestPath = "tests/scoring-policy-v1.test.ts";
    const e3ReportPath = `${args.e3EvidenceDirectory.replaceAll("\\", "/")}/e3-persona-benchmark-report.v2.json`;
    const launchPolicy = readJson(resolve(modelRoot, launchPolicyPath));
    const manifest = readJson(resolve(modelRoot, manifestPath));
    const e3Report = readJson(resolve(modelRoot, ...e3ReportPath.split("/")));
    const e4Path = resolve(gameRoot, "share/versions/e4-patient-identity-quality-record.v1.json");
    const e4Record = readJson(e4Path);
    const cases = arrayAt(manifest, "cases");
    const e3Audit = arrayAt(e3Report, "audit");
    const e3Rules = readJson(resolve(e3Directory, "e3-persona-rule-corpus.v1.json"));
    const staleCaseAiReviewCalls = numberAt(manifest, "reviewSummary", "staleCount") * 2;
    const currentPromptVersion = stringAt(manifest, "patientPromptVersion");
    const e3Bindings = isRecord(e3Report) && isRecord(e3Report["bindings"])
      ? e3Report["bindings"]
      : {};
    const e3BindingStatus: E5EvidenceBinding["status"] =
      fileBindingMatches(
        modelRoot,
        e3Bindings["anchorCasePath"],
        e3Bindings["anchorCaseSha256"],
      ) &&
      typeof currentPromptVersion === "string" &&
      fileBindingMatches(
        modelRoot,
        `prompts/patient/${currentPromptVersion}.md`,
        e3Bindings["patientPromptSha256"],
      ) &&
      e3Bindings["ruleCorpusSha256"] ===
        sha256Canonical(buildE3PersonaRuleCorpus())
        ? "current"
        : "stale";
    const observedCounts: E5ObservedCounts = {
      cases: cases.length,
      trajectories: countRegressionTrajectories(modelRoot, manifest),
      goldenVectors: /freezes exactly 30 golden vectors/u.test(readFileSync(resolve(modelRoot, scoringTestPath), "utf8")) ? 30 : 0,
      dialogueSamples: PHASE7_EVAL_CORPUS.caseCorpora.reduce((total, corpus) => total + corpus.items.length, 0),
      newDomainSafetySamples: 0,
      caseAiReviewCalls: cases.filter((entry) => isRecord(entry) && entry["reviewStatus"] === "approved").length * 2,
      personaRuleAssertions: numberAt(e3Rules, "assertionCount"),
      personaLiveTurns: numberAt(e3Report, "coverage", "committedTurns"),
      releaseDialogueTurns: 0,
      patientRoles: numberAt(e4Record, "metrics", "publicPatientRoles"),
    };
    const e4Checks = arrayAt(e4Record, "checks");
    const e4Status = (checkId: string): E5ObservationStatus => {
      const check = e4Checks.find((entry) => isRecord(entry) && entry["checkId"] === checkId);
      return mapObservationStatus(isRecord(check) && check["status"] === "pass" ? "passed" : isRecord(check) ? check["status"] : "not_run");
    };
    const evidenceBindings: E5EvidenceBinding[] = [
      collectEvidenceBinding(modelRoot, "launch-content-policy", launchPolicyPath, "current"),
      collectEvidenceBinding(modelRoot, "current-case-manifest", manifestPath, "current"),
      collectEvidenceBinding(modelRoot, "scoring-golden-vector-test", scoringTestPath, "current"),
      collectEvidenceBinding(modelRoot, "e3-persona-report", e3ReportPath, e3BindingStatus),
      collectEvidenceBinding(
        modelRoot,
        "case-ai-review-set",
        manifestPath,
        staleCaseAiReviewCalls > 0 ? "stale" : "current",
      ),
      { name: "e4-patient-identity-quality-record", path: "../share/versions/e4-patient-identity-quality-record.v1.json", sha256: sha256File(e4Path), status: "current" },
    ];
    const generatedAt = new Date().toISOString();
    const acceptanceReport = buildE5AcceptanceReport({
      targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
      observedCounts,
      localCommandReports: commands,
      provider: "not_run",
      e3: {
        status: mapObservationStatus(stringAt(e3Report, "decision")),
        metrics: {
          ruleAssertions: observedCounts.personaRuleAssertions,
          committedTurns: observedCounts.personaLiveTurns,
          completedAiReviews: e3Audit.filter((entry) => isRecord(entry) && entry["runStatus"] === "completed").length,
          currentCaseAiReviews: observedCounts.caseAiReviewCalls,
          staleCaseAiReviews: staleCaseAiReviewCalls,
          e3BindingDrift: e3BindingStatus === "stale" ? 1 : 0,
          safetyCorpusSamples: PHASE7_SAFETY_CORPUS_V1.length,
          launchPolicyCases: arrayAt(launchPolicy, "cases").length,
        },
      },
      e4: {
        live: e4Status("thirty_case_live_cross_layer_journey"),
        storage: e4Status("runtime_storage_and_log_leakage_scan"),
        aiReviews: [mapObservationStatus(stringAt(e4Record, "aiCrossReview", "status")), mapObservationStatus(stringAt(e4Record, "aiCrossReview", "status"))],
      },
      staticClientScan: staticScan,
      evidenceBindings,
      generatedAt,
    });

    const sourceState = collectE5SourceState(gameRoot);
    temporaryDirectory = `${outputDirectory}.tmp-${process.pid}-${Date.now()}`;
    if (existsSync(temporaryDirectory)) throw new Error("E5 temporary output already exists.");
    mkdirSync(temporaryDirectory, { recursive: false });

    const outputName = basename(outputDirectory);
    const acceptanceArtifactPath = `model/evaluation/phase8/${outputName}/${ACCEPTANCE_FILENAME}`;
    const e3EvidenceArtifacts = [
      "e3-persona-ai-cross-review.v1.json",
      "e3-persona-benchmark-report.v2.json",
      "e3-persona-rule-corpus.v1.json",
      "private/patient-samples.v1.json",
      ...e3JourneyPaths(e3Report),
    ].map((name) => `model/${args.e3EvidenceDirectory}/${name}`);
    const releaseRoot = resolve(temporaryDirectory, "release-root");
    mkdirSync(releaseRoot, { recursive: true });
    const runtimeArtifactPaths = collectE5RuntimeArtifactPaths(gameRoot, e3EvidenceArtifacts);
    for (const path of runtimeArtifactPaths) copyArtifact(gameRoot, releaseRoot, path);
    writeJsonExclusive(resolve(releaseRoot, ...acceptanceArtifactPath.split("/")), acceptanceReport);
    const manifestValue = buildE5RuntimeReleaseManifest({
      rootDirectory: releaseRoot,
      artifactPaths: runtimeArtifactPaths,
      acceptanceReportPath: acceptanceArtifactPath,
      sourceState,
      providerObservation: {
        status: "not_run",
        findings: ["E5 did not invoke a real Provider and does not claim M0/B1-B5, 360 release dialogue turns, or current AI case review completion."],
      },
      qualityFindings: acceptanceReport.findings,
      generatedAt,
    });
    verifyE5RuntimeReleaseManifest(manifestValue, releaseRoot);
    const manifestPathInTemp = resolve(temporaryDirectory, MANIFEST_FILENAME);
    writeJsonExclusive(manifestPathInTemp, manifestValue);
    writeJsonExclusive(resolve(temporaryDirectory, ACCEPTANCE_FILENAME), acceptanceReport);

    const softwareRcRoot = resolve(temporaryDirectory, "software-rc");
    mkdirSync(softwareRcRoot, { recursive: true });
    for (const artifact of manifestValue.artifacts) copyArtifact(releaseRoot, softwareRcRoot, artifact.path);
    copyFileSync(
      resolve(temporaryDirectory, ACCEPTANCE_FILENAME),
      resolve(softwareRcRoot, ACCEPTANCE_FILENAME),
    );
    copyFileSync(manifestPathInTemp, resolve(softwareRcRoot, MANIFEST_FILENAME));
    verifyE5RuntimeReleaseManifest(manifestValue, softwareRcRoot);
    const stagedPaths = [
      ...manifestValue.artifacts.map(({ path }) => path),
      ACCEPTANCE_FILENAME,
      MANIFEST_FILENAME,
    ];
    const stagedScan = scanRuntimeArtifactSet(softwareRcRoot, stagedPaths, { unsupportedFilePolicy: "skip" });
    if (stagedScan.secretFindings.length > 0 || stagedScan.hiddenFieldFindings.length > 0) {
      throw new Error("E5 staged Software RC scan found a secret or public-evidence hidden field.");
    }

    const index = {
      schemaVersion: "e5-software-rc-index-v1",
      generatedAt,
      reviewPolicy: "non_blocking",
      acceptance: { path: ACCEPTANCE_FILENAME, sha256: sha256File(resolve(temporaryDirectory, ACCEPTANCE_FILENAME)), size: statSync(resolve(temporaryDirectory, ACCEPTANCE_FILENAME)).size, decision: acceptanceReport.decision },
      runtimeManifest: { path: MANIFEST_FILENAME, sha256: sha256File(manifestPathInTemp), size: statSync(manifestPathInTemp).size, manifestSha256: manifestValue.manifestSha256 },
      artifactCount: manifestValue.artifacts.length,
      sourceState,
      providerObservation: manifestValue.providerObservation,
      stagedSecurityScan: { status: "passed", ...stagedScan },
      findings: acceptanceReport.findings,
    };
    const indexPath = resolve(temporaryDirectory, INDEX_FILENAME);
    writeJsonExclusive(indexPath, index);
    copyFileSync(indexPath, resolve(softwareRcRoot, INDEX_FILENAME));
    const indexScan = scanRuntimeArtifactSet(softwareRcRoot, [INDEX_FILENAME], {
      unsupportedFilePolicy: "skip",
    });
    if (indexScan.secretFindings.length > 0 || indexScan.hiddenFieldFindings.length > 0) {
      throw new Error("E5 Software RC index scan found a secret or hidden field.");
    }
    const archivePath = resolve(temporaryDirectory, ARCHIVE_FILENAME);
    runRequiredProcess("tar", ["-czf", archivePath, "-C", temporaryDirectory, "software-rc"], gameRoot, 600_000);
    const sums = [ACCEPTANCE_FILENAME, MANIFEST_FILENAME, INDEX_FILENAME, ARCHIVE_FILENAME].map((name) => {
      const path = resolve(temporaryDirectory!, name);
      return { path: name, sha256: sha256File(path), size: statSync(path).size };
    });
    writeJsonExclusive(resolve(temporaryDirectory, SUMS_FILENAME), { schemaVersion: "e5-sha256sums-v1", generatedAt, files: sums });
    rmSync(releaseRoot, { recursive: true, force: true });
    renameDirectoryWithRetry(temporaryDirectory, outputDirectory);
    temporaryDirectory = undefined;
    process.stdout.write(`${JSON.stringify({ status: "E5_SOFTWARE_RC_CREATED", outputDirectory: portableRelative(modelRoot, outputDirectory), decision: acceptanceReport.decision, artifacts: manifestValue.artifacts.length, findings: acceptanceReport.findings.length }, null, 2)}\n`);
  } catch (error) {
    if (temporaryDirectory !== undefined && existsSync(temporaryDirectory)) rmSync(temporaryDirectory, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : "未知 E5 发布错误。";
    process.stderr.write(`E5 全量发布失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
