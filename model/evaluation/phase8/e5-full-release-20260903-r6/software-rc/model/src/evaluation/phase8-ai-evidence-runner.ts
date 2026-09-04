import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCasePackages } from "../cli/case-loader.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  PHASE7_SAFETY_CORPUS_V1,
  PHASE7_SAFETY_CORPUS_VERSION_V1,
} from "./phase7-safety-corpus.js";
import {
  generatePhase8CaseValidation,
  generatePhase8SafetyCorpusValidation,
} from "./phase8-ai-evidence.js";

const USAGE = `用法：npm run phase8:ai-validate -- --model <modelId> --output <evaluation/phase8/preflight-dir>

该命令使用当前已配置的 OpenAI Responses-compatible Provider，生成 5 个 published
病例的两角色盲审 sidecar 和 165 条安全语料的两角色独立 AI 验证产物。输出目录必须
位于 model/ 内且必须尚不存在。`;

interface PublishedManifest {
  publishedCases: Array<{
    publicCaseId: string;
    caseVersion: string;
    path: string;
    contentHash: string;
  }>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv: readonly string[]): {
  modelId: string;
  outputDirectory: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== "--model" && key !== "--output") {
      throw new Error(`未知参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key, value);
    index += 1;
  }
  const modelId = values.get("--model") ?? process.env["AHAMED_MODEL_ID"];
  const outputDirectory = values.get("--output");
  if (modelId === undefined || modelId.trim().length === 0) {
    throw new Error("必须提供 --model <modelId>。");
  }
  if (outputDirectory === undefined || outputDirectory.trim().length === 0) {
    throw new Error("必须提供 --output <directory>。");
  }
  return {
    modelId: modelId.trim(),
    outputDirectory: outputDirectory.trim(),
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
    throw new Error("Phase 8 输出目录必须是 model/ 内的相对路径。");
  }
  return resolvedPath;
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
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (existsSync(outputDirectory)) {
      throw new Error("Phase 8 AI 证据输出目录已存在；不会覆盖既有证据。");
    }
    mkdirSync(outputDirectory, { recursive: true });
    const manifestPath = resolve(modelRoot, "cases/manifest.v1-rc1.json");
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as PublishedManifest;
    if (manifest.publishedCases.length !== 5) {
      throw new Error("Phase 8 AI 验证要求 manifest 中恰好有 5 个 published 病例。");
    }
    const cases = loadCasePackages(
      manifest.publishedCases.map(({ path }) => resolve(modelRoot, "cases", path)),
    );
    const regressionByCaseId = new Map<string, unknown>();
    for (const fileName of readdirSync(resolve(modelRoot, "cases/regression"))) {
      if (!fileName.endsWith(".trajectories.json")) continue;
      const value = JSON.parse(
        readFileSync(resolve(modelRoot, "cases/regression", fileName), "utf8"),
      ) as { caseId?: unknown };
      if (typeof value.caseId === "string") regressionByCaseId.set(value.caseId, value);
    }
    const scoringPolicySummary = readFileSync(
      resolve(modelRoot, "evaluation/scoring-policy-v1.md"),
      "utf8",
    );
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const generatedAt = new Date().toISOString();
    const validationArtifacts: Array<{
      publicCaseId: string;
      caseVersion: string;
      contentHash: string;
      path: string;
      sha256: string;
    }> = [];
    const actualModelIds = new Set<string>();

    for (const casePackage of cases) {
      const validation = await generatePhase8CaseValidation({
        casePackage,
        transport,
        modelId: args.modelId,
        supportingArtifacts: {
          regressionTrajectories: regressionByCaseId.get(
            casePackage.internalCaseId,
          ),
          scoringPolicySummary,
        },
      });
      for (const entry of validation.validations) actualModelIds.add(entry.modelId);
      const fileName = `${casePackage.publicCaseId}--${casePackage.caseVersion}.ai-validation-v2.json`;
      const path = resolve(outputDirectory, "case-validations", fileName);
      writeJsonExclusive(path, validation);
      validationArtifacts.push({
        publicCaseId: casePackage.publicCaseId,
        caseVersion: casePackage.caseVersion,
        contentHash: validation.contentHash,
        path: relative(modelRoot, path).replaceAll("\\", "/"),
        sha256: sha256File(path),
      });
      if (validation.decision !== "approved") {
        throw new Error(
          `Phase 8 case AI validation rejected ${casePackage.publicCaseId}; inspect ${relative(modelRoot, path).replaceAll("\\", "/")}.`,
        );
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
    if (actualModelIds.size !== 1) {
      throw new Error(
        `Phase 8 AI evidence requires one stable actual model ID; observed ${actualModelIds.size}.`,
      );
    }
    if (safetyValidation.decision !== "approved") {
      throw new Error("Phase 8 safety corpus AI validation was rejected.");
    }
    const safetyPath = resolve(outputDirectory, "safety-corpus-ai-validation.json");
    writeJsonExclusive(safetyPath, safetyValidation);

    const index = {
      schemaVersion: "phase8-ai-evidence-index-v1",
      evidenceStatus: "independent_ai_cross_validation",
      generatedAt,
      provider: {
        providerName: runtime.providerName,
        protocol: transport.protocol,
        endpointSha256: runtime.endpointSha256,
        configuredModelId: args.modelId,
        actualModelId: [...actualModelIds][0],
      },
      caseManifest: {
        path: relative(modelRoot, manifestPath).replaceAll("\\", "/"),
        sha256: sha256File(manifestPath),
      },
      caseValidations: validationArtifacts,
      caseValidationSetSha256: sha256Canonical(validationArtifacts),
      safetyCorpus: {
        datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
        corpusHash: safetyValidation.corpusHash,
        holdoutHash: safetyValidation.holdoutHash,
        totalSamples: safetyValidation.totalSamples,
        holdoutSamples: safetyValidation.holdoutSamples,
        policyVersion: safetyValidation.policyVersion,
        templateRegistryHash: safetyValidation.templateRegistryHash,
        path: relative(modelRoot, safetyPath).replaceAll("\\", "/"),
        sha256: sha256File(safetyPath),
      },
    };
    const indexPath = resolve(outputDirectory, "ai-evidence-index.json");
    writeJsonExclusive(indexPath, index);
    process.stdout.write(`${JSON.stringify({
      status: "PHASE8_AI_EVIDENCE_READY",
      outputDirectory: relative(modelRoot, outputDirectory).replaceAll("\\", "/"),
      actualModelId: index.provider.actualModelId,
      caseValidations: validationArtifacts.length,
      safetySamples: safetyValidation.totalSamples,
      holdoutSamples: safetyValidation.holdoutSamples,
      indexSha256: sha256File(indexPath),
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Phase 8 AI 验证错误。";
    process.stderr.write(`Phase 8 AI 验证失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
