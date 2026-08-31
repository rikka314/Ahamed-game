import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCasePackages } from "../cli/case-loader.js";
import {
  loadPhase6CaseBundles,
  publishAiValidatedCase,
} from "../cases/phase6-case-production.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import {
  buildC7PublishedCaseManifest,
  toAiCaseCrossValidationV1,
  type C7CandidateCaseManifest,
} from "../release/c7-case-release.js";
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
  generatePhase8CaseValidation,
  generatePhase8SafetyCorpusValidation,
} from "./phase8-ai-evidence.js";

const USAGE = `用法：npm run c7:ai-release -- --model <modelId> --output <evaluation-dir> --published <cases/published/subdir> --manifest <cases/new-manifest.json>

输入固定为 cases/manifest.dialogue-candidate.v1-rc1.json。所有输出必须在 model/ 内且不得已存在；旧 manifest、published 病例和 superseded 证据不会被覆盖。`;

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
  if (isAbsolute(requestedPath)) {
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
    throw new Error(`${label} 必须位于指定目录内。`);
  }
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

function loadCandidateManifest(path: string): C7CandidateCaseManifest {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as C7CandidateCaseManifest;
  if (
    parsed.manifestVersion !== "case-manifest-v1-rc1" ||
    !Array.isArray(parsed.draftCases) ||
    parsed.draftCases.length !== 5 ||
    !Array.isArray(parsed.publishedCases) ||
    parsed.publishedCases.length !== 0
  ) {
    throw new Error("C7 dialogue candidate manifest must contain five drafts and zero published cases.");
  }
  return parsed;
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const casesRoot = resolve(modelRoot, "cases");
    const candidateManifestPath = resolve(
      casesRoot,
      "manifest.dialogue-candidate.v1-rc1.json",
    );
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

    const candidateManifest = loadCandidateManifest(candidateManifestPath);
    const cases = loadCasePackages(
      candidateManifest.draftCases.map(({ path }) => resolve(casesRoot, path)),
    );
    for (const [index, casePackage] of cases.entries()) {
      const binding = candidateManifest.draftCases[index]!;
      if (
        casePackage.packageStatus !== "draft" ||
        casePackage.publicCaseId !== binding.publicCaseId ||
        casePackage.caseVersion !== binding.caseVersion ||
        casePackage.provenance.contentHash !== binding.contentHash ||
        computeCaseContentHash(casePackage) !== binding.contentHash
      ) {
        throw new Error(`C7 draft binding drifted: ${binding.publicCaseId}`);
      }
    }

    mkdirSync(outputDirectory, { recursive: true });
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
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

    for (const casePackage of cases) {
      const bundle = bundleByCaseId.get(casePackage.internalCaseId);
      if (bundle === undefined) {
        throw new Error(`C7 regression bundle missing: ${casePackage.publicCaseId}`);
      }
      const validation = await generatePhase8CaseValidation({
        casePackage,
        transport,
        modelId: args.modelId,
        supportingArtifacts: {
          regressionTrajectories: bundle.trajectories,
          scoringPolicySummary,
        },
      });
      validations.push(validation);
      for (const entry of validation.validations) actualModelIds.add(entry.modelId);
      const validationPath = resolve(
        outputDirectory,
        "case-validations",
        `${casePackage.publicCaseId}--${casePackage.caseVersion}.ai-validation-v2.json`,
      );
      writeJsonExclusive(validationPath, validation);
      validationArtifacts.push({
        publicCaseId: casePackage.publicCaseId,
        caseVersion: casePackage.caseVersion,
        contentHash: validation.contentHash,
        path: normalizedRelative(modelRoot, validationPath),
        sha256: sha256File(validationPath),
      });
      if (validation.decision !== "approved") {
        throw new Error(`C7 dual AI validation rejected ${casePackage.publicCaseId}.`);
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
    for (const entry of safetyValidation.validations) actualModelIds.add(entry.modelId);
    if (safetyValidation.decision !== "approved" || actualModelIds.size !== 1) {
      throw new Error("C7 safety corpus validation failed or actual model ID drifted.");
    }
    const safetyPath = resolve(
      outputDirectory,
      "safety-corpus-ai-validation.json",
    );
    writeJsonExclusive(safetyPath, safetyValidation);

    const publishedArtifacts = validations.map((validation) => {
      const bundle = bundleByCaseId.get(validation.caseId);
      if (bundle === undefined) throw new Error(`C7 bundle missing: ${validation.caseId}`);
      const published = publishAiValidatedCase({
        bundle,
        validation: toAiCaseCrossValidationV1(validation),
        outputDirectory: publishedDirectory,
      });
      if (published.casePackage.provenance.contentHash !== validation.contentHash) {
        throw new Error(`C7 published content hash drifted: ${validation.caseId}`);
      }
      return {
        publicCaseId: published.casePackage.publicCaseId,
        caseVersion: published.casePackage.caseVersion,
        contentHash: published.casePackage.provenance.contentHash!,
        path: normalizedRelative(casesRoot, published.outputPath),
        validationRecordPath: normalizedRelative(
          casesRoot,
          published.validationRecordPath,
        ),
        caseSha256: sha256File(published.outputPath),
        validationSha256: sha256File(published.validationRecordPath),
      };
    });
    const releaseManifest = buildC7PublishedCaseManifest({
      candidateManifest,
      publishedCases: publishedArtifacts,
    });
    writeJsonExclusive(releaseManifestPath, releaseManifest);

    const index = {
      schemaVersion: "phase8-ai-evidence-index-v1",
      evidenceStatus: "independent_ai_cross_validation",
      generatedAt: new Date().toISOString(),
      provider: {
        providerName: runtime.providerName,
        protocol: transport.protocol,
        endpointSha256: runtime.endpointSha256,
        configuredModelId: args.modelId,
        actualModelId: [...actualModelIds][0],
      },
      supersededInputExcluded: true,
      sourceCandidateManifest: {
        path: normalizedRelative(modelRoot, candidateManifestPath),
        sha256: sha256File(candidateManifestPath),
      },
      caseManifest: {
        path: normalizedRelative(modelRoot, releaseManifestPath),
        sha256: sha256File(releaseManifestPath),
      },
      caseValidations: validationArtifacts,
      caseValidationSetSha256: sha256Canonical(validationArtifacts),
      publishedArtifacts,
      safetyCorpus: {
        datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
        corpusHash: safetyValidation.corpusHash,
        holdoutHash: safetyValidation.holdoutHash,
        totalSamples: safetyValidation.totalSamples,
        holdoutSamples: safetyValidation.holdoutSamples,
        policyVersion: safetyValidation.policyVersion,
        templateRegistryHash: safetyValidation.templateRegistryHash,
        path: normalizedRelative(modelRoot, safetyPath),
        sha256: sha256File(safetyPath),
      },
    };
    const indexPath = resolve(outputDirectory, "ai-evidence-index.json");
    writeJsonExclusive(indexPath, index);
    writeJsonExclusive(resolve(outputDirectory, "publication-index.json"), {
      schemaVersion: "c7-case-publication-index-v1",
      candidateManifest: index.sourceCandidateManifest,
      releaseManifest: index.caseManifest,
      publishedArtifacts,
      validationSetSha256: index.caseValidationSetSha256,
    });

    process.stdout.write(`${JSON.stringify({
      status: "C7_AI_VALIDATION_AND_CASE_RELEASE_READY",
      outputDirectory: normalizedRelative(modelRoot, outputDirectory),
      releaseManifest: normalizedRelative(modelRoot, releaseManifestPath),
      publishedDirectory: normalizedRelative(modelRoot, publishedDirectory),
      cases: publishedArtifacts.length,
      actualModelId: index.provider.actualModelId,
      safetySamples: safetyValidation.totalSamples,
      indexSha256: sha256File(indexPath),
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 C7 AI 发布错误。";
    process.stderr.write(`C7 AI 发布失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
