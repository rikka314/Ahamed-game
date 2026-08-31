import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { scanRuntimeArtifactSet } from "./runtime-artifact-security.js";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "dist",
  "node_modules",
  "var",
]);

function collectFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function isIgnoredEnvironmentFile(gameRoot: string, path: string): boolean {
  const portable = relative(gameRoot, path).replaceAll("\\", "/");
  return portable === "model/.env" ||
    portable === "share/.env" ||
    (portable.startsWith("model/.env.") && portable !== "model/.env.example") ||
    (portable.startsWith("share/.env.") && portable !== "share/.env.example");
}

function optionalOutputPath(modelRoot: string, argv: readonly string[]): string | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length !== 2 || argv[0] !== "--output" || argv[1] === undefined) {
    throw new Error("用法：npm run phase8:security-scan -- [--output <report.json>]");
  }
  if (isAbsolute(argv[1])) throw new Error("security scan output must be relative");
  const outputPath = resolve(modelRoot, argv[1]);
  const relativePath = relative(modelRoot, outputPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("security scan output must stay inside model/");
  }
  if (existsSync(outputPath)) throw new Error("security scan output already exists");
  return outputPath;
}

function main(): void {
  try {
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const gameRoot = resolve(modelRoot, "..");
    const shareRoot = resolve(gameRoot, "share");
    const outputPath = optionalOutputPath(modelRoot, process.argv.slice(2));
    const files = [...collectFiles(modelRoot), ...collectFiles(shareRoot)];
    const scanPaths = files
      .filter((path) => !isIgnoredEnvironmentFile(gameRoot, path))
      .map((path) => relative(gameRoot, path).replaceAll("\\", "/"));
    const {
      scannedTextFiles,
      scannedPublicEvidenceFiles,
      secretFindings,
      hiddenFieldFindings,
    } = scanRuntimeArtifactSet(gameRoot, scanPaths);

    const envExample = readFileSync(resolve(modelRoot, ".env.example"), "utf8");
    const hmacConfiguration = {
      documented: envExample.includes("SAFETY_AUDIT_HMAC_KEY="),
      minimumLengthDocumented: /At least 32 characters/u.test(envExample),
      ignoredFromGit: readFileSync(resolve(modelRoot, ".gitignore"), "utf8").includes(
        ".env*",
      ),
    };
    const databaseArtifacts = files
      .filter((path) => /\.(?:sqlite|sqlite-wal|sqlite-shm|db|db-wal|db-shm)$/u.test(path))
      .map((path) => ({
        path: relative(gameRoot, path).replaceAll("\\", "/"),
        size: statSync(path).size,
      }));
    const blockers = [
      ...secretFindings.map(({ file, patternId }) => `${patternId}:${file}`),
      ...hiddenFieldFindings.map(({ file, field }) => `${field}:${file}`),
      ...(!hmacConfiguration.documented ||
      !hmacConfiguration.minimumLengthDocumented ||
      !hmacConfiguration.ignoredFromGit
        ? ["HMAC_CONFIGURATION_INCOMPLETE"]
        : []),
    ];
    const report = {
      schemaVersion: "phase8-security-scan-report-v1",
      generatedAt: new Date().toISOString(),
      status: blockers.length === 0 ? "passed" : "failed",
      scannedRoots: ["model", "share"],
      scannedTextFiles,
      scannedPublicEvidenceFiles,
      secretFindings,
      hiddenFieldFindings,
      hmacConfiguration,
      databaseArtifacts,
      blockers,
    };
    if (outputPath !== undefined) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (blockers.length > 0) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知安全扫描错误。";
    process.stderr.write(`Phase 8 安全扫描失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
