import { existsSync, lstatSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, relative, resolve } from "node:path";

const STATIC_EXTENSIONS = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".meta",
  ".mjs",
  ".rsc",
  ".txt",
]);

const PRERENDER_EXTENSIONS = new Set([".html", ".meta", ".rsc"]);

const CLIENT_FORBIDDEN_TOKENS = [
  "personaTemplateId",
  "behaviorInstructions",
  "answerKey",
  "rubric",
  "targetDiagnosis",
  "patientFacts",
  "internalCaseId",
  "allowedFacts",
  "forbiddenDiagnosisTerms",
] as const;

const CLIENT_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/giu,
  /\b(?:OPENAI_API_KEY|MODEL_API_KEY|ANTHROPIC_API_KEY|SAFETY_AUDIT_HMAC_KEY)\s*[:=]\s*["']?(?!(?:your-|replace-|example|changeme|<|\$))[A-Za-z0-9._~+/=-]{24,}/giu,
] as const;

export interface E5StaticClientScan {
  status: "passed" | "failed";
  scannedFiles: number;
  sensitiveMatches: number;
  matches: Array<{ path: string; token: string }>;
}

function walkRegularFiles(directory: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`E5 client artifact tree contains a symlink: ${path}`);
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(directory);
  return files;
}

export function scanE5StaticClientArtifacts(gamePackageRoot: string): E5StaticClientScan {
  const staticRoot = resolve(gamePackageRoot, ".next", "static");
  const prerenderRoot = resolve(gamePackageRoot, ".next", "server", "app");
  const publicRoot = resolve(gamePackageRoot, "public");
  const matches: E5StaticClientScan["matches"] = [];
  const requiredFiles = (
    root: string,
    extensions: ReadonlySet<string>,
    label: string,
  ): string[] => {
    const displayPath = relative(gamePackageRoot, root).replaceAll("\\", "/");
    if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
      matches.push({ path: displayPath, token: `${label}_root_missing` });
      return [];
    }
    const files = walkRegularFiles(root).filter((path) =>
      extensions.has(extname(path).toLowerCase()),
    );
    if (files.length === 0) {
      matches.push({ path: displayPath, token: `${label}_root_empty` });
    }
    return files;
  };
  const candidates = [
    ...requiredFiles(staticRoot, STATIC_EXTENSIONS, "next_static"),
    ...requiredFiles(prerenderRoot, PRERENDER_EXTENSIONS, "next_prerender"),
    ...walkRegularFiles(publicRoot).filter((path) =>
      STATIC_EXTENSIONS.has(extname(path).toLowerCase()),
    ),
  ].sort();
  for (const path of candidates) {
    const content = readFileSync(path, "utf8");
    for (const token of CLIENT_FORBIDDEN_TOKENS) {
      if (content.toLocaleLowerCase("en-US").includes(token.toLocaleLowerCase("en-US"))) {
        matches.push({
          path: relative(gamePackageRoot, path).replaceAll("\\", "/"),
          token,
        });
      }
    }
    for (const [index, pattern] of CLIENT_SECRET_PATTERNS.entries()) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        matches.push({
          path: relative(gamePackageRoot, path).replaceAll("\\", "/"),
          token: `secret_pattern_${index + 1}`,
        });
      }
    }
  }
  return {
    status: matches.length === 0 ? "passed" : "failed",
    scannedFiles: candidates.length,
    sensitiveMatches: matches.length,
    matches,
  };
}
