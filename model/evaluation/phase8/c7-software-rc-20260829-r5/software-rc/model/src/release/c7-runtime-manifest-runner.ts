import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Phase8SafetyCorpusAiValidationV1 } from "../evaluation/phase8-ai-evidence.js";
import {
  assertC7CaseValidationEvidence,
  assertC7RuntimeReleaseEvidence,
  assertC7SafetyCorpusEvidence,
  assertSoftwareRcArtifactPath,
  type C7RuntimeReleaseEvidence,
} from "./c7-runtime-release.js";
import {
  buildRuntimeReleaseManifest,
  sha256Canonical,
  verifyRuntimeReleaseManifest,
  type Phase8CaseValidationV2,
} from "./phase8-release.js";

interface Arguments {
  aiEvidenceDirectory: string;
  dialogueEvidenceDirectory: string;
  c6EvidencePath: string;
  c7EvidencePath: string;
  securityEvidencePath: string;
  outputDirectory: string;
  buildVersion: string;
}

type AiIndex = C7RuntimeReleaseEvidence["aiIndex"] & {
  caseValidationSetSha256: string;
  sourceCandidateManifest: { path: string; sha256: string };
  caseManifest: { path: string; sha256: string };
  publishedArtifacts: Array<
    C7RuntimeReleaseEvidence["aiIndex"]["publishedArtifacts"][number] & {
      caseSha256: string;
      validationSha256: string;
    }
  >;
  safetyCorpus: {
    datasetVersion: string;
    corpusHash: string;
    holdoutHash: string;
    totalSamples: number;
    holdoutSamples: number;
    policyVersion: string;
    templateRegistryHash: string;
    path: string;
    sha256: string;
  };
};

interface PublishedCase {
  internalCaseId: string;
  publicCaseId: string;
  caseVersion: string;
  packageStatus: string;
  provenance: { contentHash: string };
}

interface PublishedValidationV1 {
  schemaVersion: string;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  decision: string;
  validations: Array<{ modelId: string; decision: string }>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--ai-evidence",
    "--dialogue-evidence",
    "--c6-evidence",
    "--c7-evidence",
    "--security-evidence",
    "--output",
    "--build",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === undefined || !allowed.has(key)) throw new Error(`未知参数：${key ?? ""}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key, value);
    index += 1;
  }
  const aiEvidenceDirectory = values.get("--ai-evidence");
  const dialogueEvidenceDirectory = values.get("--dialogue-evidence");
  const c6EvidencePath = values.get("--c6-evidence");
  const c7EvidencePath = values.get("--c7-evidence");
  const securityEvidencePath = values.get("--security-evidence");
  const outputDirectory = values.get("--output");
  if (
    aiEvidenceDirectory === undefined ||
    dialogueEvidenceDirectory === undefined ||
    c6EvidencePath === undefined ||
    c7EvidencePath === undefined ||
    securityEvidencePath === undefined ||
    outputDirectory === undefined
  ) {
    throw new Error(
      "必须提供 --ai-evidence、--dialogue-evidence、--c6-evidence、--c7-evidence、--security-evidence 和 --output。",
    );
  }
  return {
    aiEvidenceDirectory,
    dialogueEvidenceDirectory,
    c6EvidencePath,
    c7EvidencePath,
    securityEvidencePath,
    outputDirectory,
    buildVersion: values.get("--build") ?? "0.1.0-rc.2",
  };
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

function assertInside(root: string, path: string, label: string): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside its evidence directory.`);
  }
}

function requireFile(path: string): string {
  if (!existsSync(path)) throw new Error(`C7 必需产物不存在：${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`C7 必需产物必须是非符号链接文件：${path}`);
  }
  return path;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(requireFile(path), "utf8")) as T;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function assertHash(path: string, expected: string, label: string): void {
  if (sha256File(requireFile(path)) !== expected) {
    throw new Error(`${label} hash drifted.`);
  }
}

function collectFiles(root: string, directory: string): string[] {
  const absoluteDirectory = resolve(root, directory);
  const collected: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Software RC source must not contain symlinks: ${path}`);
      }
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        collected.push(portableRelative(root, path));
      }
    }
  };
  walk(absoluteDirectory);
  return collected;
}

function main(): void {
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const gameRoot = resolve(modelRoot, "..");
    const casesRoot = resolve(modelRoot, "cases");
    const aiDirectory = resolveInside(modelRoot, args.aiEvidenceDirectory, "AI evidence path");
    const dialogueDirectory = resolveInside(
      modelRoot,
      args.dialogueEvidenceDirectory,
      "dialogue evidence path",
    );
    const c6Path = resolveInside(modelRoot, args.c6EvidencePath, "C6 evidence path");
    const c7Path = resolveInside(modelRoot, args.c7EvidencePath, "C7 evidence path");
    const securityPath = resolveInside(
      modelRoot,
      args.securityEvidencePath,
      "security evidence path",
    );
    const outputDirectory = resolveInside(
      modelRoot,
      args.outputDirectory,
      "runtime release output path",
    );
    if (existsSync(outputDirectory)) {
      throw new Error("C7 runtime-release 输出已存在；不会覆盖。 ");
    }

    const aiIndexPath = resolveInside(aiDirectory, "ai-evidence-index.json", "AI index");
    const aiIndex = readJson<AiIndex>(aiIndexPath);
    const aiIndexSha256 = sha256File(aiIndexPath);
    if (aiIndex.sourceCandidateManifest.path !== "cases/manifest.dialogue-candidate.v1-rc1.json") {
      throw new Error("C7 source candidate manifest path is not the approved dialogue candidate.");
    }
    const candidateManifestPath = resolveInside(
      modelRoot,
      aiIndex.sourceCandidateManifest.path,
      "candidate manifest",
    );
    assertHash(candidateManifestPath, aiIndex.sourceCandidateManifest.sha256, "candidate manifest");
    if (!aiIndex.caseManifest.path.startsWith("cases/")) {
      throw new Error("C7 case manifest must stay inside cases/.");
    }
    const caseManifestPath = resolveInside(modelRoot, aiIndex.caseManifest.path, "case manifest");
    assertHash(caseManifestPath, aiIndex.caseManifest.sha256, "case manifest");
    const caseManifest = readJson<C7RuntimeReleaseEvidence["caseManifest"]>(caseManifestPath);

    const validationArtifacts: Phase8CaseValidationV2[] = [];
    for (const validation of aiIndex.caseValidations) {
      const validationPath = resolveInside(modelRoot, validation.path, "case validation");
      assertInside(aiDirectory, validationPath, "case validation");
      assertHash(validationPath, validation.sha256, `case validation ${validation.publicCaseId}`);
      const artifact = readJson<Phase8CaseValidationV2>(validationPath);
      const publishedBinding = aiIndex.publishedArtifacts.find(
        ({ publicCaseId }) => publicCaseId === validation.publicCaseId,
      );
      if (publishedBinding === undefined) {
        throw new Error(`Missing published case binding: ${validation.publicCaseId}`);
      }
      const publishedCasePath = resolveInside(
        casesRoot,
        publishedBinding.path,
        `published case ${validation.publicCaseId}`,
      );
      assertInside(resolve(casesRoot, "published"), publishedCasePath, "published case");
      const publishedCase = readJson<PublishedCase>(publishedCasePath);
      assertC7CaseValidationEvidence(artifact, {
        caseId: publishedCase.internalCaseId,
        caseVersion: publishedCase.caseVersion,
        contentHash: publishedCase.provenance.contentHash,
      }, aiIndex.provider.actualModelId);
      if (
        publishedCase.publicCaseId !== validation.publicCaseId ||
        publishedCase.packageStatus !== "published"
      ) {
        throw new Error(`Case validation model or publication binding drifted: ${validation.publicCaseId}`);
      }
      validationArtifacts.push(artifact);
    }
    const caseValidationSetSha256 = sha256Canonical(aiIndex.caseValidations);
    if (caseValidationSetSha256 !== aiIndex.caseValidationSetSha256) {
      throw new Error("C7 case validation set hash drifted.");
    }

    for (const artifact of aiIndex.publishedArtifacts) {
      const casePath = resolveInside(casesRoot, artifact.path, `published case ${artifact.publicCaseId}`);
      const validationPath = resolveInside(
        casesRoot,
        artifact.validationRecordPath,
        `published validation ${artifact.publicCaseId}`,
      );
      assertInside(resolve(casesRoot, "published"), casePath, "published case");
      assertInside(resolve(casesRoot, "published"), validationPath, "published validation");
      assertHash(casePath, artifact.caseSha256, `published case ${artifact.publicCaseId}`);
      assertHash(
        validationPath,
        artifact.validationSha256,
        `published validation ${artifact.publicCaseId}`,
      );
      const publishedCase = readJson<PublishedCase>(casePath);
      const validation = readJson<PublishedValidationV1>(validationPath);
      if (
        publishedCase.publicCaseId !== artifact.publicCaseId ||
        publishedCase.caseVersion !== artifact.caseVersion ||
        publishedCase.provenance.contentHash !== artifact.contentHash ||
        validation.schemaVersion !== "ai-case-cross-validation-v1" ||
        validation.caseId !== publishedCase.internalCaseId ||
        validation.caseVersion !== artifact.caseVersion ||
        validation.contentHash !== artifact.contentHash ||
        validation.decision !== "approved" ||
        validation.validations.length !== 2 ||
        validation.validations.some(
          ({ modelId, decision }) =>
            modelId !== aiIndex.provider.actualModelId || decision !== "approved",
        )
      ) {
        throw new Error(`Published case semantic binding drifted: ${artifact.publicCaseId}`);
      }
    }

    const safetyPath = resolveInside(modelRoot, aiIndex.safetyCorpus.path, "safety evidence");
    assertInside(aiDirectory, safetyPath, "safety evidence");
    assertHash(safetyPath, aiIndex.safetyCorpus.sha256, "safety corpus validation");
    assertC7SafetyCorpusEvidence(
      readJson<Phase8SafetyCorpusAiValidationV1>(safetyPath),
      {
        actualModelId: aiIndex.provider.actualModelId,
        corpusHash: aiIndex.safetyCorpus.corpusHash,
        holdoutHash: aiIndex.safetyCorpus.holdoutHash,
        templateRegistryHash: aiIndex.safetyCorpus.templateRegistryHash,
        totalSamples: aiIndex.safetyCorpus.totalSamples,
        holdoutSamples: aiIndex.safetyCorpus.holdoutSamples,
      },
    );

    const publicationIndexPath = resolveInside(
      aiDirectory,
      "publication-index.json",
      "publication index",
    );
    requireFile(publicationIndexPath);
    const dialogueReportPath = resolveInside(
      dialogueDirectory,
      "c7-dialogue-architecture-report.json",
      "dialogue report",
    );
    const dialogueAuditPath = resolveInside(
      dialogueDirectory,
      "dialogue-sample-ai-validation.json",
      "dialogue audit",
    );
    const dialogueApprovalPath = resolveInside(
      dialogueDirectory,
      "provider-model-approval.json",
      "dialogue approval",
    );
    const dialogueReport = readJson<C7RuntimeReleaseEvidence["dialogueReport"]>(dialogueReportPath);
    const dialogueAudit = readJson<C7RuntimeReleaseEvidence["dialogueAudit"]>(dialogueAuditPath);
    const dialogueApproval = readJson<C7RuntimeReleaseEvidence["dialogueApproval"]>(
      dialogueApprovalPath,
    );
    if (
      portableRelative(modelRoot, dialogueReportPath) !== dialogueApproval.report.path ||
      sha256File(dialogueReportPath) !== dialogueApproval.report.sha256 ||
      portableRelative(modelRoot, dialogueAuditPath) !== dialogueApproval.audit.path ||
      sha256File(dialogueAuditPath) !== dialogueApproval.audit.sha256
    ) {
      throw new Error("C7 dialogue approval artifact binding drifted.");
    }

    const promptPath = resolve(modelRoot, "prompts/patient/v0.2.0.md");
    const shareContractPath = resolve(gameRoot, "share/versions/contract-v1-rc1.json");
    const c6Acceptance = readJson<C7RuntimeReleaseEvidence["c6Acceptance"]>(c6Path);
    const c7Acceptance = readJson<C7RuntimeReleaseEvidence["c7Acceptance"]>(c7Path);
    const securityScan = readJson<C7RuntimeReleaseEvidence["securityScan"]>(securityPath);
    assertC7RuntimeReleaseEvidence({
      aiIndexSha256,
      caseManifestSha256: sha256File(caseManifestPath),
      caseValidationSetSha256,
      patientPromptSha256: sha256File(promptPath),
      shareContractSha256: sha256File(shareContractPath),
      dialogueAuditSha256: sha256File(dialogueAuditPath),
      aiIndex,
      caseManifest,
      dialogueAudit,
      dialogueReport,
      dialogueApproval,
      c6Acceptance,
      c7Acceptance,
      securityScan,
    });

    mkdirSync(outputDirectory, { recursive: true });
    const shareDecisionPath = resolve(outputDirectory, "share-version-decision.json");
    writeJsonExclusive(shareDecisionPath, {
      schemaVersion: "c7-share-version-decision-v1",
      decision: "retained_release_candidate",
      release: "v1-rc1",
      decidedAt: new Date().toISOString(),
      reason: "本轮仅完成模型层 C6/C7；游戏侧统一 MVP 合并门不在本次范围内。",
      sourceSha256: sha256File(shareContractPath),
    });

    const modelRuntimeFiles = [
      ...collectFiles(gameRoot, "model/src"),
      ...collectFiles(gameRoot, "model/tests"),
      ...collectFiles(gameRoot, "model/cases"),
      ...collectFiles(gameRoot, "model/prompts"),
      "model/package.json",
      "model/package-lock.json",
      "model/tsconfig.json",
      "model/README.md",
      "model/evaluation/scoring-policy-v1.md",
    ];
    const shareRuntimeFiles = [
      ...collectFiles(gameRoot, "share/contracts"),
      ...collectFiles(gameRoot, "share/testing"),
      ...collectFiles(gameRoot, "share/tests"),
      ...collectFiles(gameRoot, "share/schemas"),
      ...collectFiles(gameRoot, "share/fixtures"),
      ...collectFiles(gameRoot, "share/versions"),
      "share/package.json",
      "share/package-lock.json",
      "share/tsconfig.json",
      "share/README.md",
    ];
    const evidenceFiles = [
      aiIndexPath,
      publicationIndexPath,
      ...aiIndex.caseValidations.map(({ path }) => resolve(modelRoot, path)),
      safetyPath,
      dialogueReportPath,
      dialogueAuditPath,
      dialogueApprovalPath,
      c6Path,
      c7Path,
      securityPath,
      shareDecisionPath,
    ].map((path) => portableRelative(gameRoot, path));
    const artifactPaths = [
      ...new Set([...modelRuntimeFiles, ...shareRuntimeFiles, ...evidenceFiles]),
    ].sort();
    for (const path of artifactPaths) {
      assertSoftwareRcArtifactPath(path);
      requireFile(resolveInside(gameRoot, path, "Software RC artifact"));
    }

    const manifest = buildRuntimeReleaseManifest({
      rootDirectory: gameRoot,
      artifactRoot: "game",
      buildVersion: args.buildVersion,
      goNoGoDecisionRef: dialogueApproval.decisionRef,
      provider: {
        providerName: dialogueApproval.provider.providerName,
        protocol: "openai-responses",
        endpointSha256: dialogueApproval.provider.endpointSha256,
        configuredModelId: dialogueApproval.provider.configuredModelId,
        actualModelId: dialogueApproval.provider.actualModelId,
        approvedAt: dialogueApproval.decidedAt,
      },
      remoteInteractiveEnabled: false,
      shareDecision: {
        release: "v1-rc1",
        status: "retained_release_candidate",
        reason: "模型层 C6/C7 已通过；游戏侧统一 MVP 合并门不在本次范围内。",
      },
      artifactPaths,
    });
    const manifestPath = resolve(outputDirectory, "runtime-release-manifest.v1.json");
    writeJsonExclusive(manifestPath, manifest);
    const verified = verifyRuntimeReleaseManifest(manifest, gameRoot);
    process.stdout.write(`${JSON.stringify({
      status: "C7_RUNTIME_RELEASE_MANIFEST_READY",
      manifestPath: portableRelative(modelRoot, manifestPath),
      manifestSha256: manifest.manifestSha256,
      artifactCount: verified.artifactCount,
      actualModelId: dialogueApproval.provider.actualModelId,
      remoteInteractiveEnabled: verified.remoteInteractiveEnabled,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 C7 manifest 错误。";
    process.stderr.write(`C7 runtime manifest 失败：${message}\n`);
    process.exitCode = 1;
  }
}

main();
