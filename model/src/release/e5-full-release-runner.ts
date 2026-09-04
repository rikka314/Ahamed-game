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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PHASE7_EVAL_CORPUS } from "../evaluation/phase7-eval-corpus.js";
import { PHASE7_SAFETY_CORPUS_V1 } from "../evaluation/phase7-safety-corpus.js";
import { loadCasePackages, loadSupportedCasePackages } from "../cli/case-loader.js";
import { computeMedicalContentDigest } from "../domain/case-content-hash.js";
import { buildE3PersonaRuleCorpus } from "../evaluation/e3-persona-benchmark.js";
import { verifyE3PersonaEvidenceDirectory } from "../evaluation/e3-persona-evidence.js";
import { verifyCaseAiCrossReviewIndex } from "../evaluation/case-ai-cross-review-verify.js";
import { verifyC7DialogueEvidenceDirectory } from "../evaluation/c7-dialogue-evidence-verify.js";
import {
  buildE3PersonaCaseVariants,
} from "../evaluation/e3-persona-live-runner.js";
import { buildE3ReuseSourceBinding } from "../evaluation/e3-reuse-policy.js";
import {
  E5_MINIMUM_TARGET_COUNTS,
  buildE5AcceptanceReport,
  buildE5RuntimeReleaseManifest,
  verifyE5RuntimeReleaseManifest,
  type E5EvidenceBinding,
  type E5Finding,
  type E5LocalCommandReport,
  type E5ObservationStatus,
  type E5ObservedCounts,
  type E5RuntimeReleaseManifestV1,
  type E5SourceState,
} from "./e5-full-release.js";
import { scanE5StaticClientArtifacts } from "./e5-static-client-security.js";
import {
  assertContainedDirectory,
  publishDirectoryExclusive,
  resolveContainedPathForCreate,
} from "../security/contained-path.js";
import {
  verifyE4PatientIdentityClosure,
  type E4PatientIdentityClosure,
} from "./e4-closure.js";
import { sha256Canonical } from "./phase8-release.js";
import { scanRuntimeArtifactSet } from "./runtime-artifact-security.js";

const ACCEPTANCE_FILENAME = "e5-full-acceptance-report.v2.json";
const MANIFEST_FILENAME = "e5-runtime-release-manifest.v2.json";
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
  caseAiEvidenceDirectory: string;
  dialogueEvidenceDirectory: string;
  e4ClosurePath: string;
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

function normalizePortableRelativePath(path: string, label: string): string {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    throw new Error(`${label} must be a portable relative path.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
  return segments.join("/");
}

function resolveContainedRegularFile(root: string, path: string, label: string): string {
  const portablePath = normalizePortableRelativePath(path, label);
  const realRoot = realpathSync(root);
  const candidate = requireRegularFile(
    resolve(realRoot, ...portablePath.split("/")),
    label,
  );
  const realCandidate = realpathSync(candidate);
  const relativePath = relative(realRoot, realCandidate);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside its declared root.`);
  }
  return realCandidate;
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
  const allowed = new Set([
    "--output",
    "--e3-evidence",
    "--case-ai-evidence",
    "--dialogue-evidence",
    "--e4-closure",
  ]);
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
  const e3EvidenceDirectory = values.get("--e3-evidence");
  const caseAiEvidenceDirectory = values.get("--case-ai-evidence");
  const dialogueEvidenceDirectory = values.get("--dialogue-evidence");
  const e4ClosurePath = values.get("--e4-closure");
  if (
    outputDirectory === undefined || e3EvidenceDirectory === undefined ||
    caseAiEvidenceDirectory === undefined || dialogueEvidenceDirectory === undefined ||
    e4ClosurePath === undefined
  ) {
    throw new Error("用法：node e5-full-release-runner.js --output <model内相对目录> --e3-evidence <model内相对目录> --case-ai-evidence <model内相对目录> --dialogue-evidence <model内相对目录> --e4-closure <project内相对JSON>");
  }
  for (const [label, value] of [
    ["--output", outputDirectory],
    ["--e3-evidence", e3EvidenceDirectory],
    ["--case-ai-evidence", caseAiEvidenceDirectory],
    ["--dialogue-evidence", dialogueEvidenceDirectory],
    ["--e4-closure", e4ClosurePath],
  ] as const) {
    if (
      !SAFE_RELATIVE_ARGUMENT_PATTERN.test(value) ||
      value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`${label} 只能使用安全的 ASCII 相对路径字符。`);
    }
  }
  for (const [label, value] of [
    ["--e3-evidence", e3EvidenceDirectory],
    ["--case-ai-evidence", caseAiEvidenceDirectory],
    ["--dialogue-evidence", dialogueEvidenceDirectory],
  ] as const) {
    if (!value.startsWith("evaluation/phase8/")) {
      throw new Error(`${label} 必须位于 model/evaluation/phase8/。`);
    }
  }
  if (!e4ClosurePath.startsWith("share/versions/e4-patient-identity-e5-closure")) {
    throw new Error("--e4-closure 必须是 share/versions/ 下的 E4 closure JSON。");
  }
  return {
    outputDirectory,
    e3EvidenceDirectory,
    caseAiEvidenceDirectory,
    dialogueEvidenceDirectory,
    e4ClosurePath,
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
  const environment = sanitizedE5Environment();
  if (input.name === "game.test:e2e") environment["CI"] = "1";
  const result = spawnSync(command, args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: environment,
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

function collectEvidenceDirectoryPaths(
  gameRoot: string,
  directory: string,
  label: string,
): string[] {
  assertExistingDirectoryInside(gameRoot, directory, label);
  const files = walkFiles(directory);
  if (files.length === 0) throw new Error(`${label} contains no evidence files.`);
  return files.map((path) =>
    normalizePortableRelativePath(portableRelative(gameRoot, path), label));
}

function shouldIncludeRuntimeFile(gameRoot: string, absolutePath: string): boolean {
  const path = portableRelative(gameRoot, absolutePath);
  const segments = path.split("/");
  if (!(["model", "share", "game"].includes(segments[0] ?? ""))) return false;
  if (segments.some((segment) => ["node_modules", "dist", ".next", "var", "coverage", ".git"].includes(segment))) return false;
  if (basename(path).startsWith(".env")) return false;
  if (/\.tsbuildinfo$/iu.test(path)) return false;
  if (path === "game/next-env.d.ts") return false;
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
    resolveContainedRegularFile(gameRoot, path, "additional E5 artifact");
  }
  return [...new Set([...discovered, ...additionalPaths])].sort();
}

function runtimeArtifactSetSha256(root: string, paths: readonly string[]): string {
  return sha256Canonical(paths.map((path) => {
    const file = resolveContainedRegularFile(root, path, "E5 runtime artifact fingerprint");
    return {
      path,
      sha256: sha256File(file),
      size: statSync(file).size,
    };
  }));
}

function copyArtifact(root: string, destinationRoot: string, portablePath: string): void {
  const normalizedPath = normalizePortableRelativePath(portablePath, "E5 artifact path");
  const source = resolveContainedRegularFile(root, normalizedPath, "E5 source artifact");
  const destination = resolve(destinationRoot, ...normalizedPath.split("/"));
  const destinationRelative = relative(destinationRoot, destination);
  if (
    destinationRelative === "" ||
    destinationRelative === ".." ||
    destinationRelative.startsWith(`..${sep}`) ||
    isAbsolute(destinationRelative)
  ) {
    throw new Error("E5 destination artifact must stay inside the release root.");
  }
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

function collectEvidenceBinding(root: string, name: string, relativePath: string, status: E5EvidenceBinding["status"]): E5EvidenceBinding {
  const portablePath = normalizePortableRelativePath(relativePath, `${name} evidence path`);
  const path = resolveContainedRegularFile(root, portablePath, name);
  return { name, path: portablePath, sha256: sha256File(path), status };
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

function currentE3BindingStatus(
  modelRoot: string,
  manifest: unknown,
  report: unknown,
): E5EvidenceBinding["status"] {
  try {
    const bindings = isRecord(report) && isRecord(report["bindings"])
      ? report["bindings"]
      : {};
    const provider = isRecord(report) && isRecord(report["provider"])
      ? report["provider"]
      : {};
    const configuredModelId = provider["configuredModelId"];
    const actualModelIds = Array.isArray(provider["actualModelIds"])
      ? provider["actualModelIds"]
      : [];
    const anchorPath = bindings["anchorCasePath"];
    if (typeof anchorPath !== "string") return "stale";
    const anchorAbsolutePath = resolveInside(modelRoot, anchorPath, "E3 anchor case path");
    const [anchorCase] = loadCasePackages([anchorAbsolutePath]);
    if (anchorCase === undefined) return "stale";
    const variants = buildE3PersonaCaseVariants(anchorCase);
    const medicalDigests = [...new Set(variants.map(computeMedicalContentDigest))];
    const currentPromptVersion = stringAt(manifest, "patientPromptVersion");
    const reusePolicy = isRecord(bindings["reusePolicy"])
      ? bindings["reusePolicy"]
      : {};
    const currentSourceBinding = buildE3ReuseSourceBinding(modelRoot);
    const audits = arrayAt(report, "audit");
    const auditRoles = new Set(
      audits.flatMap((entry) =>
        isRecord(entry) && typeof entry["role"] === "string" ? [entry["role"]] : [],
      ),
    );
    const auditModelsAreCurrent = audits.length === 2 &&
      auditRoles.size === 2 &&
      audits.every((entry) =>
        isRecord(entry) &&
        (entry["runStatus"] !== "completed" || entry["modelId"] === configuredModelId),
      );
    return (
      fileBindingMatches(modelRoot, anchorPath, bindings["anchorCaseSha256"]) &&
      typeof currentPromptVersion === "string" &&
      fileBindingMatches(
        modelRoot,
        `prompts/patient/${currentPromptVersion}.md`,
        bindings["patientPromptSha256"],
      ) &&
      bindings["ruleCorpusSha256"] === sha256Canonical(buildE3PersonaRuleCorpus()) &&
      medicalDigests.length === 1 &&
      bindings["medicalContentDigest"] === medicalDigests[0] &&
      sha256Canonical(bindings["variantContentHashes"]) ===
        sha256Canonical(variants.map(({ provenance }) => provenance.contentHash)) &&
      typeof configuredModelId === "string" &&
      configuredModelId.length > 0 &&
      actualModelIds.length > 0 &&
      actualModelIds.every((modelId) => modelId === configuredModelId) &&
      auditModelsAreCurrent &&
      reusePolicy["schemaVersion"] === "e3-reuse-policy-v1" &&
      reusePolicy["configuredModelId"] === configuredModelId &&
      reusePolicy["releasePolicySha256"] ===
        sha256Canonical(isRecord(manifest) ? manifest["releasePolicy"] : undefined) &&
      reusePolicy["sourceFileCount"] === currentSourceBinding.sourceFileCount &&
      reusePolicy["sourceTreeSha256"] === currentSourceBinding.sourceTreeSha256
    ) ? "current" : "stale";
  } catch {
    return "stale";
  }
}

function main(): void {
  const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const gameRoot = resolve(modelRoot, "..");
  let temporaryDirectory: string | undefined;
  try {
    const args = parseE5FullReleaseArguments(process.argv.slice(2));
    const outputDirectory = resolveInside(modelRoot, args.outputDirectory, "E5 output path");
    const e3Directory = resolveInside(modelRoot, args.e3EvidenceDirectory, "E3 evidence path");
    const caseAiDirectory = resolveInside(
      modelRoot,
      args.caseAiEvidenceDirectory,
      "case AI evidence path",
    );
    const dialogueDirectory = resolveInside(
      modelRoot,
      args.dialogueEvidenceDirectory,
      "C7 dialogue evidence path",
    );
    const e4ClosurePath = resolveContainedRegularFile(
      gameRoot,
      args.e4ClosurePath,
      "E4 closure",
    );
    assertExistingDirectoryInside(modelRoot, dirname(outputDirectory), "E5 output parent");
    assertExistingDirectoryInside(modelRoot, e3Directory, "E3 evidence path");
    assertExistingDirectoryInside(modelRoot, caseAiDirectory, "case AI evidence path");
    assertExistingDirectoryInside(modelRoot, dialogueDirectory, "C7 dialogue evidence path");
    if (existsSync(outputDirectory)) throw new Error("E5 输出目录已存在；不会覆盖。");
    requireRegularFile(resolve(e3Directory, "e3-persona-benchmark-report.v2.json"), "E3 report");
    const e3Integrity = verifyE3PersonaEvidenceDirectory(e3Directory);
    const caseAiIndexPath = resolve(caseAiDirectory, "ai-evidence-index.json");
    const caseAiIntegrity = verifyCaseAiCrossReviewIndex({
      modelRoot,
      indexPath: caseAiIndexPath,
    });
    const dialogueIntegrity = verifyC7DialogueEvidenceDirectory({
      modelRoot,
      dialogueEvidenceDirectory: args.dialogueEvidenceDirectory,
      aiEvidenceDirectory: args.caseAiEvidenceDirectory,
    });
    const e4Closure = readJson(e4ClosurePath) as E4PatientIdentityClosure;
    const e4Integrity = verifyE4PatientIdentityClosure({ gameRoot, closure: e4Closure });
    const currentSourceManifestModelPath = "cases/manifest.phase6-compat.v2-rc9.json";
    const currentSourceManifestAbsolutePath = resolve(
      modelRoot,
      ...currentSourceManifestModelPath.split("/"),
    );
    if (
      e4Integrity.sourceManifestPath !== currentSourceManifestModelPath ||
      e4Integrity.sourceManifestSha256 !== sha256File(currentSourceManifestAbsolutePath)
    ) {
      throw new Error("E4 closure is stale against the current E5 source manifest.");
    }
    const e3EvidenceArtifacts = [
      "e3-persona-ai-cross-review.v1.json",
      "e3-persona-benchmark-report.v2.json",
      "e3-persona-rule-corpus.v1.json",
      "private/patient-samples.v1.json",
      ...e3Integrity.journeyArtifacts.map(({ path }) => path),
    ].map((name) => `model/${args.e3EvidenceDirectory}/${name}`);
    const e4JourneyIndexDirectory = resolve(
      gameRoot,
      ...e4Closure.bindings.journeyIndex.path.split("/").slice(0, -1),
    );
    const additionalEvidenceArtifacts = [
      ...e3EvidenceArtifacts,
      ...collectEvidenceDirectoryPaths(gameRoot, caseAiDirectory, "case AI evidence"),
      ...collectEvidenceDirectoryPaths(gameRoot, dialogueDirectory, "C7 dialogue evidence"),
      ...collectEvidenceDirectoryPaths(gameRoot, e4JourneyIndexDirectory, "E4 evidence"),
      args.e4ClosurePath,
    ];
    const preCommandRuntimeArtifactPaths = collectE5RuntimeArtifactPaths(
      gameRoot,
      additionalEvidenceArtifacts,
    );
    const preCommandRuntimeArtifactSetSha256 = runtimeArtifactSetSha256(
      gameRoot,
      preCommandRuntimeArtifactPaths,
    );

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
      ["model.cases:validate:dialogue", "cases:validate:dialogue", [], modelRoot, 900_000],
      ["model.eval:phase7:offline", "eval:phase7:offline", [], modelRoot, 900_000],
      ["model.eval:case-ai-verify", "eval:case-ai-verify", ["--", "--evidence", args.caseAiEvidenceDirectory], modelRoot, 600_000],
      ["model.eval:c7-dialogue-verify", "eval:c7-dialogue-verify", ["--", "--evidence", args.dialogueEvidenceDirectory, "--ai-evidence", args.caseAiEvidenceDirectory], modelRoot, 900_000],
      ["model.eval:e3:persona-verify", "eval:e3:persona-verify", ["--", "--evidence", args.e3EvidenceDirectory], modelRoot, 600_000],
      ["model.eval:e4-closure-verify", "eval:e4-closure-verify", ["--", "--closure", args.e4ClosurePath], modelRoot, 600_000],
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
    const failedTechnicalCommand = commands.find(({ exitCode }) => exitCode !== 0);
    if (failedTechnicalCommand !== undefined) {
      throw new Error(
        `${failedTechnicalCommand.name} failed; E5 will not package a Software RC with a failed technical gate.`,
      );
    }
    const testedRuntimeArtifactPaths = collectE5RuntimeArtifactPaths(
      gameRoot,
      additionalEvidenceArtifacts,
    );
    const testedRuntimeArtifactSetSha256 = runtimeArtifactSetSha256(
      gameRoot,
      testedRuntimeArtifactPaths,
    );
    if (
      sha256Canonical(testedRuntimeArtifactPaths) !==
        sha256Canonical(preCommandRuntimeArtifactPaths) ||
      testedRuntimeArtifactSetSha256 !== preCommandRuntimeArtifactSetSha256
    ) {
      throw new Error("E5 runtime sources changed while verification commands were running.");
    }

    const gameBuildPassed = commands.find(({ name }) => name === "game.build")?.exitCode === 0;
    const staticScan = gameBuildPassed
      ? scanE5StaticClientArtifacts(resolve(gameRoot, "game"))
      : { status: "not_run" as const, scannedFiles: 0, sensitiveMatches: 0, matches: [] };

    const launchPolicyPath = "model/cases/policy/launch-content-policy-v1.json";
    const sourceManifestPath = "model/cases/manifest.phase6-compat.v2-rc9.json";
    const scoringGoldenVectorsPath =
      "model/cases/evaluation/launch-scoring-golden-vectors-v11.json";
    const newDomainSafetyPath = "model/cases/evaluation/phase7-new-domain-safety-v11.json";
    const e3ReportPath = `model/${args.e3EvidenceDirectory}/e3-persona-benchmark-report.v2.json`;
    const caseAiIndexRelativePath = `model/${args.caseAiEvidenceDirectory}/ai-evidence-index.json`;
    const dialogueReportPath = `model/${args.dialogueEvidenceDirectory}/c7-dialogue-architecture-report.json`;
    const launchPolicy = readJson(resolve(gameRoot, ...launchPolicyPath.split("/")));
    const sourceManifest = readJson(resolve(gameRoot, ...sourceManifestPath.split("/")));
    const caseAiIndex = readJson(caseAiIndexPath);
    const expectedSourceManifestModelPath =
      "cases/manifest.phase6-compat.v2-rc9.json";
    const sourceManifestSha256 = sha256File(
      resolve(gameRoot, ...sourceManifestPath.split("/")),
    );
    if (
      stringAt(caseAiIndex, "sourceCandidateManifest", "path") !==
        expectedSourceManifestModelPath ||
      stringAt(caseAiIndex, "sourceCandidateManifest", "sha256") !==
        sourceManifestSha256
    ) {
      throw new Error(
        "case AI evidence is not bound to the fixed current source manifest.",
      );
    }
    const releaseManifestModelPath = stringAt(caseAiIndex, "caseManifest", "path");
    if (releaseManifestModelPath === undefined) {
      throw new Error("case AI evidence does not bind a release manifest path.");
    }
    const releaseManifestPath = `model/${normalizePortableRelativePath(
      releaseManifestModelPath,
      "C7 release manifest path",
    )}`;
    const releaseManifest = readJson(
      resolveContainedRegularFile(gameRoot, releaseManifestPath, "C7 release manifest"),
    );
    if (
      !isRecord(caseAiIndex) ||
      !isRecord(sourceManifest) ||
      !isRecord(releaseManifest)
    ) {
      throw new Error("E5 source/C7 manifest evidence must be JSON objects.");
    }
    const dialogueReport = readJson(
      resolveContainedRegularFile(gameRoot, dialogueReportPath, "C7 dialogue report"),
    );
    const newDomainSafety = readJson(
      resolveContainedRegularFile(gameRoot, newDomainSafetyPath, "new-domain safety corpus"),
    );
    const scoringGoldenVectors = readJson(
      resolveContainedRegularFile(
        gameRoot,
        scoringGoldenVectorsPath,
        "launch scoring golden vectors",
      ),
    );
    const e3Report = readJson(resolve(gameRoot, ...e3ReportPath.split("/")));
    const cases = arrayAt(sourceManifest, "cases");
    const releasedCases = arrayAt(releaseManifest, "cases");
    if (releasedCases.length !== cases.length) {
      throw new Error("C7 released case manifest does not cover the current source manifest.");
    }
    if (
      sha256Canonical(caseAiIndex["releasePolicy"]) !==
        sha256Canonical(sourceManifest["releasePolicy"]) ||
      sha256Canonical(releaseManifest["releasePolicy"]) !==
        sha256Canonical(sourceManifest["releasePolicy"])
    ) {
      throw new Error("C7 release policy is not bound to the current source manifest.");
    }
    const currentIdentityFields = [
      "publicCaseId",
      "patientRoleId",
      "caseVersion",
      "casePackageSchemaVersion",
      "contentHash",
      "diseaseDomainId",
      "difficulty",
      "personaTemplateId",
    ] as const;
    for (const [index, sourceCase] of cases.entries()) {
      const releasedCase = releasedCases[index];
      if (
        !isRecord(sourceCase) || !isRecord(releasedCase) ||
        currentIdentityFields.some(
          (field) => sourceCase[field] !== releasedCase[field],
        )
      ) {
        throw new Error(
          `C7 released case manifest identity drifted from the current source manifest at case ${index + 1}.`,
        );
      }
    }
    const e3Audit = arrayAt(e3Report, "audit");
    const sourceCasePackages = loadSupportedCasePackages(cases.map((binding, index) => {
      if (!isRecord(binding) || typeof binding["path"] !== "string") {
        throw new Error(`Current source manifest case ${index + 1} has no valid path.`);
      }
      return resolveContainedRegularFile(
        resolve(modelRoot, "cases"),
        binding["path"],
        `current source case ${index + 1}`,
      );
    }));
    const licenseAssessments = sourceCasePackages.flatMap((casePackage) =>
      casePackage.schemaVersion === "case-package-v2-rc1"
        ? casePackage.provenance.sources.map(({ licenseAssessment }) => licenseAssessment)
        : []
    );
    const notRunLicenseAssessments = licenseAssessments.filter(
      (assessment) => assessment === "not_run",
    ).length;
    const unresolvedLicenseAssessments = licenseAssessments.filter(
      (assessment) => assessment === "restricted" || assessment === "uncertain",
    ).length;
    const e3Rules = readJson(resolve(e3Directory, "e3-persona-rule-corpus.v1.json"));
    const e3BindingStatus = currentE3BindingStatus(modelRoot, sourceManifest, e3Report);
    const observedCounts: E5ObservedCounts = {
      cases: cases.length,
      trajectories: countRegressionTrajectories(modelRoot, sourceManifest),
      goldenVectors: arrayAt(scoringGoldenVectors, "vectors").length,
      dialogueSamples: PHASE7_EVAL_CORPUS.caseCorpora.reduce((total, corpus) => total + corpus.items.length, 0),
      newDomainSafetySamples: arrayAt(newDomainSafety, "items").length,
      caseAiReviewCalls: caseAiIntegrity.completedCalls,
      personaRuleAssertions: numberAt(e3Rules, "assertionCount"),
      personaLiveTurns: numberAt(e3Report, "coverage", "committedTurns"),
      releaseDialogueTurns: dialogueIntegrity.committedTurns,
      patientRoles: e4Closure.metrics.publicPatientRoles,
    };
    const e4Checks = e4Closure.checks;
    const e4Status = (checkId: string): E5ObservationStatus => {
      const check = e4Checks.find((entry) => isRecord(entry) && entry["checkId"] === checkId);
      return mapObservationStatus(isRecord(check) && check["status"] === "pass" ? "passed" : isRecord(check) ? check["status"] : "not_run");
    };
    const evidenceBindings: E5EvidenceBinding[] = [
      collectEvidenceBinding(gameRoot, "launch-content-policy", launchPolicyPath, "current"),
      collectEvidenceBinding(gameRoot, "current-case-manifest", releaseManifestPath, "current"),
      collectEvidenceBinding(
        gameRoot,
        "scoring-golden-vector-set",
        scoringGoldenVectorsPath,
        "current",
      ),
      collectEvidenceBinding(gameRoot, "new-domain-safety-corpus", newDomainSafetyPath, "current"),
      collectEvidenceBinding(gameRoot, "e3-persona-report", e3ReportPath, e3BindingStatus),
      collectEvidenceBinding(
        gameRoot,
        "case-ai-review-set",
        caseAiIndexRelativePath,
        "current",
      ),
      collectEvidenceBinding(
        gameRoot,
        "c7-dialogue-report",
        dialogueReportPath,
        "current",
      ),
      collectEvidenceBinding(
        gameRoot,
        "e4-patient-identity-closure",
        args.e4ClosurePath,
        "current",
      ),
    ];
    const observedQualityFindings: E5Finding[] = [
      ...arrayAt(caseAiIndex, "reviewFindings").map((finding, index) => ({
        code: isRecord(finding) && typeof finding["code"] === "string"
          ? `E5_CASE_AI_${finding["code"]}`
          : `E5_CASE_AI_FINDING_${index + 1}`,
        status: (isRecord(finding) && finding["decision"] === "not_run"
          ? "not_run"
          : isRecord(finding) && finding["decision"] === "stale"
            ? "stale"
            : isRecord(finding) && finding["decision"] === "missing"
              ? "incomplete"
              : "failed") as E5Finding["status"],
        scope: isRecord(finding) && typeof finding["scope"] === "string"
          ? `case-ai:${finding["scope"]}`
          : "case-ai",
        message: isRecord(finding) && typeof finding["decision"] === "string"
          ? `Case AI review decision: ${finding["decision"]}.`
          : "Case AI review reported a quality finding.",
      })),
      ...arrayAt(dialogueReport, "findings").map((finding, index) => ({
        code: isRecord(finding) && typeof finding["code"] === "string"
          ? `E5_DIALOGUE_${finding["code"]}`
          : `E5_DIALOGUE_FINDING_${index + 1}`,
        status: "failed" as const,
        scope: "c7-dialogue",
        message: isRecord(finding) && typeof finding["message"] === "string"
          ? finding["message"]
          : "C7 dialogue evidence reported a quality finding.",
      })),
      ...(dialogueIntegrity.auditDecision === "approved" ? [] : [{
        code: "E5_DIALOGUE_AI_AUDIT_NOT_APPROVED",
        status: "failed" as const,
        scope: "c7-dialogue-audit",
        message: `C7 dialogue AI audit decision: ${dialogueIntegrity.auditDecision}.`,
      }]),
      ...(dialogueIntegrity.approvalDecision === "approved" ? [] : [{
        code: "E5_DIALOGUE_PROVIDER_MODEL_APPROVAL_NOT_APPROVED",
        status: "failed" as const,
        scope: "c7-provider-model-approval",
        message: `C7 provider/model approval decision: ${dialogueIntegrity.approvalDecision}.`,
      }]),
      ...(notRunLicenseAssessments === 0 ? [] : [{
        code: "E5_PROVENANCE_LICENSE_REVIEW_NOT_RUN",
        status: "not_run" as const,
        scope: "case-provenance",
        message: `${notRunLicenseAssessments} provenance source license assessments were not run.`,
        expected: 0,
        actual: notRunLicenseAssessments,
      }]),
      ...(unresolvedLicenseAssessments === 0 ? [] : [{
        code: "E5_PROVENANCE_LICENSE_UNRESOLVED",
        status: "failed" as const,
        scope: "case-provenance",
        message: `${unresolvedLicenseAssessments} provenance source licenses are restricted or uncertain.`,
        expected: 0,
        actual: unresolvedLicenseAssessments,
      }]),
    ];
    const generatedAt = new Date().toISOString();
    const caseAiProviderNotRun =
      stringAt(caseAiIndex, "caseReviewEvidence", "status") === "incomplete" ||
      arrayAt(caseAiIndex, "reviewFindings").some(
        (finding) => isRecord(finding) && finding["decision"] === "not_run",
      );
    const providerStatus: E5ObservationStatus = caseAiProviderNotRun
      ? "not_run"
      : caseAiIntegrity.status === "complete" &&
          dialogueIntegrity.status === "passed" &&
          dialogueIntegrity.auditDecision === "approved" &&
          dialogueIntegrity.approvalDecision === "approved" &&
          dialogueIntegrity.provider.actualModelId === dialogueIntegrity.provider.configuredModelId
        ? "passed"
        : "failed";
    const acceptanceReport = buildE5AcceptanceReport({
      targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
      observedCounts,
      localCommandReports: commands,
      provider: providerStatus,
      e3: {
        status: mapObservationStatus(stringAt(e3Report, "decision")),
        metrics: {
          ruleAssertions: observedCounts.personaRuleAssertions,
          committedTurns: observedCounts.personaLiveTurns,
          completedAiReviews: e3Audit.filter((entry) => isRecord(entry) && entry["runStatus"] === "completed").length,
          currentCaseAiReviews: observedCounts.caseAiReviewCalls,
          caseAiReviewChecks: caseAiIntegrity.checkAssertions,
          e3BindingDrift: e3BindingStatus === "stale" ? 1 : 0,
          safetyCorpusSamples:
            PHASE7_SAFETY_CORPUS_V1.length + observedCounts.newDomainSafetySamples,
          launchPolicyCases: arrayAt(launchPolicy, "cases").length,
        },
      },
      e4: {
        live: e4Status("thirty_case_live_cross_layer_journey"),
        storage: e4Status("runtime_storage_and_log_leakage_scan"),
        aiReviews: e4Closure.aiCrossReview.reviews.map(({ status }) =>
          status === "pass" ? "passed" : status === "not_run" ? "not_run" : "failed"),
      },
      staticClientScan: staticScan,
      evidenceBindings,
      observedQualityFindings,
      generatedAt,
    });

    const sourceState = collectE5SourceState(gameRoot);
    if (
      resolveContainedPathForCreate(
        modelRoot,
        args.outputDirectory,
        "E5 output path before staging",
      ) !== outputDirectory
    ) {
      throw new Error("E5 output path real location changed before staging.");
    }
    temporaryDirectory = `${outputDirectory}.tmp-${process.pid}-${Date.now()}`;
    if (existsSync(temporaryDirectory)) throw new Error("E5 temporary output already exists.");
    mkdirSync(temporaryDirectory, { recursive: false });
    assertContainedDirectory(modelRoot, temporaryDirectory, "E5 temporary output");

    const outputName = basename(outputDirectory);
    const acceptanceArtifactPath = `model/evaluation/phase8/${outputName}/${ACCEPTANCE_FILENAME}`;
    const releaseRoot = resolve(temporaryDirectory, "release-root");
    mkdirSync(releaseRoot, { recursive: true });
    const runtimeArtifactPaths = collectE5RuntimeArtifactPaths(
      gameRoot,
      additionalEvidenceArtifacts,
    );
    assertContainedDirectory(modelRoot, temporaryDirectory, "E5 temporary output before copy");
    if (
      sha256Canonical(runtimeArtifactPaths) !== sha256Canonical(testedRuntimeArtifactPaths) ||
      runtimeArtifactSetSha256(gameRoot, runtimeArtifactPaths) !== testedRuntimeArtifactSetSha256
    ) {
      throw new Error("E5 runtime sources changed after command verification.");
    }
    for (const path of runtimeArtifactPaths) copyArtifact(gameRoot, releaseRoot, path);
    if (runtimeArtifactSetSha256(releaseRoot, runtimeArtifactPaths) !== testedRuntimeArtifactSetSha256) {
      throw new Error("E5 staged runtime artifact set differs from the tested source set.");
    }
    const stagedE3Directory = resolve(
      releaseRoot,
      "model",
      ...args.e3EvidenceDirectory.split("/"),
    );
    const stagedE3Integrity = verifyE3PersonaEvidenceDirectory(stagedE3Directory);
    if (stagedE3Integrity.reportSha256 !== e3Integrity.reportSha256) {
      throw new Error("E3 report changed between verification and Software RC staging.");
    }
    const stagedSourceManifest = readJson(
      resolve(releaseRoot, ...sourceManifestPath.split("/")),
    );
    const stagedE3Report = readJson(
      resolve(releaseRoot, ...e3ReportPath.split("/")),
    );
    const stagedModelRoot = resolve(releaseRoot, "model");
    const stagedE4Closure = readJson(
      resolve(releaseRoot, ...args.e4ClosurePath.split("/")),
    ) as E4PatientIdentityClosure;
    if (currentE3BindingStatus(stagedModelRoot, stagedSourceManifest, stagedE3Report) !== e3BindingStatus) {
      throw new Error("E3 freshness status changed during Software RC staging.");
    }
    const stagedCaseAiIntegrity = verifyCaseAiCrossReviewIndex({
      modelRoot: stagedModelRoot,
      indexPath: resolve(
        stagedModelRoot,
        ...args.caseAiEvidenceDirectory.split("/"),
        "ai-evidence-index.json",
      ),
    });
    const stagedDialogueIntegrity = verifyC7DialogueEvidenceDirectory({
      modelRoot: stagedModelRoot,
      dialogueEvidenceDirectory: args.dialogueEvidenceDirectory,
      aiEvidenceDirectory: args.caseAiEvidenceDirectory,
    });
    const stagedE4Integrity = verifyE4PatientIdentityClosure({
      gameRoot: releaseRoot,
      closure: stagedE4Closure,
    });
    if (
      sha256Canonical(stagedCaseAiIntegrity) !== sha256Canonical(caseAiIntegrity) ||
      sha256Canonical(stagedDialogueIntegrity) !== sha256Canonical(dialogueIntegrity) ||
      sha256Canonical(stagedE4Integrity) !== sha256Canonical(e4Integrity)
    ) {
      throw new Error("E4/C7 evidence integrity changed during Software RC staging.");
    }
    writeJsonExclusive(resolve(releaseRoot, ...acceptanceArtifactPath.split("/")), acceptanceReport);
    const manifestValue = buildE5RuntimeReleaseManifest({
      rootDirectory: releaseRoot,
      artifactPaths: runtimeArtifactPaths,
      acceptanceReportPath: acceptanceArtifactPath,
      sourceState,
      providerObservation: dialogueIntegrity.provider.actualModelId === undefined
        ? {
            status: providerStatus === "not_run" ? "not_run" : "failed",
            findings: observedQualityFindings.map(
              ({ code, scope }) => `${code}: ${scope}`,
            ),
          }
        : {
            status: "observed",
            qualityStatus: providerStatus,
            providerName: dialogueIntegrity.provider.providerName,
            configuredModelId: dialogueIntegrity.provider.configuredModelId,
            actualModelId: dialogueIntegrity.provider.actualModelId,
            findings: observedQualityFindings.map(
              ({ code, scope }) => `${code}: ${scope}`,
            ),
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
    assertContainedDirectory(modelRoot, temporaryDirectory, "E5 temporary output before archive");
    runRequiredProcess("tar", ["-czf", archivePath, "-C", temporaryDirectory, "software-rc"], gameRoot, 600_000);
    const sums = [ACCEPTANCE_FILENAME, MANIFEST_FILENAME, INDEX_FILENAME, ARCHIVE_FILENAME].map((name) => {
      const path = resolve(temporaryDirectory!, name);
      return { path: name, sha256: sha256File(path), size: statSync(path).size };
    });
    writeJsonExclusive(resolve(temporaryDirectory, SUMS_FILENAME), { schemaVersion: "e5-sha256sums-v1", generatedAt, files: sums });
    rmSync(releaseRoot, { recursive: true, force: true });
    if (
      resolveContainedPathForCreate(
        modelRoot,
        args.outputDirectory,
        "E5 output path before publish",
      ) !== outputDirectory
    ) {
      throw new Error("E5 output path real location changed before publish.");
    }
    assertContainedDirectory(modelRoot, temporaryDirectory, "E5 temporary output before publish");
    publishDirectoryExclusive(temporaryDirectory, outputDirectory);
    assertExistingDirectoryInside(modelRoot, outputDirectory, "E5 final output");
    temporaryDirectory = undefined;
    process.stdout.write(`${JSON.stringify({ status: "E5_SOFTWARE_RC_CREATED", outputDirectory: portableRelative(modelRoot, outputDirectory), decision: acceptanceReport.decision, artifacts: manifestValue.artifacts.length, findings: acceptanceReport.findings.length }, null, 2)}\n`);
  } catch (error) {
    if (temporaryDirectory !== undefined && existsSync(temporaryDirectory)) rmSync(temporaryDirectory, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : "未知 E5 发布错误。";
    process.stderr.write(`E5 全量发布失败：${message}\n`);
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
