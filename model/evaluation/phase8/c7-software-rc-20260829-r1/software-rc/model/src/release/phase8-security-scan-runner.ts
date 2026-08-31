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

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".example",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "dist",
  "node_modules",
  "var",
]);

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "openai_style_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  {
    id: "private_key_pem",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    id: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/iu,
  },
  {
    id: "literal_model_secret",
    pattern:
      /^(?:OPENAI_API_KEY|MODEL_API_KEY|ANTHROPIC_API_KEY|SAFETY_AUDIT_HMAC_KEY)[^\S\r\n]*=[^\S\r\n]*["']?(?!(?:your-|replace-|example|changeme|<|\$|process\.env|undefined|null))[A-Za-z0-9._~+/=-]{24,}["']?[^\S\r\n]*$/imu,
  },
];

const PUBLIC_EVIDENCE_FORBIDDEN_FIELDS = [
  "answerKey",
  "rubric",
  "patientFacts",
  "internalCaseId",
  "allowedFacts",
  "forbiddenDiagnosisTerms",
  "baseURL",
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
] as const;

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

function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function isIgnoredEnvironmentFile(modelRoot: string, path: string): boolean {
  const portable = relative(modelRoot, path).replaceAll("\\", "/");
  return portable === ".env" ||
    (portable.startsWith(".env.") && portable !== ".env.example");
}

function isPublicEvidenceFile(modelRoot: string, path: string): boolean {
  const portable = relative(modelRoot, path).replaceAll("\\", "/");
  if (!portable.startsWith("evaluation/phase8/")) return false;
  return /(?:candidate-benchmark-report|candidate-quality-safety-report|c6-cli-acceptance|c7-runtime-acceptance|c7-dialogue-architecture-report|dialogue-sample-ai-validation|provider-model-approval|runtime-release-manifest|software-rc-index|share-version-decision|raw\/.*\.json)$/u.test(
    portable,
  );
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
    const outputPath = optionalOutputPath(modelRoot, process.argv.slice(2));
    const files = collectFiles(modelRoot);
    const secretFindings: Array<{ file: string; patternId: string }> = [];
    const hiddenFieldFindings: Array<{ file: string; field: string }> = [];
    let scannedTextFiles = 0;
    let scannedPublicEvidenceFiles = 0;

    for (const path of files) {
      if (!isTextFile(path) || isIgnoredEnvironmentFile(modelRoot, path)) continue;
      scannedTextFiles += 1;
      const content = readFileSync(path, "utf8");
      const portable = relative(modelRoot, path).replaceAll("\\", "/");
      for (const { id, pattern } of SECRET_PATTERNS) {
        if (pattern.test(content)) secretFindings.push({ file: portable, patternId: id });
      }
      if (isPublicEvidenceFile(modelRoot, path)) {
        scannedPublicEvidenceFiles += 1;
        for (const field of PUBLIC_EVIDENCE_FORBIDDEN_FIELDS) {
          if (content.includes(field)) {
            hiddenFieldFindings.push({ file: portable, field });
          }
        }
      }
    }

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
        path: relative(modelRoot, path).replaceAll("\\", "/"),
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
