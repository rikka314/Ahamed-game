import { lstatSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".example",
  ".html",
  ".js",
  ".json",
  ".key",
  ".md",
  ".mjs",
  ".pem",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
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

export interface RuntimeArtifactSecurityScan {
  scannedTextFiles: number;
  scannedPublicEvidenceFiles: number;
  secretFindings: Array<{ file: string; patternId: string }>;
  hiddenFieldFindings: Array<{ file: string; field: string }>;
}

function resolveInside(root: string, portablePath: string): string {
  if (
    isAbsolute(portablePath) ||
    portablePath.includes("\\") ||
    portablePath.split("/").some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`Security scan path is unsafe: ${portablePath}`);
  }
  const resolvedPath = resolve(root, portablePath);
  const relativePath = relative(root, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Security scan path escaped its root: ${portablePath}`);
  }
  return resolvedPath;
}

function isPublicEvidenceFile(path: string): boolean {
  if (!path.startsWith("model/evaluation/phase8/")) return false;
  return /(?:(?:candidate-benchmark-report|candidate-quality-safety-report|c6-cli-acceptance|c7-runtime-acceptance|c7-dialogue-architecture-report|dialogue-sample-ai-validation|provider-model-approval|runtime-release-manifest|software-rc-index|share-version-decision)[^/]*\.json|raw\/.*\.json)$/u.test(
    path,
  );
}

function containsObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsObjectKey(entry, key));
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.hasOwn(record, key) ||
    Object.values(record).some((entry) => containsObjectKey(entry, key));
}

export function scanRuntimeArtifactSet(
  root: string,
  artifactPaths: readonly string[],
  options: { unsupportedFilePolicy?: "reject" | "skip" } = {},
): RuntimeArtifactSecurityScan {
  const secretFindings: RuntimeArtifactSecurityScan["secretFindings"] = [];
  const hiddenFieldFindings: RuntimeArtifactSecurityScan["hiddenFieldFindings"] = [];
  let scannedTextFiles = 0;
  let scannedPublicEvidenceFiles = 0;
  for (const portablePath of artifactPaths) {
    const path = resolveInside(root, portablePath);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Security scan target must be a regular file: ${portablePath}`);
    }
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
      if ((options.unsupportedFilePolicy ?? "reject") === "reject") {
        throw new Error(`Security scan cannot inspect unsupported artifact: ${portablePath}`);
      }
      continue;
    }
    scannedTextFiles += 1;
    const content = readFileSync(path, "utf8");
    for (const { id, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) secretFindings.push({ file: portablePath, patternId: id });
    }
    if (isPublicEvidenceFile(portablePath)) {
      scannedPublicEvidenceFiles += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        hiddenFieldFindings.push({ file: portablePath, field: "INVALID_JSON" });
        continue;
      }
      for (const field of PUBLIC_EVIDENCE_FORBIDDEN_FIELDS) {
        if (containsObjectKey(parsed, field)) {
          hiddenFieldFindings.push({ file: portablePath, field });
        }
      }
    }
  }
  return {
    scannedTextFiles,
    scannedPublicEvidenceFiles,
    secretFindings,
    hiddenFieldFindings,
  };
}
