import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPhase6CaseBundlesFromManifest } from "../cases/phase6-case-production.js";
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import {
  assertContainedDirectory,
  publishDirectoryExclusive,
  resolveContainedDirectory,
  resolveContainedPathForCreate,
  resolveContainedRegularFile,
} from "../security/contained-path.js";
import {
  buildE4CrossLayerJourney,
  buildE4EvidenceIndex,
  canonicalJson,
  sha256E4,
} from "./e4-cross-layer-evidence.js";

interface Arguments {
  manifestPath: string;
  outputDirectory: string;
}

function parseArguments(argv: readonly string[]): Arguments {
  let manifestPath = "cases/manifest.phase6-compat.v2-rc9.json";
  let outputDirectory: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--manifest" || flag === "--output") && value !== undefined) {
      if (flag === "--manifest") manifestPath = value;
      else outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete E4 journey argument: ${flag ?? ""}`);
  }
  if (outputDirectory === undefined) throw new Error("E4 journey requires --output.");
  return { manifestPath, outputDirectory };
}

function resolveInside(root: string, portablePath: string, label: string): string {
  return resolveContainedPathForCreate(root, portablePath, label);
}

function writeExclusive(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const casesRoot = resolveContainedDirectory(modelRoot, "cases", "E4 cases root");
  const manifestFile = resolveContainedRegularFile(modelRoot, args.manifestPath, "E4 manifest");
  const outputDirectory = resolveInside(modelRoot, args.outputDirectory, "output directory");
  if (existsSync(outputDirectory)) throw new Error("E4 journey output already exists; refusing to overwrite evidence.");
  const temporaryDirectory = `${outputDirectory}.tmp-${randomUUID()}`;
  try {
    mkdirSync(temporaryDirectory, { recursive: false });
    assertContainedDirectory(modelRoot, temporaryDirectory, "E4 journey staging output");
    const manifest = loadCaseManifestV2(manifestFile);
    const loaded = loadPhase6CaseBundlesFromManifest({
      casesDirectory: casesRoot,
      manifest,
      manifestPath: manifestFile,
    });
    const manifestSha256 = sha256E4(readFileSync(manifestFile));
    const generatedAt = new Date().toISOString();
    const journey = await buildE4CrossLayerJourney({
      cases: loaded.bundles.map(({ casePackage }) => casePackage),
      manifestPath: args.manifestPath,
      manifestSha256,
      generatedAt,
    });
    const publicPath = "public/e4-cross-layer-journey.v1.json";
    const privatePath = "private/e4-cross-layer-journey.v1.json";
    const publicContent = canonicalJson(journey.publicEvidence);
    const privateContent = canonicalJson(journey.privateEvidence);
    writeExclusive(resolve(temporaryDirectory, ...publicPath.split("/")), publicContent);
    writeExclusive(resolve(temporaryDirectory, ...privatePath.split("/")), privateContent);
    const index = buildE4EvidenceIndex({
      generatedAt,
      manifestPath: args.manifestPath,
      manifestSha256,
      publicPath,
      publicContent,
      privatePath,
      privateContent,
    });
    writeExclusive(
      resolve(temporaryDirectory, "e4-cross-layer-evidence-index.v1.json"),
      canonicalJson(index),
    );
    resolveInside(modelRoot, args.outputDirectory, "E4 journey output directory");
    publishDirectoryExclusive(temporaryDirectory, outputDirectory);
    assertContainedDirectory(modelRoot, outputDirectory, "E4 journey final output");
    process.stdout.write(`${canonicalJson({ outputDirectory: args.outputDirectory, caseCount: 30, shiftCount: 15, artifactSetSha256: index.artifactSetSha256 })}`);
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
