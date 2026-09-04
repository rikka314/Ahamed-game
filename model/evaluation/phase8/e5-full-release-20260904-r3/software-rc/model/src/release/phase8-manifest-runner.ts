import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRuntimeReleaseManifest,
  verifyRuntimeReleaseManifest,
} from "./phase8-release.js";

const USAGE = `用法：npm run phase8:manifest -- --ai-evidence <dir> --candidate-evidence <dir> --output <dir> [--build <version>]

生成不可覆盖的 runtime-release manifest。该清单固定当前唯一批准的 OpenAI-compatible
Provider/model，并明确保留 share v1-rc1；不会把 Key、Base URL 或 Claude 写入批准列表。`;

interface AiEvidenceIndex {
  caseManifest: { path: string };
  caseValidations: Array<{ path: string }>;
  safetyCorpus: { path: string };
}

interface ProviderApproval {
  schemaVersion: "phase8-provider-model-approval-v1";
  decision: "approved";
  decisionRef: string;
  decidedAt: string;
  approvedProviders: Array<{
    providerName: string;
    protocol: "openai-responses";
    endpointSha256: string;
    configuredModelId: string;
    actualModelId: string;
    promptVersion: string;
  }>;
}

interface CandidateReport {
  promptVersion: string;
}

interface PublishedManifest {
  publishedCases: Array<{ path: string }>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv: readonly string[]): {
  aiEvidenceDirectory: string;
  candidateEvidenceDirectory: string;
  outputDirectory: string;
  buildVersion: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--ai-evidence", "--candidate-evidence", "--output", "--build"].includes(key ?? "")) {
      throw new Error(`未知参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key!, value);
    index += 1;
  }
  const aiEvidenceDirectory = values.get("--ai-evidence");
  const candidateEvidenceDirectory = values.get("--candidate-evidence");
  const outputDirectory = values.get("--output");
  if (
    aiEvidenceDirectory === undefined ||
    candidateEvidenceDirectory === undefined ||
    outputDirectory === undefined
  ) {
    throw new Error("必须提供 --ai-evidence、--candidate-evidence 和 --output。");
  }
  return {
    aiEvidenceDirectory,
    candidateEvidenceDirectory,
    outputDirectory,
    buildVersion: values.get("--build") ?? "0.1.0-rc.1",
  };
}

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    isAbsolute(requestedPath) ||
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Phase 8 路径必须是 model/ 内的相对路径。");
  }
  return resolvedPath;
}

function requireFile(path: string): string {
  if (!existsSync(path)) throw new Error(`Phase 8 必需产物不存在：${path}`);
  return path;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const aiEvidenceDirectory = resolveInsideModel(modelRoot, args.aiEvidenceDirectory);
    const candidateEvidenceDirectory = resolveInsideModel(
      modelRoot,
      args.candidateEvidenceDirectory,
    );
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (existsSync(outputDirectory)) {
      throw new Error("runtime-release 输出目录已存在；不会覆盖既有清单。");
    }
    mkdirSync(outputDirectory, { recursive: true });

    const aiIndexPath = requireFile(resolve(aiEvidenceDirectory, "ai-evidence-index.json"));
    const aiIndex = JSON.parse(readFileSync(aiIndexPath, "utf8")) as AiEvidenceIndex;
    const approvalPath = requireFile(
      resolve(candidateEvidenceDirectory, "provider-model-approval.json"),
    );
    const approval = JSON.parse(readFileSync(approvalPath, "utf8")) as ProviderApproval;
    if (
      approval.schemaVersion !== "phase8-provider-model-approval-v1" ||
      approval.decision !== "approved" ||
      approval.approvedProviders.length !== 1
    ) {
      throw new Error("Phase 8 Provider/model approval artifact is invalid.");
    }
    const provider = approval.approvedProviders[0]!;
    const candidateReportPath = requireFile(
      resolve(candidateEvidenceDirectory, "candidate-benchmark-report.json"),
    );
    const candidateReport = JSON.parse(
      readFileSync(candidateReportPath, "utf8"),
    ) as CandidateReport;
    if (candidateReport.promptVersion !== provider.promptVersion) {
      throw new Error("Phase 8 approved promptVersion does not match candidate evidence.");
    }
    const caseManifestPath = requireFile(resolve(modelRoot, aiIndex.caseManifest.path));
    const caseManifest = JSON.parse(
      readFileSync(caseManifestPath, "utf8"),
    ) as PublishedManifest;
    if (caseManifest.publishedCases.length !== 5 || aiIndex.caseValidations.length !== 5) {
      throw new Error("runtime-release manifest requires 5 published cases and 5 v2 validations.");
    }

    const shareSourcePath = resolve(
      modelRoot,
      "../share/versions/contract-v1-rc1.json",
    );
    const shareSnapshotPath = resolve(
      outputDirectory,
      "snapshots/share-contract-v1-rc1.json",
    );
    mkdirSync(dirname(shareSnapshotPath), { recursive: true });
    copyFileSync(shareSourcePath, shareSnapshotPath);
    if (sha256File(shareSourcePath) !== sha256File(shareSnapshotPath)) {
      throw new Error("share v1-rc1 snapshot copy failed integrity verification.");
    }
    const shareDecisionPath = resolve(outputDirectory, "share-version-decision.json");
    writeJsonExclusive(shareDecisionPath, {
      schemaVersion: "phase8-share-version-decision-v1",
      decision: "retained_release_candidate",
      release: "v1-rc1",
      decidedAt: new Date().toISOString(),
      reason:
        "模型层 contract tests 已通过，但游戏侧 adapter 与统一 MVP 合并门尚未完成；Phase 8-A 明确保留 share v1-rc1，不虚报 stable。",
      sourceSha256: sha256File(shareSourcePath),
      snapshotSha256: sha256File(shareSnapshotPath),
    });

    const artifactPaths = [
      relative(modelRoot, caseManifestPath),
      ...caseManifest.publishedCases.map(({ path }) => `cases/${path}`),
      ...aiIndex.caseValidations.map(({ path }) => path),
      aiIndex.safetyCorpus.path,
      relative(modelRoot, aiIndexPath),
      relative(modelRoot, candidateReportPath),
      relative(
        modelRoot,
        requireFile(resolve(candidateEvidenceDirectory, "candidate-quality-safety-report.json")),
      ),
      relative(
        modelRoot,
        requireFile(resolve(candidateEvidenceDirectory, "patient-sample-ai-validation.json")),
      ),
      relative(modelRoot, approvalPath),
      "cases/schemas/ai-case-cross-validation-v2.schema.json",
      `prompts/controller/${provider.promptVersion.split("+")[0]}.md`,
      `prompts/patient/${provider.promptVersion.split("+")[0]}.md`,
      `prompts/evaluator/${provider.promptVersion.split("+")[0]}.md`,
      "evaluation/scoring-policy-v1.md",
      "src/evaluation/scoring-policy-v1.ts",
      "src/safety/medical-safety-policy-v1.ts",
      "src/persistence/sqlite/migrations.ts",
      "package.json",
      "package-lock.json",
      relative(modelRoot, shareSnapshotPath),
      relative(modelRoot, shareDecisionPath),
    ].map((path) => path.replaceAll("\\", "/"));

    const manifest = buildRuntimeReleaseManifest({
      rootDirectory: modelRoot,
      buildVersion: args.buildVersion,
      goNoGoDecisionRef: approval.decisionRef,
      provider: {
        providerName: provider.providerName,
        protocol: provider.protocol,
        endpointSha256: provider.endpointSha256,
        configuredModelId: provider.configuredModelId,
        actualModelId: provider.actualModelId,
        approvedAt: approval.decidedAt,
      },
      remoteInteractiveEnabled: false,
      shareDecision: {
        release: "v1-rc1",
        status: "retained_release_candidate",
        reason:
          "模型层 contract tests 已通过；游戏侧 adapter 与统一 MVP 合并门尚未完成。",
      },
      artifactPaths,
    });
    const manifestPath = resolve(outputDirectory, "runtime-release-manifest.v1.json");
    writeJsonExclusive(manifestPath, manifest);
    const verified = verifyRuntimeReleaseManifest(manifest, modelRoot);
    process.stdout.write(`${JSON.stringify({
      status: "PHASE8_PREREQUISITES_READY",
      manifestPath: relative(modelRoot, manifestPath).replaceAll("\\", "/"),
      manifestSha256: manifest.manifestSha256,
      artifacts: verified.artifactCount,
      providers: verified.providerCount,
      shareStatus: manifest.shareContract.status,
      remoteInteractiveEnabled: verified.remoteInteractiveEnabled,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 runtime-release manifest 错误。";
    process.stderr.write(`Phase 8 runtime-release manifest 失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
