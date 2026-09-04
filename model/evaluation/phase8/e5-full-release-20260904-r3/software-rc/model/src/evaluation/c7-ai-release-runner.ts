import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSupportedCasePackages } from "../cli/case-loader.js";
import {
  loadCaseManifestV2,
  resolveCaseManifestArtifactPath,
} from "../cases/case-manifest.js";
import {
  loadPhase6CaseBundles,
  publishManifestCaseCandidate,
  publishManifestReviewArtifacts,
} from "../cases/phase6-case-production.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import {
  assertContainedDirectory,
  assertContainedRegularFile,
  publishDirectoryExclusive,
  publishFileExclusive,
} from "../security/contained-path.js";
import { buildC7ReportedCaseManifest } from "../release/c7-case-release.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import {
  PHASE7_SAFETY_CORPUS_V1,
  PHASE7_SAFETY_CORPUS_VERSION_V1,
} from "./phase7-safety-corpus.js";
import {
  generatePhase8CaseCrossReviewV3,
  generatePhase8SafetyCorpusValidation,
} from "./phase8-ai-evidence.js";
import {
  buildCaseReviewEvidence,
  ObservedCaseReviewTransport,
  type CaseReviewSidecarArtifactV1,
} from "./case-ai-cross-review-evidence.js";
import { verifyCaseAiCrossReviewIndex } from "./case-ai-cross-review-verify.js";

const USAGE = `用法：npm run c7:ai-release -- --model <modelId> --output <evaluation-dir> --published <cases/published/subdir> --manifest <cases/new-manifest.json>

输入固定为 cases/manifest.phase6-compat.v2-rc9.json。所有输出必须在 model/ 内且不得已存在；旧 manifest、published 病例和 superseded 证据不会被覆盖。`;

interface Arguments {
  modelId: string;
  outputDirectory: string;
  publishedDirectory: string;
  releaseManifestPath: string;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--model", "--output", "--published", "--manifest"].includes(key ?? "")) {
      throw new Error(`未知参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key!, value);
    index += 1;
  }
  const modelId = values.get("--model") ?? process.env["AHAMED_MODEL_ID"];
  const outputDirectory = values.get("--output");
  const publishedDirectory = values.get("--published");
  const releaseManifestPath = values.get("--manifest");
  if (
    modelId === undefined ||
    outputDirectory === undefined ||
    publishedDirectory === undefined ||
    releaseManifestPath === undefined
  ) {
    throw new Error("必须提供 --model、--output、--published 和 --manifest。");
  }
  return {
    modelId: modelId.trim(),
    outputDirectory,
    publishedDirectory,
    releaseManifestPath,
  };
}

function resolveInside(root: string, requestedPath: string, label: string): string {
  if (
    isAbsolute(requestedPath) ||
    requestedPath.includes("\\") ||
    requestedPath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} 必须使用 model/ 内相对路径。`);
  }
  const resolvedPath = resolve(root, requestedPath);
  const relativePath = relative(root, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} 必须位于 model/ 内。`);
  }
  assertExistingParentInside(root, resolvedPath, label);
  return resolvedPath;
}

function assertExistingParentInside(
  root: string,
  path: string,
  label: string,
): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} 必须位于指定目录内。`);
  }
  const realRoot = realpathSync(root);
  let existingParent = existsSync(path) ? path : dirname(path);
  while (!existsSync(existingParent)) {
    const nextParent = dirname(existingParent);
    if (nextParent === existingParent) {
      throw new Error(`${label} 无法解析已存在的父目录。`);
    }
    existingParent = nextParent;
  }
  const realParent = realpathSync(existingParent);
  const realRelative = relative(realRoot, realParent);
  if (
    realRelative === ".." ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative)
  ) {
    throw new Error(`${label} 的真实父目录越出指定目录。`);
  }
}

function assertInside(root: string, path: string, label: string): void {
  assertExistingParentInside(root, path, label);
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

async function main(): Promise<void> {
  let stagingOutputDirectory: string | undefined;
  let stagingPublishedDirectory: string | undefined;
  let stagingReleaseManifestPath: string | undefined;
  let finalizedOutputDirectory: string | undefined;
  let finalizedPublishedDirectory: string | undefined;
  let finalizedReleaseManifestPath: string | undefined;
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const casesRoot = resolve(modelRoot, "cases");
    const contentManifestPath = resolve(
      casesRoot,
      "manifest.phase6-compat.v2-rc9.json",
    );
    const contentManifest = loadCaseManifestV2(
      contentManifestPath,
    );
    const releasePolicy = contentManifest.releasePolicy;
    const outputDirectory = resolveInside(
      modelRoot,
      args.outputDirectory,
      "C7 AI evidence output",
    );
    const publishedDirectory = resolveInside(
      modelRoot,
      args.publishedDirectory,
      "C7 published output",
    );
    const releaseManifestPath = resolveInside(
      modelRoot,
      args.releaseManifestPath,
      "C7 case manifest output",
    );
    assertInside(resolve(casesRoot, "published"), publishedDirectory, "C7 published output");
    assertInside(casesRoot, releaseManifestPath, "C7 case manifest output");
    if (
      existsSync(outputDirectory) ||
      existsSync(publishedDirectory) ||
      existsSync(releaseManifestPath)
    ) {
      throw new Error("C7 输出已存在；不会覆盖既有病例或证据。");
    }
    const stagingSuffix = `.tmp-${randomUUID()}`;
    stagingOutputDirectory = `${outputDirectory}${stagingSuffix}`;
    stagingPublishedDirectory = `${publishedDirectory}${stagingSuffix}`;
    stagingReleaseManifestPath = `${releaseManifestPath}${stagingSuffix}`;
    const stagedOutput = stagingOutputDirectory;
    const stagedPublished = stagingPublishedDirectory;
    const stagedManifest = stagingReleaseManifestPath;

    const cases = loadSupportedCasePackages(
      contentManifest.cases.map(({ path }) =>
        resolveCaseManifestArtifactPath(casesRoot, path)
      ),
    );
    for (const [index, casePackage] of cases.entries()) {
      const binding = contentManifest.cases[index]!;
      if (
        casePackage.packageStatus !== binding.packageStatus ||
        casePackage.schemaVersion !== binding.casePackageSchemaVersion ||
        casePackage.publicCaseId !== binding.publicCaseId ||
        casePackage.caseVersion !== binding.caseVersion ||
        casePackage.provenance.contentHash !== binding.contentHash ||
        computeCaseContentHash(casePackage) !== binding.contentHash
      ) {
        throw new Error(`C7 draft binding drifted: ${binding.publicCaseId}`);
      }
    }

    mkdirSync(stagedOutput, { recursive: true });
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const baseTransport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const transport = new ObservedCaseReviewTransport(baseTransport);
    const bundles = loadPhase6CaseBundles(casesRoot);
    const bundleByCaseId = new Map(
      bundles.map((bundle) => [bundle.casePackage.internalCaseId, bundle]),
    );
    const scoringPolicySummary = readFileSync(
      resolve(modelRoot, "evaluation/scoring-policy-v1.md"),
      "utf8",
    );
    const validations = [];
    const validationArtifacts: Array<{
      publicCaseId: string;
      caseVersion: string;
      contentHash: string;
      path: string;
      sha256: string;
    }> = [];
    const actualModelIds = new Set<string>();
    const reviewFindings: Array<{
      code: string;
      scope: string;
      decision: string;
    }> = [];

    for (const casePackage of cases) {
      const bundle = bundleByCaseId.get(casePackage.internalCaseId);
      if (bundle === undefined) {
        throw new Error(`C7 regression bundle missing: ${casePackage.publicCaseId}`);
      }
      const validation = await generatePhase8CaseCrossReviewV3({
        casePackage,
        transport,
        modelId: args.modelId,
        supportingArtifacts: {
          regressionTrajectories: bundle.trajectories,
          scoringPolicySummary,
        },
      });
      validations.push(validation);
      for (const entry of validation.validations) {
        if (entry.runStatus === "completed") actualModelIds.add(entry.modelId);
      }
      const validationPath = resolve(
        stagedOutput,
        "case-validations",
        `${casePackage.publicCaseId}--${casePackage.caseVersion}.ai-review-v3.json`,
      );
      writeJsonExclusive(validationPath, validation);
      validationArtifacts.push({
        publicCaseId: casePackage.publicCaseId,
        caseVersion: casePackage.caseVersion,
        contentHash: validation.contentHash,
        path: normalizedRelative(
          modelRoot,
          resolve(outputDirectory, relative(stagedOutput, validationPath)),
        ),
        sha256: sha256File(validationPath),
      });
      if (validation.decision !== "approved") {
        reviewFindings.push({
          code: "CASE_AI_REVIEW_NOT_APPROVED",
          scope: casePackage.publicCaseId,
          decision: validation.decision,
        });
      }
    }

    for (const attempt of transport.attempts) {
      if (attempt.actualModelId !== undefined) {
        actualModelIds.add(attempt.actualModelId);
      }
    }

    const templateRegistry = Object.fromEntries(
      Object.entries(MEDICAL_SAFETY_TEMPLATES_V1).map(
        ([decision, template]) => [decision, template.templateId],
      ),
    );
    const safetyValidation = await generatePhase8SafetyCorpusValidation({
      samples: PHASE7_SAFETY_CORPUS_V1,
      transport,
      modelId: args.modelId,
      policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
      templateRegistry,
    });
    for (const entry of safetyValidation.validations) {
      if (entry.runStatus !== "failed_to_run" || entry.subcallCount > 0) {
        actualModelIds.add(entry.modelId);
      }
    }
    if (safetyValidation.decision !== "approved") {
      reviewFindings.push({
        code: "SAFETY_AI_REVIEW_NOT_APPROVED",
        scope: "phase7-safety-corpus",
        decision: safetyValidation.decision,
      });
    }
    if (actualModelIds.size > 1) {
      throw new Error("C7 actual model ID drifted across review artifacts.");
    }
    const safetyPath = resolve(
      stagedOutput,
      "safety-corpus-ai-validation.json",
    );
    writeJsonExclusive(safetyPath, safetyValidation);

    const allCaseReviewsApproved = validations.every(
      ({ decision }) => decision === "approved",
    );
    const allReviewsApproved = allCaseReviewsApproved &&
      safetyValidation.decision === "approved";
    const publishedArtifacts = validations.map((validation) => {
      const bundle = bundleByCaseId.get(validation.caseId);
      if (bundle === undefined) throw new Error(`C7 bundle missing: ${validation.caseId}`);
      if (validation.decision !== "approved") {
        const reported = publishManifestReviewArtifacts({
          casePackage: bundle.casePackage,
          review: validation,
          outputDirectory: stagedPublished,
        });
        return {
          publicCaseId: bundle.casePackage.publicCaseId,
          caseVersion: bundle.casePackage.caseVersion,
          contentHash: bundle.casePackage.provenance.contentHash!,
          casePackageSchemaVersion: bundle.casePackage.schemaVersion,
          packageStatus: bundle.casePackage.packageStatus,
          reviewStatus: reported.reviewStatus,
          findings: validation.validations.flatMap(({ findings }) => findings),
          path: normalizedRelative(
            casesRoot,
            resolve(publishedDirectory, relative(stagedPublished, reported.candidatePath)),
          ),
          validationRecordPath: normalizedRelative(
            casesRoot,
            resolve(publishedDirectory, relative(stagedPublished, reported.reviewRecordPath)),
          ),
          caseSha256: sha256File(reported.candidatePath),
          validationSha256: sha256File(reported.reviewRecordPath),
        };
      }
      if (bundle.casePackage.schemaVersion === "case-package-v2-rc1") {
        const published = publishManifestCaseCandidate({
          casePackage: bundle.casePackage,
          review: validation,
          reviewStatus: "approved",
          outputDirectory: stagedPublished,
        });
        return {
          publicCaseId: published.casePackage.publicCaseId,
          caseVersion: published.casePackage.caseVersion,
          contentHash: published.casePackage.provenance.contentHash,
          casePackageSchemaVersion: published.casePackage.schemaVersion,
          packageStatus: published.casePackage.packageStatus,
          reviewStatus: published.reviewStatus,
          findings: validation.validations.flatMap(({ findings }) => findings),
          path: normalizedRelative(
            casesRoot,
            resolve(publishedDirectory, relative(stagedPublished, published.outputPath)),
          ),
          validationRecordPath: normalizedRelative(
            casesRoot,
            resolve(publishedDirectory, relative(stagedPublished, published.reviewRecordPath)),
          ),
          caseSha256: sha256File(published.outputPath),
          validationSha256: sha256File(published.reviewRecordPath),
        };
      }
      throw new Error(
        `C7 v3 release requires CasePackage v2: ${bundle.casePackage.publicCaseId}`,
      );
    });
    const releaseManifest = buildC7ReportedCaseManifest({
      candidateManifest: contentManifest,
      artifacts: publishedArtifacts.map(({ validationRecordPath, ...artifact }) => ({
        ...artifact,
        reviewRecordPath: validationRecordPath,
      })),
    });
    writeJsonExclusive(stagedManifest, releaseManifest);

    const reviewSidecars: CaseReviewSidecarArtifactV1[] = publishedArtifacts.map(
      (artifact) => {
        return {
          publicCaseId: artifact.publicCaseId,
          caseId: cases.find(({ publicCaseId }) => publicCaseId === artifact.publicCaseId)!
            .internalCaseId,
          caseVersion: artifact.caseVersion,
          contentHash: artifact.contentHash,
          path: normalizedRelative(
            modelRoot,
            resolve(casesRoot, artifact.validationRecordPath),
          ),
          sha256: artifact.validationSha256,
        };
      },
    );
    const caseReviewEvidence = buildCaseReviewEvidence({
      expectedCaseCount: releasePolicy.expectedCaseCount,
      configuredModelId: args.modelId,
      attempts: transport.attempts,
      sidecars: reviewSidecars,
      reviews: validations,
    });

    const index = {
      schemaVersion: "phase8-ai-evidence-index-v1",
      evidenceStatus: "independent_ai_cross_validation",
      generatedAt: new Date().toISOString(),
      provider: {
        providerName: runtime.providerName,
        protocol: transport.protocol,
        endpointSha256: runtime.endpointSha256,
        configuredModelId: args.modelId,
        ...(actualModelIds.size === 1
          ? { actualModelId: [...actualModelIds][0]! }
          : {}),
      },
      supersededInputExcluded: true,
      reviewPolicy: "non_blocking",
      reviewFindings,
      releasePolicy: structuredClone(releasePolicy),
      sourceCandidateManifest: {
        path: normalizedRelative(modelRoot, contentManifestPath),
        sha256: sha256File(contentManifestPath),
      },
      caseManifest: {
        path: normalizedRelative(modelRoot, releaseManifestPath),
        sha256: sha256File(stagedManifest),
      },
      caseValidations: validationArtifacts,
      caseValidationSetSha256: sha256Canonical(validationArtifacts),
      caseReviewEvidence,
      publishedArtifacts,
      safetyCorpus: {
        datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
        corpusHash: safetyValidation.corpusHash,
        holdoutHash: safetyValidation.holdoutHash,
        totalSamples: safetyValidation.totalSamples,
        holdoutSamples: safetyValidation.holdoutSamples,
        policyVersion: safetyValidation.policyVersion,
        templateRegistryHash: safetyValidation.templateRegistryHash,
        path: normalizedRelative(
          modelRoot,
          resolve(outputDirectory, relative(stagedOutput, safetyPath)),
        ),
        sha256: sha256File(safetyPath),
      },
    };
    const indexPath = resolve(stagedOutput, "ai-evidence-index.json");
    const finalIndexPath = resolve(outputDirectory, "ai-evidence-index.json");
    writeJsonExclusive(indexPath, index);
    writeJsonExclusive(resolve(stagedOutput, "publication-index.json"), {
      schemaVersion: "c7-case-publication-index-v1",
      reviewPolicy: "non_blocking",
      findings: reviewFindings,
      candidateManifest: index.sourceCandidateManifest,
      releaseManifest: index.caseManifest,
      publishedArtifacts,
      validationSetSha256: index.caseValidationSetSha256,
      caseReviewEvidence,
    });

    assertInside(resolve(casesRoot, "published"), publishedDirectory, "C7 published output");
    assertInside(casesRoot, releaseManifestPath, "C7 case manifest output");
    assertInside(modelRoot, outputDirectory, "C7 AI evidence output");
    publishDirectoryExclusive(stagedPublished, publishedDirectory);
    finalizedPublishedDirectory = publishedDirectory;
    stagingPublishedDirectory = undefined;
    assertContainedDirectory(resolve(casesRoot, "published"), publishedDirectory, "C7 published output");
    publishFileExclusive(stagedManifest, releaseManifestPath);
    finalizedReleaseManifestPath = releaseManifestPath;
    stagingReleaseManifestPath = undefined;
    assertContainedRegularFile(casesRoot, releaseManifestPath, "C7 case manifest output");
    publishDirectoryExclusive(stagedOutput, outputDirectory);
    finalizedOutputDirectory = outputDirectory;
    stagingOutputDirectory = undefined;
    assertContainedDirectory(modelRoot, outputDirectory, "C7 AI evidence output");
    verifyCaseAiCrossReviewIndex({ modelRoot, indexPath: finalIndexPath });

    process.stdout.write(`${JSON.stringify({
      status: allReviewsApproved
        ? "C7_AI_VALIDATION_AND_CASE_RELEASE_READY"
        : "C7_AI_REVIEW_REPORTED",
      outputDirectory: normalizedRelative(modelRoot, outputDirectory),
      releaseManifest: normalizedRelative(modelRoot, releaseManifestPath),
      publishedDirectory: normalizedRelative(modelRoot, publishedDirectory),
      cases: publishedArtifacts.length,
      actualModelId: index.provider.actualModelId ?? null,
      safetySamples: safetyValidation.totalSamples,
      reviewPolicy: "non_blocking",
      findings: reviewFindings.length,
      indexSha256: sha256File(finalIndexPath),
    }, null, 2)}\n`);
  } catch (error) {
    for (const path of [
      finalizedOutputDirectory,
      finalizedReleaseManifestPath,
      finalizedPublishedDirectory,
      stagingOutputDirectory,
      stagingPublishedDirectory,
      stagingReleaseManifestPath,
    ]) {
      if (path !== undefined) rmSync(path, { recursive: true, force: true });
    }
    const message = error instanceof Error ? error.message : "未知 C7 AI 发布错误。";
    process.stderr.write(`C7 AI 发布失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
