import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  generatePhase8PatientSampleValidation,
  type Phase8PatientReplySampleV1,
} from "./phase8-ai-evidence.js";

interface CandidateReport {
  benchmarkKind: "candidate_preflight" | "rc_release";
  repeatCount: number;
  runCount: number;
  failedRuns: number;
  providerName: string;
  protocol: "openai-responses";
  endpointSha256: string;
  configuredModelId: string;
  actualModelId: string;
  runSetSha256: string;
  bindings: Record<string, string>;
  quality: Record<string, number>;
  latency: Record<string, number>;
  totalUsage: Record<string, number>;
  gate: { status: "passed" | "failed" };
}

interface PrivateSampleSet {
  schemaVersion: "phase8-private-patient-sample-set-v1";
  candidateRunSetSha256: string;
  sampleSetSha256: string;
  sampleCount: number;
  samples: Phase8PatientReplySampleV1[];
}

function parseArguments(argv: readonly string[]): { evidence: string; modelId: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if ((key !== "--evidence" && key !== "--model") || value === undefined) {
      throw new Error("用法：npm run phase8:patient-audit -- --evidence <dir> --model <modelId>");
    }
    values.set(key, value);
  }
  const evidence = values.get("--evidence");
  const modelId = values.get("--model");
  if (evidence === undefined || modelId === undefined) {
    throw new Error("必须提供 --evidence 和 --model。");
  }
  return { evidence, modelId };
}

function resolveInside(root: string, requested: string): string {
  const path = resolve(root, requested);
  const rel = relative(root, path);
  if (isAbsolute(requested) || rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("证据目录必须是 model/ 内的相对路径。");
  }
  return path;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`缺少审核恢复输入：${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const directory = resolveInside(modelRoot, args.evidence);
    const reportPath = resolve(directory, "candidate-benchmark-report.json");
    const report = readJson<CandidateReport>(reportPath);
    const sampleSet = readJson<PrivateSampleSet>(
      resolve(directory, "private/patient-samples.v1.json"),
    );
    const expectedSamples = 5 * report.repeatCount * 4;
    if (
      report.gate.status !== "passed" ||
      report.configuredModelId !== args.modelId ||
      sampleSet.schemaVersion !== "phase8-private-patient-sample-set-v1" ||
      sampleSet.candidateRunSetSha256 !== report.runSetSha256 ||
      sampleSet.sampleCount !== expectedSamples ||
      sampleSet.samples.length !== expectedSamples ||
      sampleSet.sampleSetSha256 !== sha256Canonical(sampleSet.samples)
    ) {
      throw new Error("Phase 8 patient audit recovery inputs are invalid or drifted.");
    }
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    if (runtime.providerName !== report.providerName) {
      throw new Error("Phase 8 patient audit Provider identity drifted.");
    }
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    if (
      transport.protocol !== report.protocol ||
      transport.endpointSha256 !== report.endpointSha256
    ) {
      throw new Error("Phase 8 patient audit endpoint identity drifted.");
    }
    const validation = await generatePhase8PatientSampleValidation({
      samples: sampleSet.samples,
      transport,
      modelId: args.modelId,
      candidateRunSetSha256: report.runSetSha256,
      minimumSamples: expectedSamples,
    });
    const validationPath = resolve(directory, "patient-sample-ai-validation.json");
    writeJsonExclusive(validationPath, validation);
    const quality = {
      schemaVersion: "phase8-candidate-quality-safety-report-v1",
      benchmarkKind: report.benchmarkKind,
      generatedAt: new Date().toISOString(),
      candidateRunSetSha256: report.runSetSha256,
      candidateReport: {
        path: relative(modelRoot, reportPath).replaceAll("\\", "/"),
        sha256: sha256File(reportPath),
      },
      patientSampleValidation: {
        path: relative(modelRoot, validationPath).replaceAll("\\", "/"),
        sha256: sha256File(validationPath),
        sampleCount: validation.sampleCount,
        seriousErrors: validation.factOrSafetySeriousErrors,
        naturalAndRoleConsistentRate: validation.naturalAndRoleConsistentRate,
      },
      provider: {
        providerName: report.providerName,
        protocol: report.protocol,
        endpointSha256: report.endpointSha256,
        configuredModelId: report.configuredModelId,
        actualModelId: report.actualModelId,
      },
      bindings: report.bindings,
      quality: report.quality,
      latency: report.latency,
      usage: report.totalUsage,
      failureRate: report.failedRuns / report.runCount,
      gate: {
        status: validation.decision === "approved" ? "passed" : "failed",
        seriousErrors: validation.factOrSafetySeriousErrors,
        minimumNaturalAndRoleConsistentRate: 0.95,
      },
    };
    writeJsonExclusive(resolve(directory, "candidate-quality-safety-report.json"), quality);
    process.stdout.write(`${JSON.stringify({
      status: validation.decision === "approved"
        ? "PHASE8_PATIENT_AUDIT_READY"
        : "PHASE8_PATIENT_AUDIT_REJECTED",
      samples: validation.sampleCount,
      actualModelId: validation.validations[0]?.modelId,
      decision: validation.decision,
    }, null, 2)}\n`);
    if (validation.decision !== "approved") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知审核恢复错误。";
    process.stderr.write(`Phase 8 patient audit 恢复失败：${message}\n`);
    process.exitCode = 1;
  }
}

await main();
