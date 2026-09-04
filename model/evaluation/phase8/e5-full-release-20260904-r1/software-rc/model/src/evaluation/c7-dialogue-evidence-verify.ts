import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSupportedCasePackages } from "../cli/case-loader.js";
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import type { SupportedCasePackage } from "../domain/case-package.js";
import {
  buildPromptSetVersion,
  FilePromptRegistry,
} from "../prompts/prompt-registry.js";
import {
  listC7CaseManifestBindings,
} from "../release/c7-case-release.js";
import {
  reconstructC7DialogueEvidence,
  type C7ProviderIdentity,
  type C7RuntimeReleaseEvidence,
} from "../release/c7-runtime-release.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  buildC7DialogueArchitectureReport,
  toC7DialogueReleasePolicy,
  type C7DialogueArchitectureReport,
} from "./c7-dialogue-architecture-benchmark.js";
import { verifyCaseAiCrossReviewIndex } from "./case-ai-cross-review-verify.js";
import {
  isPhase8FactGroundingExempt,
  type Phase8PatientReplySampleV1,
  type Phase8PatientSampleAiValidationV1,
} from "./phase8-ai-evidence.js";

interface AiEvidenceIndex {
  schemaVersion: "phase8-ai-evidence-index-v1";
  supersededInputExcluded: true;
  provider: Omit<C7ProviderIdentity, "actualModelId"> & { actualModelId?: string };
  sourceCandidateManifest: { path: string; sha256: string };
  caseManifest: { path: string; sha256: string };
  caseValidations: C7RuntimeReleaseEvidence["aiIndex"]["caseValidations"];
  caseValidationSetSha256: string;
  publishedArtifacts: C7RuntimeReleaseEvidence["aiIndex"]["publishedArtifacts"];
  reviewPolicy: "non_blocking";
  reviewFindings: Array<{ code: string; scope: string; decision: string }>;
}

type DialogueJourney = C7RuntimeReleaseEvidence["dialogueJourneys"][number];
type DialogueSampleSet = C7RuntimeReleaseEvidence["dialogueSampleSet"];
type DialogueApproval = C7RuntimeReleaseEvidence["dialogueApproval"];
type DialogueApprovalDecision = "approved" | "revision_recommended" | "rejected";
type DialogueReportArtifact = C7DialogueArchitectureReport & {
  evidenceStatus: "live_provider_evidence";
  runSetSha256: string;
  provider: C7ProviderIdentity;
  bindings: {
    aiEvidenceIndexSha256: string;
    caseManifestSha256: string;
    caseValidationSetSha256: string;
    patientPromptSha256: string;
    shareContractSha256: string;
    dialogueAuditSha256: string;
  };
  upstreamReviewPolicy: "non_blocking";
  upstreamReviewFindings: unknown[];
};

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function resolveInside(rootDirectory: string, requestedPath: string, label: string): string {
  if (
    isAbsolute(requestedPath) || requestedPath.includes("\\") ||
    requestedPath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a portable relative path.`);
  }
  const root = realpathSync(rootDirectory);
  const candidate = resolve(root, ...requestedPath.split("/"));
  const lexicalRelative = relative(root, candidate);
  if (
    lexicalRelative === "" || lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative) ||
    !existsSync(candidate)
  ) {
    throw new Error(`${label} must stay inside its declared root and exist.`);
  }
  const actual = realpathSync(candidate);
  const actualRelative = relative(root, actual);
  if (
    actualRelative === "" || actualRelative === ".." ||
    actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)
  ) {
    throw new Error(`${label} realpath escapes its declared root.`);
  }
  return actual;
}

function requireFile(rootDirectory: string, requestedPath: string, label: string): string {
  const path = resolveInside(rootDirectory, requestedPath, label);
  if (!statSync(path).isFile()) throw new Error(`${label} must be a regular file.`);
  return path;
}

function requireDirectory(rootDirectory: string, requestedPath: string, label: string): string {
  const path = resolveInside(rootDirectory, requestedPath, label);
  if (!statSync(path).isDirectory()) throw new Error(`${label} must be a directory.`);
  return path;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isExactIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function sameProvider(left: C7ProviderIdentity, right: C7ProviderIdentity): boolean {
  return left.providerName === right.providerName &&
    left.protocol === right.protocol &&
    left.endpointSha256 === right.endpointSha256 &&
    left.configuredModelId === right.configuredModelId &&
    left.actualModelId === right.actualModelId;
}

function sameProviderIncludingPrompt(
  left: C7ProviderIdentity,
  right: C7ProviderIdentity,
): boolean {
  return sameProvider(left, right) && left.promptVersion === right.promptVersion;
}

export function isC7DialogueProviderCompatible(
  observed: C7ProviderIdentity,
  upstream: AiEvidenceIndex["provider"],
): boolean {
  return observed.providerName === upstream.providerName &&
    observed.protocol === upstream.protocol &&
    observed.endpointSha256 === upstream.endpointSha256 &&
    observed.configuredModelId === upstream.configuredModelId &&
    (observed.actualModelId === undefined ||
      upstream.actualModelId === undefined ||
      observed.actualModelId === upstream.actualModelId);
}

function verifyPatientAudit(
  audit: Phase8PatientSampleAiValidationV1,
  samples: readonly Phase8PatientReplySampleV1[],
  runSetSha256: string,
  configuredModelId: string,
  actualModelId: string | undefined,
  minimumSamples: number,
): void {
  const sampleIds = new Set(samples.map(({ sampleId }) => sampleId));
  const sortedSampleIds = [...sampleIds].sort();
  const samplesById = new Map(samples.map((sample) => [sample.sampleId, sample] as const));
  const roles = new Set(audit.validations.map(({ role }) => role));
  const validationRunIds = new Set(
    audit.validations.map(({ validationRunId }) => validationRunId),
  );
  const providerRequestIds = audit.validations.flatMap(
    ({ providerRequestIds: requestIds }) => requestIds,
  );
  if (
    audit.schemaVersion !== "phase8-patient-sample-ai-validation-v1" ||
    audit.candidateRunSetSha256 !== runSetSha256 ||
    audit.sampleSetSha256 !== sha256Canonical(samples) ||
    audit.sampleCount !== samples.length ||
    sampleIds.size !== samples.length ||
    audit.validations.length !== 2 || roles.size !== 2 ||
    validationRunIds.size !== 2 ||
    new Set(providerRequestIds).size !== providerRequestIds.length ||
    !roles.has("fact_safety_auditor") || !roles.has("language_role_auditor")
  ) {
    throw new Error("C7 dialogue AI audit header or coverage drifted.");
  }
  const derivedDecisions: Array<"approved" | "rejected" | "not_run"> = [];
  for (const validation of audit.validations) {
    const assessmentIds = validation.assessments.map(({ sampleId }) => sampleId);
    const uniqueAssessmentIds = new Set(assessmentIds);
    const invalidAssessmentTypes = validation.assessments.some((assessment) =>
      typeof assessment.sampleId !== "string" ||
      typeof assessment.factGrounded !== "boolean" ||
      typeof assessment.unauthorizedFactLeak !== "boolean" ||
      typeof assessment.diagnosisLeak !== "boolean" ||
      typeof assessment.unknownAsAbsent !== "boolean" ||
      typeof assessment.naturalChinese !== "boolean" ||
      typeof assessment.roleConsistent !== "boolean" ||
      typeof assessment.seriousError !== "boolean" ||
      typeof assessment.notes !== "string"
    );
    const factGroundingErrors = validation.role === "fact_safety_auditor"
      ? validation.assessments.filter(({ sampleId, factGrounded }) =>
        !factGrounded &&
        samplesById.has(sampleId) &&
        !isPhase8FactGroundingExempt(samplesById.get(sampleId)!))
      : [];
    const seriousErrors = validation.assessments.filter(({ seriousError }) => seriousError).length +
      factGroundingErrors.filter(({ seriousError }) => !seriousError).length;
    const unauthorizedFactLeaks = validation.assessments.filter(
      ({ unauthorizedFactLeak }) => unauthorizedFactLeak,
    ).length;
    const diagnosisLeaks = validation.assessments.filter(({ diagnosisLeak }) => diagnosisLeak).length;
    const unknownAsAbsentErrors = validation.assessments.filter(
      ({ unknownAsAbsent }) => unknownAsAbsent,
    ).length;
    const naturalAndRoleConsistent = validation.assessments.filter(
      ({ naturalChinese, roleConsistent }) => naturalChinese && roleConsistent,
    ).length;
    const expectedValidatorId = validation.role === "fact_safety_auditor"
      ? "validator.ai.patient-fact-safety.v1"
      : "validator.ai.patient-language-role.v1";
    const expectedPromptVersion = validation.role === "fact_safety_auditor"
      ? "patient-fact-safety-auditor-v2"
      : "patient-language-role-auditor-v2";
    const expectedDecision = seriousErrors === 0 &&
        unauthorizedFactLeaks === 0 &&
        diagnosisLeaks === 0 &&
        unknownAsAbsentErrors === 0 &&
        (validation.role !== "language_role_auditor" ||
          naturalAndRoleConsistent / samples.length >= 0.95)
      ? "approved"
      : "rejected";
    const runStatus = validation.runStatus ?? "completed";
    const failedToRun = runStatus === "failed_to_run";
    const receivedProviderResponse = !failedToRun || validation.subcallCount > 0;
    if (
      validation.validatorId !== expectedValidatorId ||
      validation.modelId !== (
        receivedProviderResponse ? actualModelId : configuredModelId
      ) ||
      (receivedProviderResponse && actualModelId === undefined) ||
      validation.promptVersion !== expectedPromptVersion ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(validation.validationRunId) ||
      !isExactIsoDate(validation.validatedAt) ||
      validation.isolation.independentInvocation !== true ||
      validation.isolation.counterpartOutputVisible !== false ||
      validation.assessedSamples !== validation.assessments.length ||
      validation.assessedSamples > samples.length ||
      invalidAssessmentTypes ||
      uniqueAssessmentIds.size !== validation.assessments.length ||
      [...uniqueAssessmentIds].some((sampleId) => !sampleIds.has(sampleId)) ||
      !Number.isInteger(validation.subcallCount) || validation.subcallCount < 0 ||
      !Array.isArray(validation.providerRequestIds) ||
      validation.providerRequestIds.length > validation.subcallCount ||
      new Set(validation.providerRequestIds).size !== validation.providerRequestIds.length ||
      validation.providerRequestIds.some((requestId) =>
        typeof requestId !== "string" || requestId.length === 0) ||
      !Number.isInteger(validation.usage.inputTokens) || validation.usage.inputTokens < 0 ||
      !Number.isInteger(validation.usage.outputTokens) || validation.usage.outputTokens < 0 ||
      validation.usage.totalTokens !==
        validation.usage.inputTokens + validation.usage.outputTokens ||
      validation.seriousErrors !== seriousErrors ||
      validation.unauthorizedFactLeaks !== unauthorizedFactLeaks ||
      validation.diagnosisLeaks !== diagnosisLeaks ||
      validation.unknownAsAbsentErrors !== unknownAsAbsentErrors ||
      validation.naturalAndRoleConsistent !== naturalAndRoleConsistent
    ) {
      throw new Error(`C7 dialogue AI audit validation drifted: ${validation.role}`);
    }
    if (failedToRun) {
      const insufficientSamples =
        validation.failureCode === "INSUFFICIENT_PATIENT_SAMPLES";
      if (
        validation.decision !== "not_run" ||
        (insufficientSamples
          ? validation.assessedSamples !== 0 ||
            validation.subcallCount !== 0 ||
            validation.assessments.length !== 0 ||
            samples.length >= minimumSamples
          : validation.assessedSamples >= samples.length) ||
        typeof validation.failureCode !== "string" ||
        validation.failureCode.trim().length === 0
      ) {
        throw new Error(`C7 dialogue failed audit evidence drifted: ${validation.role}`);
      }
      derivedDecisions.push("not_run");
      continue;
    }
    if (
      runStatus !== "completed" ||
      validation.failureCode !== undefined ||
      validation.assessedSamples !== samples.length ||
      JSON.stringify([...uniqueAssessmentIds].sort()) !== JSON.stringify(sortedSampleIds) ||
      validation.subcallCount < 1 ||
      validation.decision !== expectedDecision
    ) {
      throw new Error(`C7 dialogue completed audit evidence drifted: ${validation.role}`);
    }
    derivedDecisions.push(expectedDecision);
  }
  const language = audit.validations.find(({ role }) => role === "language_role_auditor")!;
  const expectedDecision = derivedDecisions.some((decision) => decision === "not_run")
    ? "not_run"
    : derivedDecisions.every((decision) => decision === "approved")
      ? "approved"
      : "rejected";
  if (
    audit.factOrSafetySeriousErrors !== audit.validations.reduce(
      (sum, validation) => sum + validation.seriousErrors,
      0,
    ) ||
    audit.naturalAndRoleConsistentRate !==
      (samples.length === 0
        ? 0
        : language.naturalAndRoleConsistent / samples.length) ||
    audit.decision !== expectedDecision
  ) {
    throw new Error("C7 dialogue AI audit aggregate metrics drifted.");
  }
}

export function verifyC7DialogueEvidenceDirectory(input: {
  modelRoot: string;
  dialogueEvidenceDirectory: string;
  logicalDialogueEvidenceDirectory?: string;
  aiEvidenceDirectory: string;
}): {
  caseCount: number;
  committedTurns: number;
  auditDecision: "approved" | "rejected" | "not_run";
  approvalDecision: DialogueApprovalDecision;
  status: "passed" | "reported_with_findings";
  provider: C7ProviderIdentity;
  journeyPaths: string[];
} {
  const modelRoot = realpathSync(input.modelRoot);
  const dialogueDirectory = requireDirectory(
    modelRoot,
    input.dialogueEvidenceDirectory,
    "C7 dialogue evidence directory",
  );
  const aiDirectory = requireDirectory(
    modelRoot,
    input.aiEvidenceDirectory,
    "C7 AI evidence directory",
  );
  const logicalDialogueDirectory = input.logicalDialogueEvidenceDirectory ??
    input.dialogueEvidenceDirectory;
  if (
    isAbsolute(logicalDialogueDirectory) ||
    logicalDialogueDirectory.includes("\\") ||
    logicalDialogueDirectory.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("C7 logical dialogue evidence path must be portable and relative.");
  }
  const aiIndexPath = resolve(aiDirectory, "ai-evidence-index.json");
  verifyCaseAiCrossReviewIndex({ modelRoot, indexPath: aiIndexPath });
  const aiIndex = readJson<AiEvidenceIndex>(aiIndexPath);
  if (
    aiIndex.schemaVersion !== "phase8-ai-evidence-index-v1" ||
    aiIndex.supersededInputExcluded !== true ||
    sha256Canonical(aiIndex.caseValidations) !== aiIndex.caseValidationSetSha256
  ) {
    throw new Error("C7 AI evidence index is invalid or drifted.");
  }

  const sourceManifestPath = requireFile(
    modelRoot,
    aiIndex.sourceCandidateManifest.path,
    "C7 source manifest",
  );
  if (sha256File(sourceManifestPath) !== aiIndex.sourceCandidateManifest.sha256) {
    throw new Error("C7 source manifest hash drifted.");
  }
  const contentManifest = loadCaseManifestV2(sourceManifestPath);
  const releasePolicy = toC7DialogueReleasePolicy(contentManifest.releasePolicy);
  const releaseManifestPath = requireFile(
    modelRoot,
    aiIndex.caseManifest.path,
    "C7 release manifest",
  );
  if (sha256File(releaseManifestPath) !== aiIndex.caseManifest.sha256) {
    throw new Error("C7 release manifest hash drifted.");
  }
  const caseBindings = listC7CaseManifestBindings(readJson<unknown>(releaseManifestPath));
  if (caseBindings.length !== releasePolicy.expectedCaseCount) {
    throw new Error("C7 dialogue release manifest case coverage drifted.");
  }
  const casesRoot = resolve(modelRoot, "cases");
  const casePackages = loadSupportedCasePackages(
    caseBindings.map(({ path }) => requireFile(casesRoot, path, "C7 released case")),
  );

  const physicalJourneyPaths = caseBindings.map(({ publicCaseId }) =>
    `${input.dialogueEvidenceDirectory}/private/journeys/${publicCaseId}.json`);
  const journeys = physicalJourneyPaths.map((path) =>
    readJson<DialogueJourney>(requireFile(modelRoot, path, "C7 dialogue journey")));
  const reconstructed = reconstructC7DialogueEvidence({
    casePackages: casePackages as SupportedCasePackage[],
    caseBindings,
    journeys,
    policy: releasePolicy,
  });
  const reportPath = resolve(dialogueDirectory, "c7-dialogue-architecture-report.json");
  const auditPath = resolve(dialogueDirectory, "dialogue-sample-ai-validation.json");
  const sampleSetPath = resolve(dialogueDirectory, "private", "patient-samples.v1.json");
  const approvalPath = resolve(dialogueDirectory, "provider-model-approval.json");
  for (const [path, label] of [
    [reportPath, "C7 dialogue report"],
    [auditPath, "C7 dialogue audit"],
    [sampleSetPath, "C7 dialogue private sample set"],
    [approvalPath, "C7 dialogue approval"],
  ] as const) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} is missing.`);
  }
  const report = readJson<DialogueReportArtifact>(reportPath);
  const audit = readJson<Phase8PatientSampleAiValidationV1>(auditPath);
  const sampleSet = readJson<DialogueSampleSet>(sampleSetPath);
  const approval = readJson<DialogueApproval>(approvalPath);
  const runSetSha256 = sha256Canonical(reconstructed.runs);
  const sampleSetSha256 = sha256Canonical(reconstructed.samples);
  if (
    report.evidenceStatus !== "live_provider_evidence" ||
    !isExactIsoDate(report.generatedAt) ||
    report.runSetSha256 !== runSetSha256 ||
    sampleSet.schemaVersion !== "c7-private-patient-sample-set-v1" ||
    sampleSet.runSetSha256 !== runSetSha256 ||
    sampleSet.sampleSetSha256 !== sampleSetSha256 ||
    sampleSet.sampleCount !== reconstructed.samples.length ||
    sha256Canonical(sampleSet.samples) !== sampleSetSha256
  ) {
    throw new Error("C7 dialogue run or private sample set hash drifted.");
  }
  verifyPatientAudit(
    audit,
    reconstructed.samples,
    runSetSha256,
    aiIndex.provider.configuredModelId,
    report.provider.actualModelId,
    releasePolicy.expectedCaseCount *
      releasePolicy.minimumRealDialogueTurnsPerCase,
  );
  const rebuiltReport = buildC7DialogueArchitectureReport({
    runs: reconstructed.runs,
    policy: releasePolicy,
    generatedAt: report.generatedAt,
    audit: {
      decision: audit.decision,
      personaConsistencyRate: audit.naturalAndRoleConsistentRate,
      seriousFactErrors: audit.factOrSafetySeriousErrors,
      diagnosisLeaks: Math.max(...audit.validations.map(({ diagnosisLeaks }) => diagnosisLeaks)),
      uncompletedTestResultLeaks: reconstructed.runs.reduce(
        (sum, run) => sum + run.uncompletedTestResultLeaks,
        0,
      ),
    },
  });
  const {
    evidenceStatus: _evidenceStatus,
    runSetSha256: _runSetSha256,
    provider: _provider,
    bindings: _bindings,
    upstreamReviewPolicy: _upstreamReviewPolicy,
    upstreamReviewFindings: _upstreamReviewFindings,
    ...reportCore
  } = report;
  if (sha256Canonical(reportCore) !== sha256Canonical(rebuiltReport)) {
    throw new Error("C7 dialogue report is inconsistent with private journeys and AI audit.");
  }
  const expectedPromptPath = requireFile(
    modelRoot,
    `prompts/patient/${contentManifest.patientPromptVersion}.md`,
    "C7 patient prompt",
  );
  const promptRegistry = new FilePromptRegistry(requireDirectory(
    modelRoot,
    "prompts",
    "C7 prompt registry",
  ));
  const expectedPromptVersion = buildPromptSetVersion(
    contentManifest.patientPromptVersion,
    {
      controller: promptRegistry.load("controller", contentManifest.patientPromptVersion),
      patient: promptRegistry.load("patient", contentManifest.patientPromptVersion),
      review: promptRegistry.load("review", contentManifest.patientPromptVersion),
    },
  );
  const shareContractPath = requireFile(
    resolve(modelRoot, "..", "share"),
    "versions/contract-v1-rc2.json",
    "C7 share contract",
  );
  const expectedApprovalDecision: DialogueApprovalDecision =
    rebuiltReport.findings.length === 0 ? "approved" : "revision_recommended";
  const expectedReportPath = `${logicalDialogueDirectory}/c7-dialogue-architecture-report.json`;
  const expectedAuditPath = `${logicalDialogueDirectory}/dialogue-sample-ai-validation.json`;
  const bindingDrift = [
    ["provider", isC7DialogueProviderCompatible(report.provider, aiIndex.provider)],
    ["prompt", report.provider.promptVersion === expectedPromptVersion],
    ["ai-index-hash", report.bindings.aiEvidenceIndexSha256 === sha256File(aiIndexPath)],
    ["case-manifest-hash", report.bindings.caseManifestSha256 === aiIndex.caseManifest.sha256],
    ["case-validation-set-hash", report.bindings.caseValidationSetSha256 === aiIndex.caseValidationSetSha256],
    ["patient-prompt-hash", report.bindings.patientPromptSha256 === sha256File(expectedPromptPath)],
    ["share-contract-hash", report.bindings.shareContractSha256 === sha256File(shareContractPath)],
    ["dialogue-audit-hash", report.bindings.dialogueAuditSha256 === sha256File(auditPath)],
    ["upstream-review-policy", report.upstreamReviewPolicy === aiIndex.reviewPolicy],
    ["upstream-review-findings", sha256Canonical(report.upstreamReviewFindings) === sha256Canonical(aiIndex.reviewFindings)],
    ["approval-schema", approval.schemaVersion === "c7-provider-model-approval-v1"],
    ["approval-decision-enum", ["approved", "revision_recommended", "rejected"].includes(approval.decision)],
    ["approval-decision", approval.decision === expectedApprovalDecision],
    ["approval-decision-ref", approval.decisionRef === "c7.dialogue-architecture.2026-08-28"],
    ["approval-date", isExactIsoDate(approval.decidedAt)],
    ["approval-provider", sameProviderIncludingPrompt(approval.provider, report.provider)],
    ["approval-report-path", approval.report.path === expectedReportPath],
    ["approval-audit-path", approval.audit.path === expectedAuditPath],
    ["approval-report-hash", approval.report.sha256 === sha256File(reportPath)],
    ["approval-audit-hash", approval.audit.sha256 === sha256File(auditPath)],
  ] satisfies Array<readonly [string, boolean]>;
  const failedBindings = bindingDrift
    .filter(([, matches]) => !matches)
    .map(([name]) => name);
  if (failedBindings.length > 0) {
    throw new Error(
      `C7 dialogue provider, source, or approval binding drifted: ${failedBindings.join(", ")}.`,
    );
  }
  return {
    caseCount: reconstructed.runs.length,
    committedTurns: reconstructed.runs.reduce((sum, run) => sum + run.committedTurns, 0),
    auditDecision: audit.decision,
    approvalDecision: approval.decision as DialogueApprovalDecision,
    status: rebuiltReport.findings.length === 0 && approval.decision === "approved"
      ? "passed"
      : "reported_with_findings",
    provider: report.provider,
    journeyPaths: caseBindings.map(({ publicCaseId }) =>
      `${logicalDialogueDirectory}/private/journeys/${publicCaseId}.json`),
  };
}

function main(): void {
  try {
    const values = new Map<string, string>();
    const argv = process.argv.slice(2);
    for (let index = 0; index < argv.length; index += 2) {
      const key = argv[index];
      const value = argv[index + 1];
      if (
        key === undefined || value === undefined ||
        !["--evidence", "--ai-evidence"].includes(key) || values.has(key)
      ) {
        throw new Error("Usage: c7-dialogue-evidence-verify --evidence <dir> --ai-evidence <dir>");
      }
      values.set(key, value);
    }
    const dialogueEvidenceDirectory = values.get("--evidence");
    const aiEvidenceDirectory = values.get("--ai-evidence");
    if (dialogueEvidenceDirectory === undefined || aiEvidenceDirectory === undefined) {
      throw new Error("Both --evidence and --ai-evidence are required.");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const result = verifyC7DialogueEvidenceDirectory({
      modelRoot,
      dialogueEvidenceDirectory,
      aiEvidenceDirectory,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `C7 dialogue evidence verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
