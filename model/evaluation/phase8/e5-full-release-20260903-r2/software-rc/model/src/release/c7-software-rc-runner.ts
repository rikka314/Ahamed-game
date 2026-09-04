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
import { scanRuntimeArtifactSet } from "./runtime-artifact-security.js";

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

interface FreshCommandReport {
  status: "passed" | "failed";
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
}

function runFreshCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  environment?: Record<string, string>;
  timeoutMs: number;
}): FreshCommandReport {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: { ...sanitizedEnvironment(), ...input.environment },
    input: input.stdin,
    timeout: input.timeoutMs,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status === null) {
    throw new Error(
      `fresh Software RC command could not execute: ${input.command} ${input.args.join(" ")} (${result.error?.message ?? result.signal ?? "unknown process failure"})`,
    );
  }
  return {
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    stdoutSha256: createHash("sha256").update(result.stdout ?? "").digest("hex"),
    stderrSha256: createHash("sha256").update(result.stderr ?? "").digest("hex"),
  };
}

function verifyFreshBundle(bundleRoot: string): {
  status: "passed" | "reported_with_findings";
  reviewPolicy: "non_blocking";
  commands: Record<string, FreshCommandReport>;
  findings: Array<{ code: string; scope: string; message: string }>;
} {
  const verificationRoot = mkdtempSync(join(tmpdir(), "ahamed-c7-rc-"));
  try {
    cpSync(bundleRoot, verificationRoot, { recursive: true });
    const npm = process.platform === "win32"
      ? (process.env["ComSpec"] ?? "cmd.exe")
      : "npm";
    const npmArgs = (args: string[]): string[] => process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", ...args]
      : args;
    const shareRoot = resolve(verificationRoot, "share");
    const modelRoot = resolve(verificationRoot, "model");
    const commands = {
      shareInstall: runFreshCommand({
      command: npm,
      args: npmArgs(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]),
      cwd: shareRoot,
      timeoutMs: 180_000,
      }),
      modelInstall: runFreshCommand({
      command: npm,
      args: npmArgs(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]),
      cwd: modelRoot,
      timeoutMs: 180_000,
      }),
      shareTests: runFreshCommand({
      command: npm,
      args: npmArgs(["test"]),
      cwd: shareRoot,
      timeoutMs: 300_000,
      }),
      modelTests: runFreshCommand({
      command: npm,
      args: npmArgs(["test"]),
      cwd: modelRoot,
      timeoutMs: 300_000,
      }),
      smoke: runFreshCommand({
      command: process.execPath,
      args: [
        "dist/src/cli/main.js",
        "--user",
        "rc-smoke",
        "--database",
        "var/rc-smoke.sqlite",
        "--provider",
        "deterministic",
      ],
      cwd: modelRoot,
      stdin: "/exit\n",
      environment: {
        SAFETY_AUDIT_HMAC_KEY: `c7-rc-smoke-${"x".repeat(32)}`,
      },
      timeoutMs: 30_000,
      }),
    };
    const findings = Object.entries(commands)
      .filter(([, report]) => report.status !== "passed")
      .map(([scope, report]) => ({
        code: "FRESH_VERIFICATION_COMMAND_FAILED",
        scope,
        message: `command exited with code ${report.exitCode}`,
      }));
    return {
      status: findings.length === 0 ? "passed" : "reported_with_findings",
      reviewPolicy: "non_blocking",
      commands,
      findings,
    };
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
    const stagedSecurityScan = scanRuntimeArtifactSet(
      bundleRoot,
      [...manifest.artifacts.map(({ path }) => path), "runtime-release-manifest.v1.json"],
    );
    if (
      stagedSecurityScan.secretFindings.length > 0 ||
      stagedSecurityScan.hiddenFieldFindings.length > 0
    ) {
      throw new Error("staged Software RC security scan found a secret or hidden field");
    }
    const freshVerification = verifyFreshBundle(bundleRoot);
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
      reviewPolicy: "non_blocking",
      findings: [
        ...(manifest.qualityReport?.findings ?? []),
        ...freshVerification.findings,
      ],
      freshVerification,
      stagedSecurityScan: {
        status: "passed",
        scannedTextFiles: stagedSecurityScan.scannedTextFiles,
        scannedPublicEvidenceFiles: stagedSecurityScan.scannedPublicEvidenceFiles,
        secretFindings: stagedSecurityScan.secretFindings,
        hiddenFieldFindings: stagedSecurityScan.hiddenFieldFindings,
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
      reviewPolicy: index.reviewPolicy,
      findings: index.findings.length,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Software RC 错误。";
    process.stderr.write(`C7 Software RC 失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
