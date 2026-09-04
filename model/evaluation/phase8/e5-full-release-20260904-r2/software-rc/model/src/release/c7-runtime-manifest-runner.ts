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
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import {
  assertAiCaseCrossReviewV3,
  assertAiCaseCrossValidationV1,
  assertSupportedCasePackage,
  type SupportedCasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import { toC7DialogueReleasePolicy } from "../evaluation/c7-dialogue-architecture-benchmark.js";
import { listC7CaseManifestBindings } from "./c7-case-release.js";
import {
  PHASE7_SAFETY_CORPUS_VERSION_V1,
  PHASE7_SAFETY_CORPUS_V1,
} from "../evaluation/phase7-safety-corpus.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import {
  assertC7CaseValidationEvidence,
  assertC7RuntimeReleaseEvidence,
  assertC7SafetyCorpusEvidence,
  assertSoftwareRcArtifactPath,
  collectC7RuntimeReleaseFindings,
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

type AiIndex = Omit<C7RuntimeReleaseEvidence["aiIndex"], "publishedArtifacts"> & {
  caseValidationSetSha256: string;
  sourceCandidateManifest: { path: string; sha256: string };
  caseManifest: { path: string; sha256: string };
  publishedArtifacts: Array<
    C7RuntimeReleaseEvidence["aiIndex"]["publishedArtifacts"][number] & {
      caseSha256: string;
      validationSha256?: string;
      packageStatus?: "fixture" | "draft" | "published" | "withdrawn";
      reviewStatus?: "approved" | "revision_recommended" | "rejected" | "not_run" | "missing" | "stale";
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

interface PublishedValidationV1 {
  schemaVersion: string;
  caseId: string;
  caseVersion: string;
  contentHash: string;
  decision: string;
  validations: Array<{
    modelId: string;
    decision: string;
    runStatus?: "completed" | "failed_to_run";
  }>;
}

export interface C7PublishedReviewArtifactReference {
  publicCaseId: string;
  reviewStatus?: "approved" | "revision_recommended" | "rejected" | "not_run" | "missing" | "stale";
  validationRecordPath?: string;
  validationSha256?: string;
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

export function resolveC7PublishedReviewArtifactPath(
  casesRoot: string,
  artifact: C7PublishedReviewArtifactReference,
): string | undefined {
  const reviewStatus = artifact.reviewStatus ?? "approved";
  if (reviewStatus === "missing") {
    if (
      artifact.validationRecordPath !== undefined ||
      artifact.validationSha256 !== undefined
    ) {
      throw new Error(`Missing review must not bind validation evidence: ${artifact.publicCaseId}`);
    }
    return undefined;
  }
  if (
    artifact.validationRecordPath === undefined ||
    artifact.validationSha256 === undefined
  ) {
    throw new Error(`Published validation evidence is missing: ${artifact.publicCaseId}`);
  }
  const validationPath = resolveInside(
    casesRoot,
    artifact.validationRecordPath,
    `published validation ${artifact.publicCaseId}`,
  );
  assertInside(resolve(casesRoot, "published"), validationPath, "published validation");
  assertHash(
    validationPath,
    artifact.validationSha256,
    `published validation ${artifact.publicCaseId}`,
  );
  return validationPath;
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
    const contentManifest = loadCaseManifestV2(
      resolve(modelRoot, "cases/manifest.phase6-compat.v2-rc2.json"),
    );
    const releasePolicy = toC7DialogueReleasePolicy(
      contentManifest.releasePolicy,
    );
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
    if (aiIndex.sourceCandidateManifest.path !== "cases/manifest.phase6-compat.v2-rc2.json") {
      throw new Error("C7 source candidate manifest path is not the approved E2 manifest.");
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
    const caseManifestValue = readJson<unknown>(caseManifestPath);
    const caseManifest = {
      publishedCases: listC7CaseManifestBindings(caseManifestValue),
    };

    for (const validation of aiIndex.caseValidations) {
      const validationPath = resolveInside(modelRoot, validation.path, "case validation");
      assertInside(aiDirectory, validationPath, "case validation");
      assertHash(validationPath, validation.sha256, `case validation ${validation.publicCaseId}`);
      const artifact = readJson<unknown>(validationPath);
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
      const publishedCase = readJson<SupportedCasePackage>(publishedCasePath);
      assertCasePackageJsonSchema(publishedCase);
      assertSupportedCasePackage(publishedCase);
      const publishedContentHash = publishedCase.provenance.contentHash;
      if (publishedContentHash === undefined) {
        throw new Error(`Published case content hash is missing: ${validation.publicCaseId}`);
      }
      const reviewBinding = {
        caseId: publishedCase.internalCaseId,
        caseVersion: publishedCase.caseVersion,
        contentHash: publishedContentHash,
      };
      const artifactSchema = (artifact as { schemaVersion?: unknown }).schemaVersion;
      if (artifactSchema === "ai-case-cross-review-v3") {
        assertAiCaseCrossReviewV3(artifact, reviewBinding);
        const review = artifact as PublishedValidationV1;
        if (review.validations.some(({ modelId, runStatus }) =>
          modelId !== (
            runStatus === "failed_to_run"
              ? aiIndex.provider.configuredModelId
              : aiIndex.provider.actualModelId
          ))) {
          throw new Error(`Case validation model binding drifted: ${validation.publicCaseId}`);
        }
      } else {
        if (aiIndex.provider.actualModelId === undefined) {
          throw new Error("Legacy C7 case validation requires an observed actual model ID.");
        }
        assertC7CaseValidationEvidence(
          artifact as Phase8CaseValidationV2,
          reviewBinding,
          aiIndex.provider.actualModelId,
        );
      }
      if (
        publishedCase.publicCaseId !== validation.publicCaseId ||
        publishedCase.packageStatus !== (publishedBinding.packageStatus ?? "published")
      ) {
        throw new Error(`Case validation model or publication binding drifted: ${validation.publicCaseId}`);
      }
    }
    const caseValidationSetSha256 = sha256Canonical(aiIndex.caseValidations);
    if (caseValidationSetSha256 !== aiIndex.caseValidationSetSha256) {
      throw new Error("C7 case validation set hash drifted.");
    }

    const publishedCasePackages: SupportedCasePackage[] = [];
    for (const artifact of aiIndex.publishedArtifacts) {
      const casePath = resolveInside(casesRoot, artifact.path, `published case ${artifact.publicCaseId}`);
      assertInside(resolve(casesRoot, "published"), casePath, "published case");
      assertHash(casePath, artifact.caseSha256, `published case ${artifact.publicCaseId}`);
      const publishedCase = readJson<SupportedCasePackage>(casePath);
      assertCasePackageJsonSchema(publishedCase);
      assertSupportedCasePackage(publishedCase);
      const publishedContentHash = publishedCase.provenance.contentHash;
      if (publishedContentHash === undefined) {
        throw new Error(`Published case content hash is missing: ${artifact.publicCaseId}`);
      }
      const reviewStatus = artifact.reviewStatus ?? "approved";
      const validationPath = resolveC7PublishedReviewArtifactPath(casesRoot, artifact);
      if (validationPath === undefined) {
        publishedCasePackages.push(publishedCase);
        continue;
      }
      const validation = readJson<unknown>(validationPath);
      const validationRecord = validation as PublishedValidationV1;
      const reviewOwnBinding = {
        caseId: validationRecord.caseId,
        caseVersion: validationRecord.caseVersion,
        contentHash: validationRecord.contentHash,
      };
      if (validationRecord.schemaVersion === "ai-case-cross-validation-v1") {
        assertAiCaseCrossValidationV1(validation, reviewOwnBinding);
      } else if (validationRecord.schemaVersion === "ai-case-cross-review-v3") {
        assertAiCaseCrossReviewV3(validation, reviewOwnBinding);
      } else {
        throw new Error(`Unsupported case review schema: ${validationRecord.schemaVersion}`);
      }
      if (
        publishedCase.publicCaseId !== artifact.publicCaseId ||
        publishedCase.caseVersion !== artifact.caseVersion ||
        publishedCase.provenance.contentHash !== artifact.contentHash ||
        publishedCase.packageStatus !== (artifact.packageStatus ?? "published") ||
        validationRecord.caseId !== publishedCase.internalCaseId ||
        validationRecord.caseVersion !== artifact.caseVersion ||
        (reviewStatus !== "stale" && validationRecord.contentHash !== artifact.contentHash) ||
        (reviewStatus !== "stale" && validationRecord.decision !== reviewStatus) ||
        (reviewStatus !== "stale" && validationRecord.validations.some(
          ({ modelId, decision, runStatus }) =>
            modelId !== (
              runStatus === "failed_to_run"
                ? aiIndex.provider.configuredModelId
                : aiIndex.provider.actualModelId
            ) ||
            (reviewStatus === "approved" && decision !== "approved"),
        ))
      ) {
        throw new Error(`Published case semantic binding drifted: ${artifact.publicCaseId}`);
      }
      publishedCasePackages.push(publishedCase);
    }

    const safetyPath = resolveInside(modelRoot, aiIndex.safetyCorpus.path, "safety evidence");
    assertInside(aiDirectory, safetyPath, "safety evidence");
    assertHash(safetyPath, aiIndex.safetyCorpus.sha256, "safety corpus validation");
    const currentTemplateRegistry = Object.fromEntries(
      Object.entries(MEDICAL_SAFETY_TEMPLATES_V1).map(
        ([decision, template]) => [decision, template.templateId],
      ),
    );
    const currentHoldout = PHASE7_SAFETY_CORPUS_V1.filter(
      ({ split }) => split === "holdout",
    );
    const currentCorpusHash = sha256Canonical(PHASE7_SAFETY_CORPUS_V1);
    const currentHoldoutHash = sha256Canonical(currentHoldout);
    const currentTemplateRegistryHash = sha256Canonical(currentTemplateRegistry);
    if (
      aiIndex.safetyCorpus.datasetVersion !== PHASE7_SAFETY_CORPUS_VERSION_V1 ||
      aiIndex.safetyCorpus.policyVersion !== MEDICAL_SAFETY_POLICY_VERSION_V1 ||
      aiIndex.safetyCorpus.corpusHash !== currentCorpusHash ||
      aiIndex.safetyCorpus.holdoutHash !== currentHoldoutHash ||
      aiIndex.safetyCorpus.templateRegistryHash !== currentTemplateRegistryHash ||
      aiIndex.safetyCorpus.totalSamples !== PHASE7_SAFETY_CORPUS_V1.length ||
      aiIndex.safetyCorpus.holdoutSamples !== currentHoldout.length
    ) {
      throw new Error("C7 safety corpus source binding drifted.");
    }
    assertC7SafetyCorpusEvidence(
      readJson<Phase8SafetyCorpusAiValidationV1>(safetyPath),
      {
        actualModelId: aiIndex.provider.actualModelId,
        configuredModelId: aiIndex.provider.configuredModelId,
        datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
        policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
        corpusHash: currentCorpusHash,
        holdoutHash: currentHoldoutHash,
        templateRegistryHash: currentTemplateRegistryHash,
        totalSamples: PHASE7_SAFETY_CORPUS_V1.length,
        holdoutSamples: currentHoldout.length,
        expectedDecisionsBySampleId: Object.fromEntries(
          PHASE7_SAFETY_CORPUS_V1.map(({ sampleId, expectedDecision }) => [
            sampleId,
            expectedDecision,
          ]),
        ),
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
    const dialogueSampleSetPath = resolveInside(
      dialogueDirectory,
      "private/patient-samples.v1.json",
      "dialogue private sample set",
    );
    const dialogueReport = readJson<C7RuntimeReleaseEvidence["dialogueReport"]>(dialogueReportPath);
    const dialogueAudit = readJson<C7RuntimeReleaseEvidence["dialogueAudit"]>(dialogueAuditPath);
    const dialogueSampleSet = readJson<C7RuntimeReleaseEvidence["dialogueSampleSet"]>(
      dialogueSampleSetPath,
    );
    const journeyDirectory = resolveInside(
      dialogueDirectory,
      "private/journeys",
      "dialogue private journey directory",
    );
    const expectedJourneyFiles = caseManifest.publishedCases
      .map(({ publicCaseId }) => `${publicCaseId}.json`)
      .sort();
    const observedJourneyFiles = readdirSync(journeyDirectory)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();
    if (JSON.stringify(observedJourneyFiles) !== JSON.stringify(expectedJourneyFiles)) {
      throw new Error("C7 dialogue private journey file set drifted.");
    }
    const dialogueJourneys = observedJourneyFiles.map((fileName) =>
      readJson<C7RuntimeReleaseEvidence["dialogueJourneys"][number]>(
        resolveInside(journeyDirectory, fileName, "dialogue private journey"),
      )
    );
    const dialogueJourneySetSha256 = sha256Canonical(
      [...dialogueJourneys].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    );
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

    const promptPath = resolve(
      modelRoot,
      `prompts/patient/${contentManifest.patientPromptVersion}.md`,
    );
    const shareContractPath = resolve(gameRoot, "share/versions/contract-v1-rc2.json");
    const c6Acceptance = readJson<C7RuntimeReleaseEvidence["c6Acceptance"]>(c6Path);
    const c7Acceptance = readJson<C7RuntimeReleaseEvidence["c7Acceptance"]>(c7Path);
    const securityScan = readJson<C7RuntimeReleaseEvidence["securityScan"]>(securityPath);
    const expectedC6SourceBindings = {
      testSha256: sha256File(resolve(modelRoot, "tests/c6-cli-journeys.test.ts")),
      providerSha256: sha256File(resolve(modelRoot, "src/providers/deterministic-model-provider.ts")),
      outputGateSha256: sha256File(resolve(modelRoot, "src/safety/patient-output-gate.ts")),
      modelServiceSha256: sha256File(resolve(modelRoot, "src/application/model-service.ts")),
      candidateManifestSha256: sha256File(
        resolve(modelRoot, "cases/manifest.dialogue-candidate.v1-rc1.json"),
      ),
      caseLoaderSha256: sha256File(resolve(modelRoot, "src/cli/case-loader.ts")),
      releaseManifestSha256: sha256File(
        resolve(modelRoot, "cases/manifest.dialogue-rc.v1-rc1.json"),
      ),
    };
    if (
      Object.entries(expectedC6SourceBindings).some(
        ([key, sha256]) =>
          c6Acceptance.sourceBindings[key as keyof typeof expectedC6SourceBindings] !== sha256,
      )
    ) {
      throw new Error("C6 acceptance source binding drifted.");
    }
    for (const testFile of c7Acceptance.testFiles) {
      const testPath = resolveInside(modelRoot, testFile.path, "C7 acceptance test binding");
      assertInside(resolve(modelRoot, "tests"), testPath, "C7 acceptance test binding");
      assertHash(testPath, testFile.sha256, `C7 acceptance test ${testFile.path}`);
    }
    const runtimeEvidence: C7RuntimeReleaseEvidence = {
      releasePolicy,
      aiIndexSha256,
      caseManifestSha256: sha256File(caseManifestPath),
      caseValidationSetSha256,
      patientPromptSha256: sha256File(promptPath),
      shareContractSha256: sha256File(shareContractPath),
      dialogueAuditSha256: sha256File(dialogueAuditPath),
      dialogueJourneySetSha256,
      publishedCasePackages,
      aiIndex,
      caseManifest,
      dialogueAudit,
      dialogueSampleSet,
      dialogueJourneys,
      dialogueReport,
      dialogueApproval,
      c6Acceptance,
      c7Acceptance,
      securityScan,
    };
    assertC7RuntimeReleaseEvidence(runtimeEvidence);
    const runtimeFindings = collectC7RuntimeReleaseFindings(runtimeEvidence);

    mkdirSync(outputDirectory, { recursive: true });
    const shareDecisionPath = resolve(outputDirectory, "share-version-decision.json");
    writeJsonExclusive(shareDecisionPath, {
      schemaVersion: "c7-share-version-decision-v1",
      decision: "retained_release_candidate",
      release: "v1-rc2",
      decidedAt: new Date().toISOString(),
      reason: "本轮仅完成模型层 C6/C7；游戏侧统一 MVP 合并门不在本次范围内。",
      sourceSha256: sha256File(shareContractPath),
    });
    const dialoguePrivateBindingPath = resolve(
      outputDirectory,
      "dialogue-private-evidence-binding.json",
    );
    writeJsonExclusive(dialoguePrivateBindingPath, {
      schemaVersion: "c7-dialogue-private-evidence-binding-v1",
      runSetSha256: dialogueReport.runSetSha256,
      sampleSetSha256: dialogueSampleSet.sampleSetSha256,
      journeySetSha256: dialogueJourneySetSha256,
      sampleCount: dialogueSampleSet.sampleCount,
      journeys: [...dialogueJourneys]
        .sort((left, right) => left.caseId.localeCompare(right.caseId))
        .map((journey) => ({
          caseId: journey.caseId,
          caseVersion: journey.caseVersion,
          contentHash: journey.contentHash,
          turnCount: journey.turns.length,
          sha256: sha256Canonical(journey),
        })),
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
      dialoguePrivateBindingPath,
    ].map((path) => portableRelative(gameRoot, path));
    const artifactPaths = [
      ...new Set([...modelRuntimeFiles, ...shareRuntimeFiles, ...evidenceFiles]),
    ].sort();
    for (const path of artifactPaths) {
      assertSoftwareRcArtifactPath(path);
      requireFile(resolveInside(gameRoot, path, "Software RC artifact"));
    }

    const observedActualModelId = dialogueApproval.provider.actualModelId ??
      aiIndex.provider.actualModelId;
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
        ...(observedActualModelId === undefined
          ? { observationStatus: "not_observed" as const }
          : { actualModelId: observedActualModelId, observationStatus: "observed" as const }),
        approvedAt: dialogueApproval.decidedAt,
      },
      remoteInteractiveEnabled: false,
      shareDecision: {
        release: "v1-rc2",
        status: "retained_release_candidate",
        reason: "模型层 C6/C7 证据已生成；质量 findings 采用 non-blocking reporter 语义。",
      },
      qualityReport: {
        reviewPolicy: "non_blocking",
        findings: runtimeFindings,
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
      actualModelId: observedActualModelId ?? null,
      reviewPolicy: manifest.qualityReport?.reviewPolicy,
      findings: manifest.qualityReport?.findings.length ?? 0,
      remoteInteractiveEnabled: verified.remoteInteractiveEnabled,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 C7 manifest 错误。";
    process.stderr.write(`C7 runtime manifest 失败：${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  main();
}
