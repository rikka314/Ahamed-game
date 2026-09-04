import { randomUUID } from "node:crypto";
import { existsSync, linkSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  sha256E4,
  sha256E4Canonical,
  type E4CrossLayerEvidenceIndex,
  type E4PublicCrossLayerJourney,
  type E4RuntimeSurfaceScan,
} from "../evaluation/e4-cross-layer-evidence.js";
import type { E4IndependentAiReview } from "../evaluation/e4-independent-ai-review.js";
import {
  assertContainedRegularFile,
  resolveContainedPathForCreate,
  resolveContainedRegularFile,
} from "../security/contained-path.js";
import {
  buildE4ClosureReviewTarget,
  buildE4PatientIdentityClosure,
  type E4ArtifactBinding,
  type E4ClosureReviewTarget,
} from "./e4-closure.js";

type Mode = "target" | "close";

function argumentMap(argv: readonly string[]): { mode: Mode; values: Map<string, string> } {
  const mode = argv[0];
  if (mode !== "target" && mode !== "close") throw new Error("E4 closure runner mode must be target or close.");
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || values.has(key)) {
      throw new Error(`Invalid E4 closure argument: ${key ?? ""}`);
    }
    values.set(key, value);
  }
  return { mode, values };
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.trim().length === 0) throw new Error(`E4 closure requires ${name}.`);
  return value;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function binding(gameRoot: string, portablePath: string): E4ArtifactBinding {
  const path = resolveContainedRegularFile(gameRoot, portablePath, "E4 artifact");
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`E4 artifact is not a regular file: ${portablePath}`);
  return { path: portablePath, sha256: sha256E4(readFileSync(path)), bytes: stats.size };
}

function scannerBinding(gameRoot: string, scan: E4RuntimeSurfaceScan): E4ArtifactBinding {
  const current = binding(gameRoot, scan.scannerImplementation.path);
  if (
    current.sha256 !== scan.scannerImplementation.sha256 ||
    current.bytes !== scan.scannerImplementation.bytes
  ) {
    throw new Error("E4 runtime scan was not produced by the current bound scanner implementation.");
  }
  return current;
}

function writeAtomicExclusive(
  root: string,
  portablePath: string,
  value: unknown,
): void {
  const path = resolveContainedPathForCreate(root, portablePath, "E4 closure output");
  if (existsSync(path)) throw new Error("E4 closure output exists; refusing to overwrite immutable evidence.");
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, canonicalJson(value), { encoding: "utf8", flag: "wx" });
    assertContainedRegularFile(root, temporaryPath, "E4 temporary closure artifact");
    resolveContainedPathForCreate(root, portablePath, "E4 closure output");
    linkSync(temporaryPath, path);
    assertContainedRegularFile(root, path, "E4 final closure artifact");
  } catch (error) {
    throw error;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function assertOutputScope(mode: Mode, portablePath: string): void {
  const pattern = mode === "target"
    ? /^model\/evaluation\/phase8\/[A-Za-z0-9._/-]+\/private\/[A-Za-z0-9._-]+\.json$/u
    : /^share\/versions\/e4-patient-identity-e5-closure[A-Za-z0-9._-]*\.json$/u;
  if (!pattern.test(portablePath)) throw new Error(`E4 ${mode} output path is outside its allowed immutable evidence scope.`);
}

function verifyJourneyIndex(gameRoot: string, indexPath: string, index: E4CrossLayerEvidenceIndex): void {
  const indexDirectory = dirname(resolveContainedRegularFile(gameRoot, indexPath, "E4 journey index"));
  if (index.artifacts.length !== 2) throw new Error("E4 journey index must bind public and private artifacts.");
  for (const artifact of index.artifacts) {
    const artifactPath = resolveContainedRegularFile(
      indexDirectory,
      artifact.path,
      "E4 journey artifact",
    );
    const stats = statSync(artifactPath);
    if (!stats.isFile() || stats.size !== artifact.bytes || sha256E4(readFileSync(artifactPath)) !== artifact.sha256) {
      throw new Error(`E4 journey artifact binding failed: ${artifact.path}`);
    }
  }
}

function targetMode(gameRoot: string, values: Map<string, string>): void {
  const basePath = required(values, "--base");
  const indexPath = required(values, "--journey-index");
  const publicPath = required(values, "--public-journey");
  const scanPath = required(values, "--runtime-scan");
  const outputPath = required(values, "--output");
  assertOutputScope("target", outputPath);
  const runtimeSurfaceScan = readJson<E4RuntimeSurfaceScan>(resolveContainedRegularFile(gameRoot, scanPath, "E4 runtime scan"));
  scannerBinding(gameRoot, runtimeSurfaceScan);
  const target = buildE4ClosureReviewTarget({
    baseQualityRecord: readJson(resolveContainedRegularFile(gameRoot, basePath, "E4 base record")),
    journeyIndex: readJson<E4CrossLayerEvidenceIndex>(
      resolveContainedRegularFile(gameRoot, indexPath, "E4 journey index"),
    ),
    publicJourney: readJson<E4PublicCrossLayerJourney>(resolveContainedRegularFile(gameRoot, publicPath, "E4 public journey")),
    runtimeSurfaceScan,
  });
  writeAtomicExclusive(gameRoot, outputPath, target);
  process.stdout.write(canonicalJson({ mode: "target", outputPath, contentSha256: sha256E4Canonical(target) }));
}

function closeMode(gameRoot: string, values: Map<string, string>): void {
  const paths = {
    base: required(values, "--base"),
    index: required(values, "--journey-index"),
    publicJourney: required(values, "--public-journey"),
    scan: required(values, "--runtime-scan"),
    target: required(values, "--review-target"),
    contractReview: required(values, "--contract-review"),
    leakageReview: required(values, "--leakage-review"),
    output: required(values, "--output"),
  };
  assertOutputScope("close", paths.output);
  const journeyIndex = readJson<E4CrossLayerEvidenceIndex>(resolveContainedRegularFile(gameRoot, paths.index, "E4 journey index"));
  verifyJourneyIndex(gameRoot, paths.index, journeyIndex);
  const indexedPublic = journeyIndex.artifacts.find(({ visibility }) => visibility === "public");
  const publicBinding = binding(gameRoot, paths.publicJourney);
  if (indexedPublic === undefined || indexedPublic.sha256 !== publicBinding.sha256 || indexedPublic.bytes !== publicBinding.bytes) {
    throw new Error("E4 public journey does not match the journey index.");
  }
  const reviews = [paths.contractReview, paths.leakageReview].map((path) =>
    readJson<E4IndependentAiReview>(resolveContainedRegularFile(gameRoot, path, "E4 AI review")),
  );
  const runtimeSurfaceScan = readJson<E4RuntimeSurfaceScan>(resolveContainedRegularFile(gameRoot, paths.scan, "E4 runtime scan"));
  const closure = buildE4PatientIdentityClosure({
    baseQualityRecord: readJson(resolveContainedRegularFile(gameRoot, paths.base, "E4 base record")),
    journeyIndex,
    publicJourney: readJson<E4PublicCrossLayerJourney>(resolveContainedRegularFile(gameRoot, paths.publicJourney, "E4 public journey")),
    runtimeSurfaceScan,
    reviewTarget: readJson<E4ClosureReviewTarget>(resolveContainedRegularFile(gameRoot, paths.target, "E4 review target")),
    reviews,
    bindings: {
      baseQualityRecord: binding(gameRoot, paths.base),
      journeyIndex: binding(gameRoot, paths.index),
      publicJourney: publicBinding,
      runtimeSurfaceScan: binding(gameRoot, paths.scan),
      scannerImplementation: scannerBinding(gameRoot, runtimeSurfaceScan),
      reviewTarget: binding(gameRoot, paths.target),
      aiReviews: [binding(gameRoot, paths.contractReview), binding(gameRoot, paths.leakageReview)],
    },
  });
  writeAtomicExclusive(gameRoot, paths.output, closure);
  process.stdout.write(canonicalJson({ mode: "close", outputPath: paths.output, decision: closure.decision }));
}

function main(): void {
  const { mode, values } = argumentMap(process.argv.slice(2));
  const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const gameRoot = resolve(modelRoot, "..");
  if (mode === "target") targetMode(gameRoot, values);
  else closeMode(gameRoot, values);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
