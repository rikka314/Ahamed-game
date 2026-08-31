import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEST_FILES = [
  "c7-case-release.test.js",
  "c7-dialogue-architecture-benchmark.test.js",
  "c7-dialogue-live-evidence.test.js",
  "c7-runtime-release.test.js",
  "phase8-ai-evidence.test.js",
  "patient-agent-contract.test.js",
  "provider-output-gates.test.js",
  "safe-patient-case-view.test.js",
  "phase4-service.test.js",
  "sqlite-persistence.test.js",
  "phase2-hardening.test.js",
  "phase2-recovery.test.js",
  "turn-request-crypto.test.js",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) throw new Error("C7 evidence path must be relative.");
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("C7 evidence path must stay inside model/.");
  }
  return resolvedPath;
}

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--output" || argv[1] === undefined) {
      throw new Error("用法：npm run c7:accept -- --output <evidence.json>");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const outputPath = resolveInsideModel(modelRoot, argv[1]);
    if (existsSync(outputPath)) throw new Error("C7 evidence 已存在；不会覆盖。 ");
    const compiledTests = TEST_FILES.map((file) => resolve(modelRoot, "dist/tests", file));
    const result = spawnSync(process.execPath, ["--test", ...compiledTests], {
      cwd: modelRoot,
      encoding: "utf8",
      env: process.env,
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const status = result.status === 0 ? "passed" : "failed";
    const evidence = {
      schemaVersion: "c7-runtime-acceptance-evidence-v1",
      generatedAt: new Date().toISOString(),
      status,
      persistenceCovered: true,
      idempotencyCovered: true,
      recoveryCovered: true,
      providerFailureCovered: true,
      testFiles: TEST_FILES.map((file) => ({
        path: `tests/${file.replace(/\.js$/u, ".ts")}`,
        sha256: sha256(
          readFileSync(resolve(modelRoot, "tests", file.replace(/\.js$/u, ".ts"))),
        ),
      })),
      verification: {
        exitCode: result.status,
        signal: result.signal,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      },
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({
      status: status === "passed" ? "C7_RUNTIME_ACCEPTANCE_READY" : "C7_RUNTIME_ACCEPTANCE_FAILED",
      evidencePath: relative(modelRoot, outputPath).replaceAll("\\", "/"),
      testFiles: TEST_FILES.length,
      evidenceSha256: sha256(readFileSync(outputPath)),
    }, null, 2)}\n`);
    if (status !== "passed") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 C7 acceptance 错误。";
    process.stderr.write(`C7 acceptance 失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
