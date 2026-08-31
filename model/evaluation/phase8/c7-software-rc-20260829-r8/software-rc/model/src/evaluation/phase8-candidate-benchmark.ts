import type { CasePackage } from "../domain/case-package.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  assertPhase8CaseValidation,
  sha256Canonical,
  type Phase8CaseValidationV2,
} from "../release/phase8-release.js";
import type { ProviderLiveEvalReport } from "./openai-live-eval.js";

const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type Phase8BenchmarkKind = "candidate_preflight" | "rc_release";

export interface Phase8CandidateBenchmarkBindings {
  caseManifestSha256: string;
  caseValidationSetSha256: string;
  promptSetSha256: string;
  scoringPolicySha256: string;
  medicalSafetyPolicySha256: string;
  safetyTemplateRegistrySha256: string;
  shareContractSha256: string;
}

export interface Phase8CandidateCase {
  casePackage: CasePackage;
  validation: Phase8CaseValidationV2;
}

export interface Phase8CandidateRunSummary {
  runId: string;
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  runNumber: number;
  status: "completed" | "failed";
  benchmarkFingerprint?: string;
  actualModelId?: string;
  totalScore?: number;
  callCount?: number;
  controllerFactRouting?: {
    evaluatedTurns: number;
    matchedTurns: number;
  };
  durationMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  failureCode?: "EVALUATION_FAILED";
}

export interface Phase8CandidateBenchmarkReport {
  schemaVersion: "phase8-candidate-benchmark-v1";
  benchmarkKind: Phase8BenchmarkKind;
  evidenceStatus: "live_provider_evidence";
  generatedAt: string;
  repeatCount: number;
  caseCount: number;
  runCount: number;
  completedRuns: number;
  failedRuns: number;
  providerName: string;
  protocol: string;
  endpointSha256: string;
  configuredModelId: string;
  actualModelId: string;
  promptVersion: string;
  bindings: Phase8CandidateBenchmarkBindings;
  runSetSha256: string;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latency: {
    totalDurationMs: number;
    averageDurationMs: number;
    maximumDurationMs: number;
  };
  quality: {
    averageTotalScore: number;
    minimumTotalScore: number;
    maximumTotalScore: number;
    controllerFactRoutingAccuracy: number;
  };
  gate: {
    status: "passed" | "failed";
    requiredCompletedRate: 0.95;
    completedRate: number;
    blockers: string[];
  };
  runs: Phase8CandidateRunSummary[];
}

function assertBindings(bindings: Phase8CandidateBenchmarkBindings): void {
  for (const [name, value] of Object.entries(bindings)) {
    if (!HEX_SHA256_PATTERN.test(value)) {
      throw new Error(`Phase 8 candidate benchmark binding ${name} is invalid`);
    }
  }
}

function assertCandidateInputs(input: {
  benchmarkKind: Phase8BenchmarkKind;
  repeatCount: number;
  cases: readonly Phase8CandidateCase[];
  bindings: Phase8CandidateBenchmarkBindings;
}): void {
  const minimumRepeats = input.benchmarkKind === "rc_release" ? 5 : 3;
  if (!Number.isInteger(input.repeatCount) || input.repeatCount < minimumRepeats) {
    throw new Error(
      `Phase 8 ${input.benchmarkKind} requires at least ${minimumRepeats} repeats per case`,
    );
  }
  if (input.cases.length !== 5) {
    throw new Error("Phase 8 candidate benchmark requires exactly 5 published cases");
  }
  const publicCaseIds = new Set<string>();
  for (const { casePackage, validation } of input.cases) {
    if (casePackage.packageStatus !== "published") {
      throw new Error("Phase 8 candidate benchmark accepts published cases only");
    }
    if (publicCaseIds.has(casePackage.publicCaseId)) {
      throw new Error("Phase 8 candidate benchmark requires unique published cases");
    }
    publicCaseIds.add(casePackage.publicCaseId);
    const contentHash = casePackage.provenance.contentHash;
    if (
      contentHash === undefined ||
      computeCaseContentHash(casePackage) !== contentHash
    ) {
      throw new Error("Phase 8 published case canonical content hash drifted");
    }
    assertPhase8CaseValidation(validation, {
      caseId: casePackage.internalCaseId,
      caseVersion: casePackage.caseVersion,
      contentHash,
    });
  }
  assertBindings(input.bindings);
}

function totalCallDuration(report: ProviderLiveEvalReport): number {
  return report.calls.reduce((sum, call) => sum + call.durationMs, 0);
}

function assertReportBinding(
  report: ProviderLiveEvalReport,
  casePackage: CasePackage,
): void {
  if (
    report.referenceStatus !== "published_case" ||
    report.sessionPhase !== "completed" ||
    report.caseId !== casePackage.publicCaseId ||
    report.caseVersion !== casePackage.caseVersion
  ) {
    throw new Error("Phase 8 live report does not match its published case binding");
  }
  if (
    report.providerManifest.protocol.length === 0 ||
    !HEX_SHA256_PATTERN.test(report.providerManifest.endpointSha256)
  ) {
    throw new Error("Phase 8 live report Provider manifest is invalid");
  }
}

class Phase8ProviderIdentityDriftError extends Error {}

export async function runPhase8CandidateBenchmark(input: {
  benchmarkKind: Phase8BenchmarkKind;
  repeatCount: number;
  cases: readonly Phase8CandidateCase[];
  bindings: Phase8CandidateBenchmarkBindings;
  evaluate: (
    casePackage: CasePackage,
    runNumber: number,
  ) => Promise<ProviderLiveEvalReport>;
  generatedAt?: string;
}): Promise<Phase8CandidateBenchmarkReport> {
  assertCandidateInputs(input);
  const runs: Phase8CandidateRunSummary[] = [];
  let providerIdentity:
    | {
        providerName: string;
        protocol: string;
        endpointSha256: string;
        configuredModelId: string;
        actualModelId: string;
        promptVersion: string;
      }
    | undefined;

  for (const { casePackage } of input.cases) {
    for (let runNumber = 1; runNumber <= input.repeatCount; runNumber += 1) {
      const runId = `${casePackage.publicCaseId}.run-${runNumber}`;
      try {
        const report = await input.evaluate(casePackage, runNumber);
        assertReportBinding(report, casePackage);
        const currentIdentity = {
          providerName: report.providerName,
          protocol: report.providerManifest.protocol,
          endpointSha256: report.providerManifest.endpointSha256,
          configuredModelId: report.modelId,
          actualModelId: report.actualModelId,
          promptVersion: report.promptVersion,
        };
        if (providerIdentity === undefined) {
          providerIdentity = currentIdentity;
        } else if (
          providerIdentity.providerName !== currentIdentity.providerName ||
          providerIdentity.protocol !== currentIdentity.protocol ||
          providerIdentity.endpointSha256 !== currentIdentity.endpointSha256 ||
          providerIdentity.configuredModelId !== currentIdentity.configuredModelId ||
          providerIdentity.actualModelId !== currentIdentity.actualModelId ||
          providerIdentity.promptVersion !== currentIdentity.promptVersion
        ) {
          throw new Phase8ProviderIdentityDriftError(
            "Phase 8 candidate benchmark requires one stable actual model ID and Provider identity",
          );
        }
        runs.push({
          runId,
          publicCaseId: casePackage.publicCaseId,
          caseVersion: casePackage.caseVersion,
          contentHash: casePackage.provenance.contentHash!,
          runNumber,
          status: "completed",
          benchmarkFingerprint: report.benchmarkFingerprint,
          actualModelId: report.actualModelId,
          totalScore: report.scores.total,
          callCount: report.callCount,
          controllerFactRouting: {
            evaluatedTurns: report.controllerFactRouting.evaluatedTurns,
            matchedTurns: report.controllerFactRouting.matchedTurns,
          },
          durationMs: totalCallDuration(report),
          usage: structuredClone(report.totalUsage),
        });
      } catch (error) {
        if (error instanceof Phase8ProviderIdentityDriftError) throw error;
        runs.push({
          runId,
          publicCaseId: casePackage.publicCaseId,
          caseVersion: casePackage.caseVersion,
          contentHash: casePackage.provenance.contentHash!,
          runNumber,
          status: "failed",
          failureCode: "EVALUATION_FAILED",
        });
      }
    }
  }

  const completed = runs.filter(
    (run): run is Phase8CandidateRunSummary & {
      status: "completed";
      actualModelId: string;
      totalScore: number;
      durationMs: number;
      usage: NonNullable<Phase8CandidateRunSummary["usage"]>;
      controllerFactRouting: NonNullable<
        Phase8CandidateRunSummary["controllerFactRouting"]
      >;
    } => run.status === "completed",
  );
  if (completed.length === 0) {
    throw new Error("Phase 8 candidate benchmark produced no completed live runs");
  }
  const actualModelIds = new Set(completed.map(({ actualModelId }) => actualModelId));
  if (actualModelIds.size !== 1) {
    throw new Error("Phase 8 candidate benchmark requires one stable actual model ID");
  }
  if (providerIdentity === undefined) {
    throw new Error("Phase 8 candidate benchmark produced no Provider identity");
  }

  for (const run of completed) {
    if (run.actualModelId !== providerIdentity.actualModelId) {
      throw new Error("Phase 8 candidate benchmark requires one stable actual model ID");
    }
  }
  const totalUsage = completed.reduce(
    (aggregate, run) => ({
      inputTokens: aggregate.inputTokens + run.usage.inputTokens,
      outputTokens: aggregate.outputTokens + run.usage.outputTokens,
      totalTokens: aggregate.totalTokens + run.usage.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  const durations = completed.map(({ durationMs }) => durationMs);
  const totalScores = completed.map(({ totalScore }) => totalScore);
  const completedRate = completed.length / runs.length;
  const routingTotals = completed.reduce(
    (total, run) => ({
      evaluatedTurns:
        total.evaluatedTurns + run.controllerFactRouting.evaluatedTurns,
      matchedTurns: total.matchedTurns + run.controllerFactRouting.matchedTurns,
    }),
    { evaluatedTurns: 0, matchedTurns: 0 },
  );
  const controllerFactRoutingAccuracy = routingTotals.evaluatedTurns === 0
    ? 0
    : routingTotals.matchedTurns / routingTotals.evaluatedTurns;
  const blockers: string[] = [];
  if (completedRate < 0.95) blockers.push("LIVE_OPERATION_SUCCESS_RATE_BELOW_95_PERCENT");
  if (controllerFactRoutingAccuracy < 0.95) {
    blockers.push("CONTROLLER_FACT_ROUTING_ACCURACY_BELOW_95_PERCENT");
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Phase 8 candidate benchmark generatedAt is invalid");
  }

  return {
    schemaVersion: "phase8-candidate-benchmark-v1",
    benchmarkKind: input.benchmarkKind,
    evidenceStatus: "live_provider_evidence",
    generatedAt,
    repeatCount: input.repeatCount,
    caseCount: input.cases.length,
    runCount: runs.length,
    completedRuns: completed.length,
    failedRuns: runs.length - completed.length,
    ...providerIdentity,
    bindings: structuredClone(input.bindings),
    runSetSha256: sha256Canonical(runs),
    totalUsage,
    latency: {
      totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
      averageDurationMs: Math.round(
        durations.reduce((sum, duration) => sum + duration, 0) /
          durations.length,
      ),
      maximumDurationMs: Math.max(...durations),
    },
    quality: {
      averageTotalScore: Math.round(
        totalScores.reduce((sum, score) => sum + score, 0) / totalScores.length,
      ),
      minimumTotalScore: Math.min(...totalScores),
      maximumTotalScore: Math.max(...totalScores),
      controllerFactRoutingAccuracy,
    },
    gate: {
      status: blockers.length === 0 ? "passed" : "failed",
      requiredCompletedRate: 0.95,
      completedRate,
      blockers,
    },
    runs,
  };
}
