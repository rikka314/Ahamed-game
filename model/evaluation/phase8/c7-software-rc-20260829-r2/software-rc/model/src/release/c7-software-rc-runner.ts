import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertSoftwareRcArtifactPath } from "./c7-runtime-release.js";
import {
  sha256Canonical,
  verifyRuntimeReleaseManifest,
  type RuntimeReleaseManifestV1,
} from "./phase8-release.js";

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
    throw new Error(`${label} must stay inside its approved root.`);
  }
  return resolvedPath;
}

function requireRegularFile(path: string): string {
  if (!existsSync(path)) throw new Error(`Software RC source is missing: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Software RC source must be a non-symlink file: ${path}`);
  }
  return path;
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/(?:API|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|HMAC|PRIVATE).*KEY|(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|HMAC)/iu.test(key),
    ),
  );
}

function runFreshCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
}): void {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: sanitizedEnvironment(),
    input: input.stdin,
    timeout: input.timeoutMs,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .slice(-6000);
    throw new Error(
      `fresh Software RC verification failed: ${input.command} ${input.args.join(" ")}\n${detail}`,
    );
  }
}

function verifyFreshBundle(bundleRoot: string): void {
  const verificationRoot = mkdtempSync(join(tmpdir(), "ahamed-c7-rc-"));
  try {
    cpSync(bundleRoot, verificationRoot, { recursive: true });
    const npm = "npm";
    const shareRoot = resolve(verificationRoot, "share");
    const modelRoot = resolve(verificationRoot, "model");
    runFreshCommand({
      command: npm,
      args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd: shareRoot,
      timeoutMs: 180_000,
    });
    runFreshCommand({
      command: npm,
      args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd: modelRoot,
      timeoutMs: 180_000,
    });
    runFreshCommand({
      command: npm,
      args: ["test"],
      cwd: modelRoot,
      timeoutMs: 300_000,
    });
    runFreshCommand({
      command: process.execPath,
      args: ["dist/src/cli/local-dev-main.js"],
      cwd: modelRoot,
      stdin: ":quit\n",
      timeoutMs: 30_000,
    });
  } finally {
    rmSync(verificationRoot, { recursive: true, force: true });
  }
}

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (
      argv.length !== 4 ||
      argv[0] !== "--manifest" ||
      argv[2] !== "--output" ||
      argv[1] === undefined ||
      argv[3] === undefined
    ) {
      throw new Error("用法：npm run c7:bundle -- --manifest <manifest.json> --output <dir>");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const gameRoot = resolve(modelRoot, "..");
    const manifestPath = resolveInside(modelRoot, argv[1], "manifest path");
    const outputDirectory = resolveInside(modelRoot, argv[3], "Software RC output path");
    if (existsSync(outputDirectory)) throw new Error("Software RC 输出已存在；不会覆盖。 ");
    const manifest = JSON.parse(
      readFileSync(requireRegularFile(manifestPath), "utf8"),
    ) as RuntimeReleaseManifestV1;
    if (manifest.artifactRoot !== "game") {
      throw new Error("C7 Software RC manifest must use the game artifact root.");
    }
    const verified = verifyRuntimeReleaseManifest(manifest, gameRoot);
    const bundleRoot = resolve(outputDirectory, "software-rc");
    mkdirSync(bundleRoot, { recursive: true });
    for (const artifact of manifest.artifacts) {
      assertSoftwareRcArtifactPath(artifact.path);
      const source = requireRegularFile(
        resolveInside(gameRoot, artifact.path, "Software RC source path"),
      );
      const destination = resolveInside(bundleRoot, artifact.path, "Software RC destination path");
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination, 0);
      if (sha256File(destination) !== artifact.sha256) {
        throw new Error(`Software RC copy hash mismatch: ${artifact.path}`);
      }
    }
    const bundledManifestPath = resolve(bundleRoot, "runtime-release-manifest.v1.json");
    copyFileSync(manifestPath, bundledManifestPath);
    verifyRuntimeReleaseManifest(manifest, bundleRoot);
    verifyFreshBundle(bundleRoot);
    const index = {
      schemaVersion: "c7-software-rc-index-v1",
      buildVersion: manifest.buildVersion,
      generatedAt: new Date().toISOString(),
      runtimeManifest: {
        sourcePath: relative(modelRoot, manifestPath).replaceAll("\\", "/"),
        bundledPath: "software-rc/runtime-release-manifest.v1.json",
        sha256: sha256File(bundledManifestPath),
        manifestSha256: manifest.manifestSha256,
      },
      artifactCount: verified.artifactCount,
      providerCount: verified.providerCount,
      remoteInteractiveEnabled: verified.remoteInteractiveEnabled,
      artifactSetSha256: sha256Canonical(manifest.artifacts),
      freshVerification: {
        status: "passed",
        shareInstall: "npm ci --ignore-scripts",
        modelInstall: "npm ci --ignore-scripts",
        buildAndTests: "npm test",
        smoke: "node dist/src/cli/local-dev-main.js with :quit",
      },
    };
    mkdirSync(outputDirectory, { recursive: true });
    const indexPath = resolve(outputDirectory, "software-rc-index.json");
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({
      status: "C7_SOFTWARE_RC_READY",
      outputDirectory: relative(modelRoot, outputDirectory).replaceAll("\\", "/"),
      indexSha256: sha256File(indexPath),
      artifactCount: index.artifactCount,
      freshVerification: index.freshVerification.status,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Software RC 错误。";
    process.stderr.write(`C7 Software RC 失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
