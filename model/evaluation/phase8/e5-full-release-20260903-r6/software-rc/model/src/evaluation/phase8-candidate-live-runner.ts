import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PHASE8_INTER_RUN_DELAY_MS = 15_000;

async function pacePhase8Runs(): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, PHASE8_INTER_RUN_DELAY_MS);
  });
}

import { loadCasePackages } from "../cli/case-loader.js";
import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
  OpenAIModelProvider,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import {
  sha256Canonical,
  type Phase8CaseValidationV2,
} from "../release/phase8-release.js";
import {
  generatePhase8PatientSampleValidation,
  type Phase8PatientReplySampleV1,
} from "./phase8-ai-evidence.js";
import {
  runPhase8CandidateBenchmark,
  type Phase8BenchmarkKind,
  type Phase8CandidateBenchmarkBindings,
} from "./phase8-candidate-benchmark.js";
import { runProviderC01LiveEval } from "./openai-live-eval.js";

const USAGE = `用法：npm run eval:phase8:candidate -- --model <modelId> --ai-evidence <dir> --output <dir>
或：npm run eval:phase8:release -- --model <modelId> --ai-evidence <dir> --output <dir>

candidate 固定每病例 3 次；release 固定每病例 5 次。只加载 published manifest 与
Phase 8 v2 validation sidecar，并使用当前 OpenAI Responses-compatible Provider。`;

interface AiEvidenceIndex {
  schemaVersion: "phase8-ai-evidence-index-v1";
  provider: {
    providerName: string;
    protocol: string;
    endpointSha256: string;
    configuredModelId: string;
    actualModelId: string;
  };
  caseManifest: { path: string; sha256: string };
  caseValidations: Array<{
    publicCaseId: string;
    caseVersion: string;
    contentHash: string;
    path: string;
    sha256: string;
  }>;
  caseValidationSetSha256: string;
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
}

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
  aiEvidenceDirectory: string;
  outputDirectory: string;
  benchmarkKind: Phase8BenchmarkKind;
  repeatCount: number;
  promptVersion: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--model", "--ai-evidence", "--output", "--kind", "--repeats", "--prompt-version"].includes(key ?? "")) {
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
  const aiEvidenceDirectory = values.get("--ai-evidence");
  const outputDirectory = values.get("--output");
  const requestedKind = values.get("--kind") ?? process.env["AHAMED_PHASE8_BENCHMARK_KIND"];
  const benchmarkKind: Phase8BenchmarkKind = requestedKind === "release"
    ? "rc_release"
    : requestedKind === "candidate"
      ? "candidate_preflight"
      : (() => {
          throw new Error("必须提供 --kind candidate 或 --kind release。");
        })();
  const expectedRepeats = benchmarkKind === "rc_release" ? 5 : 3;
  const repeatCount = Number(values.get("--repeats") ?? expectedRepeats);
  if (repeatCount !== expectedRepeats) {
    throw new Error(
      `${benchmarkKind} 必须固定每病例 ${expectedRepeats} 次，不接受其他重复次数。`,
    );
  }
  if (modelId === undefined || modelId.trim().length === 0) {
    throw new Error("必须提供 --model <modelId>。");
  }
  if (aiEvidenceDirectory === undefined || outputDirectory === undefined) {
    throw new Error("必须提供 --ai-evidence 与 --output。");
  }
  return {
    modelId: modelId.trim(),
    aiEvidenceDirectory,
    outputDirectory,
    benchmarkKind,
    repeatCount,
    promptVersion: values.get("--prompt-version") ?? "v0.2.0",
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

function resolveBoundFile(modelRoot: string, relativePath: string): string {
  const resolvedPath = resolveInsideModel(modelRoot, relativePath);
  if (!existsSync(resolvedPath)) throw new Error(`Phase 8 绑定文件不存在：${relativePath}`);
  return resolvedPath;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function hashSet(paths: readonly string[]): string {
  return sha256Canonical(
    paths
      .map((path) => ({ path, sha256: sha256File(path) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
}

function loadAndVerifyEvidence(
  modelRoot: string,
  directory: string,
  runtime: ReturnType<typeof resolveOpenAIRuntimeConfig>,
  modelId: string,
): {
  index: AiEvidenceIndex;
  manifest: PublishedManifest;
  cases: ReturnType<typeof loadCasePackages>;
  validations: Phase8CaseValidationV2[];
} {
  const indexPath = resolve(directory, "ai-evidence-index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as AiEvidenceIndex;
  if (
    index.schemaVersion !== "phase8-ai-evidence-index-v1" ||
    index.provider.providerName !== runtime.providerName ||
    index.provider.protocol !== "openai-responses" ||
    index.provider.endpointSha256 !== runtime.endpointSha256 ||
    index.provider.configuredModelId !== modelId ||
    index.caseValidations.length !== 5 ||
    index.safetyCorpus.totalSamples !== 165 ||
    index.safetyCorpus.holdoutSamples !== 33 ||
    index.safetyCorpus.policyVersion !== MEDICAL_SAFETY_POLICY_VERSION_V1
  ) {
    throw new Error("Phase 8 AI evidence index does not match the current runtime inputs.");
  }
  const manifestPath = resolveBoundFile(modelRoot, index.caseManifest.path);
  if (sha256File(manifestPath) !== index.caseManifest.sha256) {
    throw new Error("Phase 8 case manifest hash drifted after AI validation.");
  }
  const safetyPath = resolveBoundFile(modelRoot, index.safetyCorpus.path);
  if (sha256File(safetyPath) !== index.safetyCorpus.sha256) {
    throw new Error("Phase 8 safety corpus validation artifact hash drifted.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PublishedManifest;
  if (manifest.publishedCases.length !== 5) {
    throw new Error("Phase 8 candidate runner requires exactly 5 published cases.");
  }
  const cases = loadCasePackages(
    manifest.publishedCases.map(({ path }) => resolve(modelRoot, "cases", path)),
  );
  const validations = index.caseValidations.map((entry) => {
    const path = resolveBoundFile(modelRoot, entry.path);
    if (sha256File(path) !== entry.sha256) {
      throw new Error(`Phase 8 case validation hash drifted: ${entry.publicCaseId}`);
    }
    return JSON.parse(readFileSync(path, "utf8")) as Phase8CaseValidationV2;
  });
  return { index, manifest, cases, validations };
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const aiEvidenceDirectory = resolveInsideModel(modelRoot, args.aiEvidenceDirectory);
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (existsSync(outputDirectory)) {
      throw new Error("Phase 8 候选评测输出目录已存在；不会覆盖既有证据。");
    }
    mkdirSync(outputDirectory, { recursive: true });
    const evidence = loadAndVerifyEvidence(
      modelRoot,
      aiEvidenceDirectory,
      runtime,
      args.modelId,
    );
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const promptVersion = args.promptVersion;
    const provider = new OpenAIModelProvider({
      modelId: args.modelId,
      promptVersion,
      promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
      transport,
    });
    const providerManifest = provider.reproducibilityManifest();
    const promptPaths = [
      resolve(modelRoot, "prompts/controller", `${promptVersion}.md`),
      resolve(modelRoot, "prompts/patient", `${promptVersion}.md`),
      resolve(modelRoot, "prompts/evaluator", `${promptVersion}.md`),
    ];
    const templateRegistryHash = sha256Canonical(
      Object.fromEntries(
        Object.entries(MEDICAL_SAFETY_TEMPLATES_V1).map(
          ([decision, template]) => [decision, template.templateId],
        ),
      ),
    );
    if (templateRegistryHash !== evidence.index.safetyCorpus.templateRegistryHash) {
      throw new Error("Phase 8 safety template registry drifted after AI validation.");
    }
    const bindings: Phase8CandidateBenchmarkBindings = {
      caseManifestSha256: evidence.index.caseManifest.sha256,
      caseValidationSetSha256: evidence.index.caseValidationSetSha256,
      promptSetSha256: hashSet(promptPaths),
      scoringPolicySha256: hashSet([
        resolve(modelRoot, "src/evaluation/scoring-policy-v1.ts"),
        resolve(modelRoot, "evaluation/scoring-policy-v1.md"),
      ]),
      medicalSafetyPolicySha256: sha256File(
        resolve(modelRoot, "src/safety/medical-safety-policy-v1.ts"),
      ),
      safetyTemplateRegistrySha256: templateRegistryHash,
      shareContractSha256: sha256File(
        resolve(modelRoot, "../share/versions/contract-v1-rc1.json"),
      ),
    };
    const validationsByCaseId = new Map(
      evidence.validations.map((validation) => [validation.caseId, validation]),
    );
    const samples: Phase8PatientReplySampleV1[] = [];
    const report = await runPhase8CandidateBenchmark({
      benchmarkKind: args.benchmarkKind,
      repeatCount: args.repeatCount,
      cases: evidence.cases.map((casePackage) => {
        const validation = validationsByCaseId.get(casePackage.internalCaseId);
        if (validation === undefined) {
          throw new Error(`Phase 8 v2 validation is missing for ${casePackage.publicCaseId}.`);
        }
        return { casePackage, validation };
      }),
      bindings,
      async evaluate(casePackage, runNumber) {
        const runSamples: Phase8PatientReplySampleV1[] = [];
        try {
          const liveReport = await runProviderC01LiveEval({
            casePackage,
            provider,
            schemaVersion: "phase8-published-case-live-eval-v2",
            questionCount: 4,
            onPatientSample(sample) {
              runSamples.push({
                sampleId: `${casePackage.publicCaseId}.run-${runNumber}.turn-${runSamples.length + 1}`,
                caseId: casePackage.publicCaseId,
                caseVersion: casePackage.caseVersion,
                question: sample.question,
                reply: sample.reply,
                disclosedFactIds: [...sample.disclosedFactIds],
                authorizedFacts: structuredClone(sample.authorizedFacts),
                forbiddenDiagnosisTerms: [
                  casePackage.answerKey.targetDiagnosis,
                  ...casePackage.answerKey.acceptedSynonyms,
                ],
              });
            },
            validateProvider(candidate) {
              if (
                candidate.identity.providerName !== runtime.providerName ||
                candidate.reproducibilityManifest?.().protocol !== "openai-responses"
              ) {
                throw new Error("Phase 8 candidate Provider identity drifted.");
              }
            },
          });
          const rawPath = resolve(
            outputDirectory,
            "raw",
            `${casePackage.publicCaseId}--run-${runNumber}.json`,
          );
          writeJsonExclusive(rawPath, liveReport);
          process.stderr.write(
            `[phase8] completed ${casePackage.publicCaseId} run ${runNumber}\n`,
          );
          return liveReport;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          process.stderr.write(
            `[phase8] failed ${casePackage.publicCaseId} run ${runNumber}: ${message}\n`,
          );
          throw error;
        } finally {
          if (runSamples.length === 4) {
            samples.push(...runSamples);
          }
          await pacePhase8Runs();
        }
      },
    });
    const reportPath = resolve(outputDirectory, "candidate-benchmark-report.json");
    writeJsonExclusive(reportPath, report);
    if (report.gate.status !== "passed") {
      throw new Error(
        `Phase 8 candidate benchmark gate failed: ${report.gate.blockers.join(", ")}`,
      );
    }
    if (
      report.actualModelId !== evidence.index.provider.actualModelId ||
      report.protocol !== providerManifest.protocol ||
      report.endpointSha256 !== providerManifest.endpointSha256
    ) {
      throw new Error("Phase 8 candidate actual Provider/model identity drifted from AI evidence.");
    }
    const expectedSamples = 5 * args.repeatCount * 4;
    const privateSampleSet = {
      schemaVersion: "phase8-private-patient-sample-set-v1",
      candidateRunSetSha256: report.runSetSha256,
      sampleSetSha256: sha256Canonical(samples),
      sampleCount: samples.length,
      samples,
    };
    const privateSamplePath = resolve(
      outputDirectory,
      "private",
      "patient-samples.v1.json",
    );
    writeJsonExclusive(privateSamplePath, privateSampleSet);
    const sampleValidation = await generatePhase8PatientSampleValidation({
      samples,
      transport,
      modelId: args.modelId,
      candidateRunSetSha256: report.runSetSha256,
      minimumSamples: expectedSamples,
    });
    const sampleValidationPath = resolve(
      outputDirectory,
      "patient-sample-ai-validation.json",
    );
    writeJsonExclusive(sampleValidationPath, sampleValidation);

    const qualityReport = {
      schemaVersion: "phase8-candidate-quality-safety-report-v1",
      benchmarkKind: args.benchmarkKind,
      generatedAt: new Date().toISOString(),
      candidateRunSetSha256: report.runSetSha256,
      candidateReport: {
        path: relative(modelRoot, reportPath).replaceAll("\\", "/"),
        sha256: sha256File(reportPath),
      },
      patientSampleValidation: {
        path: relative(modelRoot, sampleValidationPath).replaceAll("\\", "/"),
        sha256: sha256File(sampleValidationPath),
        sampleCount: sampleValidation.sampleCount,
        seriousErrors: sampleValidation.factOrSafetySeriousErrors,
        naturalAndRoleConsistentRate:
          sampleValidation.naturalAndRoleConsistentRate,
      },
      provider: {
        providerName: report.providerName,
        protocol: report.protocol,
        endpointSha256: report.endpointSha256,
        configuredModelId: report.configuredModelId,
        actualModelId: report.actualModelId,
      },
      bindings,
      quality: report.quality,
      latency: report.latency,
      usage: report.totalUsage,
      failureRate: report.failedRuns / report.runCount,
      gate: {
        status: sampleValidation.decision === "approved" ? "passed" : "failed",
        seriousErrors: sampleValidation.factOrSafetySeriousErrors,
        minimumNaturalAndRoleConsistentRate: 0.95,
      },
    };
    const qualityPath = resolve(
      outputDirectory,
      "candidate-quality-safety-report.json",
    );
    writeJsonExclusive(qualityPath, qualityReport);

    if (sampleValidation.decision !== "approved") {
      throw new Error("Phase 8 independent patient reply sample validation was rejected.");
    }

    if (args.benchmarkKind === "candidate_preflight") {
      const approval = {
        schemaVersion: "phase8-provider-model-approval-v1",
        decision: "approved",
        decisionRef: "user.directive.complete-phase8.2026-08-28",
        decidedAt: new Date().toISOString(),
        scope: "software_rc_candidate",
        approvedProviders: [
          {
            providerName: report.providerName,
            protocol: report.protocol,
            endpointSha256: report.endpointSha256,
            configuredModelId: report.configuredModelId,
            actualModelId: report.actualModelId,
            promptVersion: report.promptVersion,
          },
        ],
        excludedProviders: [
          {
            providerName: "anthropic",
            reason: "No independent Claude key or equivalent live candidate evidence; adapter remains optional and mock-tested only.",
          },
        ],
        candidateReportSha256: sha256File(reportPath),
        qualityReportSha256: sha256File(qualityPath),
      };
      writeJsonExclusive(resolve(outputDirectory, "provider-model-approval.json"), approval);
    }

    process.stdout.write(`${JSON.stringify({
      status: args.benchmarkKind === "rc_release"
        ? "PHASE8_RC_RELEASE_EVAL_READY"
        : "PHASE8_CANDIDATE_PREFLIGHT_READY",
      outputDirectory: relative(modelRoot, outputDirectory).replaceAll("\\", "/"),
      cases: report.caseCount,
      repeatsPerCase: report.repeatCount,
      runs: report.runCount,
      patientSamples: sampleValidation.sampleCount,
      actualModelId: report.actualModelId,
      runSetSha256: report.runSetSha256,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Phase 8 候选评测错误。";
    process.stderr.write(`Phase 8 候选评测失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
