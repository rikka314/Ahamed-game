import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { loadSupportedCasePackages } from "../cli/case-loader.js";
import { loadPhase6CaseBundles } from "../cases/phase6-case-production.js";
import {
  loadCaseManifestV2,
  resolveCaseManifestArtifactPath,
  type CaseManifestPackageStatus,
  type CaseManifestReleasePolicy,
  type CaseManifestReviewStatus,
} from "../cases/case-manifest.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  assertAiCaseCrossReviewV3,
  assertSupportedCasePackage,
  type AiCaseCrossReviewV3,
  type SupportedCasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import {
  buildC7ReportedCaseManifest,
  listC7CaseManifestBindings,
} from "../release/c7-case-release.js";
import {
  assertC7SafetyCorpusEvidence,
  type C7ProviderIdentity,
} from "../release/c7-runtime-release.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  MEDICAL_SAFETY_POLICY_VERSION_V1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import {
  verifyCaseReviewEvidence,
  type CaseReviewEvidenceV1,
} from "./case-ai-cross-review-evidence.js";
import {
  PHASE7_SAFETY_CORPUS_VERSION_V1,
  PHASE7_SAFETY_CORPUS_V1,
} from "./phase7-safety-corpus.js";
import type { Phase8SafetyCorpusAiValidationV1 } from "./phase8-ai-evidence.js";
import { buildPhase8CaseAuditRequestDefinition } from "./phase8-ai-evidence.js";

interface ArtifactBinding {
  path: string;
  sha256: string;
}

interface CaseValidationBinding extends ArtifactBinding {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
}

interface PublishedArtifactBinding {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  casePackageSchemaVersion: "case-package-v2-rc1";
  packageStatus: CaseManifestPackageStatus;
  reviewStatus: CaseManifestReviewStatus;
  findings: string[];
  path: string;
  validationRecordPath: string;
  caseSha256: string;
  validationSha256: string;
}

interface ReviewFinding {
  code: "CASE_AI_REVIEW_NOT_APPROVED" | "SAFETY_AI_REVIEW_NOT_APPROVED";
  scope: string;
  decision: string;
}

interface SafetyCorpusBinding extends ArtifactBinding {
  datasetVersion: string;
  corpusHash: string;
  holdoutHash: string;
  totalSamples: number;
  holdoutSamples: number;
  policyVersion: string;
  templateRegistryHash: string;
}

export interface CaseReviewIndex {
  schemaVersion: "phase8-ai-evidence-index-v1";
  evidenceStatus: "independent_ai_cross_validation";
  generatedAt: string;
  provider: Omit<C7ProviderIdentity, "actualModelId"> & { actualModelId?: string };
  supersededInputExcluded: true;
  reviewPolicy: "non_blocking";
  reviewFindings: ReviewFinding[];
  releasePolicy: CaseManifestReleasePolicy;
  sourceCandidateManifest: ArtifactBinding;
  caseManifest: ArtifactBinding;
  caseValidations: CaseValidationBinding[];
  caseValidationSetSha256: string;
  caseReviewEvidence: CaseReviewEvidenceV1;
  publishedArtifacts: PublishedArtifactBinding[];
  safetyCorpus: SafetyCorpusBinding;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (sha256Canonical(actual) !== sha256Canonical(expected)) {
    throw new Error(`${label} fields drifted`);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function resolveModelArtifact(modelRoot: string, artifactPath: string): string {
  if (
    isAbsolute(artifactPath) || artifactPath.includes("\\") ||
    artifactPath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("case review artifact path must be portable and relative");
  }
  const root = realpathSync(modelRoot);
  const candidate = resolve(root, ...artifactPath.split("/"));
  const lexical = relative(root, candidate);
  if (
    lexical === "" || lexical === ".." || lexical.startsWith(`..${sep}`) ||
    isAbsolute(lexical)
  ) {
    throw new Error("case review artifact path escapes the model root");
  }
  const actual = realpathSync(candidate);
  const actualRelative = relative(root, actual);
  if (
    actualRelative === "" || actualRelative === ".." ||
    actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative) ||
    !statSync(actual).isFile()
  ) {
    throw new Error("case review artifact realpath escapes the model root");
  }
  return actual;
}

function assertFileInside(directory: string, path: string, label: string): void {
  const root = realpathSync(directory);
  const actual = realpathSync(path);
  const relativePath = relative(root, actual);
  if (
    relativePath === "" || relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside its evidence directory`);
  }
}

function assertProvider(
  provider: Omit<C7ProviderIdentity, "actualModelId"> & { actualModelId?: string },
): void {
  if (
    typeof provider.providerName !== "string" || provider.providerName.length === 0 ||
    provider.protocol !== "openai-responses" ||
    !SHA256_PATTERN.test(provider.endpointSha256) ||
    typeof provider.configuredModelId !== "string" || provider.configuredModelId.length === 0 ||
    (provider.actualModelId !== undefined &&
      (typeof provider.actualModelId !== "string" || provider.actualModelId.length === 0))
  ) {
    throw new Error("case review provider identity is invalid");
  }
}

function assertReviewMatchesProvider(
  review: AiCaseCrossReviewV3,
  provider: Omit<C7ProviderIdentity, "actualModelId"> & { actualModelId?: string },
): void {
  const roles = new Set(review.validations.map(({ role }) => role));
  const identityDrifted = review.validations.some((validation) => {
    const expectedValidatorId = validation.role === "clinical_safety"
      ? "validator.ai.clinical-safety.v3"
      : "validator.ai.diagnostic-quality.v3";
    const expectedPromptVersion = validation.role === "clinical_safety"
      ? "clinical-safety-case-validation-v3"
      : "diagnostic-quality-case-validation-v3";
    return validation.validatorId !== expectedValidatorId ||
      validation.promptVersion !== expectedPromptVersion;
  });
  const isolationDrifted = review.validations.some(({ isolation }) =>
    isolation.independentInvocation !== true ||
    isolation.counterpartOutputVisible !== false);
  const completedPairDrifted = review.decision !== "not_run" && (
    review.validations.length !== 2 || roles.size !== 2 ||
    !roles.has("clinical_safety") || !roles.has("diagnostic_quality") ||
    review.validations.some(({ modelId, runStatus }) =>
      modelId !== provider.actualModelId || runStatus !== "completed")
  );
  const failedPairDrifted = review.decision === "not_run" && (
    review.validations.length !== 2 || roles.size !== 2 ||
    !roles.has("clinical_safety") || !roles.has("diagnostic_quality") ||
    !review.validations.some(({ runStatus }) => runStatus === "failed_to_run") ||
    review.validations.some(({ modelId, runStatus, decision }) =>
      runStatus === "completed"
        ? modelId !== provider.actualModelId || decision === "not_run"
        : modelId !== provider.configuredModelId ||
          runStatus !== "failed_to_run" || decision !== "not_run")
  );
  if (identityDrifted || isolationDrifted || completedPairDrifted || failedPairDrifted) {
    throw new Error(`case review model, role, or isolation drifted: ${review.caseId}`);
  }
}

function verifySafetyCorpus(input: {
  modelRoot: string;
  evidenceDirectory: string;
  binding: SafetyCorpusBinding;
  configuredModelId: string;
  actualModelId: string | undefined;
}): Phase8SafetyCorpusAiValidationV1 {
  assertExactKeys(input.binding, [
    "datasetVersion", "corpusHash", "holdoutHash", "totalSamples",
    "holdoutSamples", "policyVersion", "templateRegistryHash", "path", "sha256",
  ], "case review safety corpus binding");
  const path = resolveModelArtifact(input.modelRoot, input.binding.path);
  assertFileInside(input.evidenceDirectory, path, "case review safety artifact");
  if (sha256File(path) !== input.binding.sha256) {
    throw new Error("case review safety corpus artifact hash drifted");
  }
  const holdout = PHASE7_SAFETY_CORPUS_V1.filter(({ split }) => split === "holdout");
  const templateRegistry = Object.fromEntries(
    Object.entries(MEDICAL_SAFETY_TEMPLATES_V1).map(
      ([decision, template]) => [decision, template.templateId],
    ),
  );
  const expected = {
    configuredModelId: input.configuredModelId,
    actualModelId: input.actualModelId,
    datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
    policyVersion: MEDICAL_SAFETY_POLICY_VERSION_V1,
    corpusHash: sha256Canonical(PHASE7_SAFETY_CORPUS_V1),
    holdoutHash: sha256Canonical(holdout),
    templateRegistryHash: sha256Canonical(templateRegistry),
    totalSamples: PHASE7_SAFETY_CORPUS_V1.length,
    holdoutSamples: holdout.length,
    expectedDecisionsBySampleId: Object.fromEntries(
      PHASE7_SAFETY_CORPUS_V1.map(({ sampleId, expectedDecision }) => [
        sampleId,
        expectedDecision,
      ]),
    ),
  };
  if (
    input.binding.datasetVersion !== expected.datasetVersion ||
    input.binding.policyVersion !== expected.policyVersion ||
    input.binding.corpusHash !== expected.corpusHash ||
    input.binding.holdoutHash !== expected.holdoutHash ||
    input.binding.templateRegistryHash !== expected.templateRegistryHash ||
    input.binding.totalSamples !== expected.totalSamples ||
    input.binding.holdoutSamples !== expected.holdoutSamples
  ) {
    throw new Error("case review safety corpus source binding drifted");
  }
  const evidence = JSON.parse(readFileSync(path, "utf8")) as Phase8SafetyCorpusAiValidationV1;
  assertC7SafetyCorpusEvidence(evidence, expected);
  return evidence;
}

export function verifyCaseAiCrossReviewIndex(input: {
  modelRoot: string;
  indexPath: string;
}): ReturnType<typeof verifyCaseReviewEvidence> {
  const modelRoot = realpathSync(input.modelRoot);
  const indexPath = realpathSync(input.indexPath);
  const indexRelative = relative(modelRoot, indexPath);
  if (
    indexRelative === "" || indexRelative === ".." ||
    indexRelative.startsWith(`..${sep}`) || isAbsolute(indexRelative) ||
    !statSync(indexPath).isFile()
  ) {
    throw new Error("case review index path escapes the model root");
  }
  const rawIndex = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
  assertExactKeys(rawIndex, [
    "schemaVersion", "evidenceStatus", "generatedAt", "provider",
    "supersededInputExcluded", "reviewPolicy", "reviewFindings", "releasePolicy",
    "sourceCandidateManifest", "caseManifest", "caseValidations",
    "caseValidationSetSha256", "caseReviewEvidence", "publishedArtifacts",
    "safetyCorpus",
  ], "case review evidence index");
  const index = rawIndex as unknown as CaseReviewIndex;
  if (
    index.schemaVersion !== "phase8-ai-evidence-index-v1" ||
    index.evidenceStatus !== "independent_ai_cross_validation" ||
    Number.isNaN(Date.parse(index.generatedAt)) ||
    index.supersededInputExcluded !== true ||
    index.reviewPolicy !== "non_blocking" ||
    !Array.isArray(index.reviewFindings) || !Array.isArray(index.caseValidations) ||
    !Array.isArray(index.publishedArtifacts) ||
    !SHA256_PATTERN.test(index.caseValidationSetSha256)
  ) {
    throw new Error("case review evidence index header is invalid");
  }
  assertProvider(index.provider);
  assertExactKeys(index.provider, [
    "providerName", "protocol", "endpointSha256", "configuredModelId",
    ...(index.provider.actualModelId === undefined ? [] : ["actualModelId"]),
  ], "case review provider");
  assertExactKeys(index.sourceCandidateManifest, ["path", "sha256"], "source manifest binding");
  assertExactKeys(index.caseManifest, ["path", "sha256"], "release manifest binding");

  const evidenceDirectory = dirname(indexPath);
  const sourceManifestPath = resolveModelArtifact(
    modelRoot,
    index.sourceCandidateManifest.path,
  );
  if (sha256File(sourceManifestPath) !== index.sourceCandidateManifest.sha256) {
    throw new Error("case review source manifest hash drifted");
  }
  const sourceManifest = loadCaseManifestV2(sourceManifestPath);
  if (sha256Canonical(index.releasePolicy) !== sha256Canonical(sourceManifest.releasePolicy)) {
    throw new Error("case review release policy drifted");
  }
  if (sourceManifest.cases.length !== index.caseReviewEvidence.expectedCaseCount) {
    throw new Error("case review source manifest case count drifted");
  }
  const casesRoot = resolve(modelRoot, "cases");
  const sourceCases = loadSupportedCasePackages(
    sourceManifest.cases.map(({ path }) => resolveCaseManifestArtifactPath(casesRoot, path)),
  );
  const sourceCasesById = new Map<string, SupportedCasePackage>();
  for (const [position, casePackage] of sourceCases.entries()) {
    const binding = sourceManifest.cases[position]!;
    if (
      casePackage.publicCaseId !== binding.publicCaseId ||
      casePackage.caseVersion !== binding.caseVersion ||
      casePackage.provenance.contentHash !== binding.contentHash ||
      computeCaseContentHash(casePackage) !== binding.contentHash
    ) {
      throw new Error(`case review source case freshness drifted: ${binding.publicCaseId}`);
    }
    sourceCasesById.set(casePackage.publicCaseId, casePackage);
  }
  const phase6BundlesByPublicCaseId = new Map(
    loadPhase6CaseBundles(casesRoot).map((bundle) => [
      bundle.casePackage.publicCaseId,
      bundle,
    ] as const),
  );
  const scoringPolicySummary = readFileSync(
    resolve(modelRoot, "evaluation/scoring-policy-v1.md"),
    "utf8",
  );

  if (sha256Canonical(index.caseValidations) !== index.caseValidationSetSha256) {
    throw new Error("case review validation set hash drifted");
  }
  const validationIds = new Set<string>();
  const validationPaths = new Set<string>();
  const reviewsByPublicCaseId = new Map<string, AiCaseCrossReviewV3>();
  for (const artifact of index.caseValidations) {
    assertExactKeys(artifact, [
      "publicCaseId", "caseVersion", "contentHash", "path", "sha256",
    ], `case validation binding ${artifact.publicCaseId}`);
    if (
      validationIds.has(artifact.publicCaseId) || validationPaths.has(artifact.path) ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new Error("case review validation identity, path, or hash is invalid");
    }
    validationIds.add(artifact.publicCaseId);
    validationPaths.add(artifact.path);
    const casePackage = sourceCasesById.get(artifact.publicCaseId);
    if (
      casePackage === undefined || casePackage.caseVersion !== artifact.caseVersion ||
      casePackage.provenance.contentHash !== artifact.contentHash
    ) {
      throw new Error(`case review validation source binding drifted: ${artifact.publicCaseId}`);
    }
    const path = resolveModelArtifact(modelRoot, artifact.path);
    assertFileInside(evidenceDirectory, path, `case validation ${artifact.publicCaseId}`);
    if (sha256File(path) !== artifact.sha256) {
      throw new Error(`case review validation artifact hash drifted: ${artifact.publicCaseId}`);
    }
    const review = JSON.parse(readFileSync(path, "utf8")) as AiCaseCrossReviewV3;
    assertAiCaseCrossReviewV3(review, {
      caseId: casePackage.internalCaseId,
      caseVersion: artifact.caseVersion,
      contentHash: artifact.contentHash,
    });
    assertReviewMatchesProvider(review, index.provider);
    reviewsByPublicCaseId.set(artifact.publicCaseId, review);
  }
  if (
    validationIds.size !== sourceManifest.cases.length ||
    sourceManifest.cases.some(({ publicCaseId }) => !validationIds.has(publicCaseId))
  ) {
    throw new Error("case review validation coverage drifted");
  }

  const publishedIds = new Set<string>();
  const publishedPaths = new Set<string>();
  for (const artifact of index.publishedArtifacts) {
    assertExactKeys(artifact, [
      "publicCaseId", "caseVersion", "contentHash", "casePackageSchemaVersion",
      "packageStatus", "reviewStatus", "findings", "path", "validationRecordPath",
      "caseSha256", "validationSha256",
    ], `published artifact binding ${artifact.publicCaseId}`);
    if (
      publishedIds.has(artifact.publicCaseId) || publishedPaths.has(artifact.path) ||
      publishedPaths.has(artifact.validationRecordPath) ||
      !SHA256_PATTERN.test(artifact.caseSha256) ||
      !SHA256_PATTERN.test(artifact.validationSha256)
    ) {
      throw new Error("case review published artifact identity, path, or hash is invalid");
    }
    publishedIds.add(artifact.publicCaseId);
    publishedPaths.add(artifact.path);
    publishedPaths.add(artifact.validationRecordPath);
    const sourceCase = sourceCasesById.get(artifact.publicCaseId);
    const review = reviewsByPublicCaseId.get(artifact.publicCaseId);
    if (
      sourceCase === undefined || review === undefined ||
      artifact.caseVersion !== sourceCase.caseVersion ||
      artifact.contentHash !== sourceCase.provenance.contentHash ||
      artifact.casePackageSchemaVersion !== sourceCase.schemaVersion ||
      artifact.reviewStatus !== review.decision ||
      sha256Canonical(artifact.findings) !==
        sha256Canonical(review.validations.flatMap(({ findings }) => findings))
    ) {
      throw new Error(`case review published semantic binding drifted: ${artifact.publicCaseId}`);
    }
    const casePath = resolveModelArtifact(modelRoot, `cases/${artifact.path}`);
    const validationPath = resolveModelArtifact(
      modelRoot,
      `cases/${artifact.validationRecordPath}`,
    );
    if (
      sha256File(casePath) !== artifact.caseSha256 ||
      sha256File(validationPath) !== artifact.validationSha256
    ) {
      throw new Error(`case review published artifact hash drifted: ${artifact.publicCaseId}`);
    }
    const publishedCase = JSON.parse(readFileSync(casePath, "utf8")) as SupportedCasePackage;
    assertCasePackageJsonSchema(publishedCase);
    assertSupportedCasePackage(publishedCase);
    if (
      publishedCase.publicCaseId !== artifact.publicCaseId ||
      publishedCase.caseVersion !== artifact.caseVersion ||
      publishedCase.provenance.contentHash !== artifact.contentHash ||
      publishedCase.packageStatus !== artifact.packageStatus ||
      computeCaseContentHash(publishedCase) !== artifact.contentHash
    ) {
      throw new Error(`case review published case drifted: ${artifact.publicCaseId}`);
    }
    const sidecar = JSON.parse(readFileSync(validationPath, "utf8")) as AiCaseCrossReviewV3;
    assertAiCaseCrossReviewV3(sidecar, {
      caseId: publishedCase.internalCaseId,
      caseVersion: artifact.caseVersion,
      contentHash: artifact.contentHash,
    });
    if (sha256Canonical(sidecar) !== sha256Canonical(review)) {
      throw new Error(`case review validation copies drifted: ${artifact.publicCaseId}`);
    }
  }
  if (
    publishedIds.size !== sourceManifest.cases.length ||
    sourceManifest.cases.some(({ publicCaseId }) => !publishedIds.has(publicCaseId))
  ) {
    throw new Error("case review publication coverage drifted");
  }

  const evidenceSidecarsById = new Map(
    index.caseReviewEvidence.sidecars.map((sidecar) => [sidecar.publicCaseId, sidecar] as const),
  );
  if (
    evidenceSidecarsById.size !== index.publishedArtifacts.length ||
    index.caseReviewEvidence.sidecars.length !== index.publishedArtifacts.length ||
    index.publishedArtifacts.some((artifact) => {
      const sidecar = evidenceSidecarsById.get(artifact.publicCaseId);
      const sourceCase = sourceCasesById.get(artifact.publicCaseId);
      return sidecar === undefined || sourceCase === undefined ||
        sidecar.caseId !== sourceCase.internalCaseId ||
        sidecar.caseVersion !== artifact.caseVersion ||
        sidecar.contentHash !== artifact.contentHash ||
        sidecar.path !== `cases/${artifact.validationRecordPath}` ||
        sidecar.sha256 !== artifact.validationSha256;
    })
  ) {
    throw new Error("case review evidence sidecars drifted from the current index");
  }

  const releaseManifestPath = resolveModelArtifact(modelRoot, index.caseManifest.path);
  if (sha256File(releaseManifestPath) !== index.caseManifest.sha256) {
    throw new Error("case review release manifest hash drifted");
  }
  const releaseManifest = loadCaseManifestV2(releaseManifestPath);
  const rebuiltReleaseManifest = buildC7ReportedCaseManifest({
    candidateManifest: sourceManifest,
    artifacts: index.publishedArtifacts.map(({ validationRecordPath, ...artifact }) => ({
      ...artifact,
      reviewRecordPath: validationRecordPath,
    })),
  });
  if (sha256Canonical(releaseManifest) !== sha256Canonical(rebuiltReleaseManifest)) {
    throw new Error("case review release manifest is inconsistent with published artifacts");
  }
  const releaseBindings = listC7CaseManifestBindings(releaseManifest);
  if (
    releaseBindings.length !== index.publishedArtifacts.length ||
    releaseBindings.some((binding, position) => {
      const artifact = index.publishedArtifacts[position];
      return artifact === undefined ||
        binding.publicCaseId !== artifact.publicCaseId ||
        binding.caseVersion !== artifact.caseVersion ||
        binding.contentHash !== artifact.contentHash ||
        binding.path !== artifact.path ||
        binding.validationRecordPath !== artifact.validationRecordPath ||
        binding.packageStatus !== artifact.packageStatus ||
        binding.reviewStatus !== artifact.reviewStatus;
    })
  ) {
    throw new Error("case review release manifest bindings drifted");
  }

  const safetyEvidence = verifySafetyCorpus({
    modelRoot,
    evidenceDirectory,
    binding: index.safetyCorpus,
    configuredModelId: index.provider.configuredModelId,
    actualModelId: index.provider.actualModelId,
  });
  const expectedFindings: ReviewFinding[] = [];
  for (const artifact of index.caseValidations) {
    const review = reviewsByPublicCaseId.get(artifact.publicCaseId)!;
    if (review.decision !== "approved") {
      expectedFindings.push({
        code: "CASE_AI_REVIEW_NOT_APPROVED",
        scope: artifact.publicCaseId,
        decision: review.decision,
      });
    }
  }
  if (safetyEvidence.decision !== "approved") {
    expectedFindings.push({
      code: "SAFETY_AI_REVIEW_NOT_APPROVED",
      scope: "phase7-safety-corpus",
      decision: safetyEvidence.decision,
    });
  }
  if (sha256Canonical(index.reviewFindings) !== sha256Canonical(expectedFindings)) {
    throw new Error("case review quality findings drifted");
  }

  if (
    index.provider.configuredModelId !== index.caseReviewEvidence.configuredModelId ||
    (index.caseReviewEvidence.actualModelId !== undefined &&
      index.provider.actualModelId !== index.caseReviewEvidence.actualModelId)
  ) {
    throw new Error("case review index Provider/model binding drifted");
  }
  const integrity = verifyCaseReviewEvidence(index.caseReviewEvidence, modelRoot);
  for (const attempt of index.caseReviewEvidence.attempts) {
    const bundle = phase6BundlesByPublicCaseId.get(attempt.publicCaseId);
    if (bundle === undefined) {
      throw new Error(`case review request source is missing: ${attempt.publicCaseId}`);
    }
    const definition = buildPhase8CaseAuditRequestDefinition({
      role: attempt.role,
      casePackage: bundle.casePackage,
      supportingArtifacts: {
        regressionTrajectories: bundle.trajectories,
        scoringPolicySummary,
      },
    });
    const promptSha256 = createHash("sha256")
      .update(definition.instructions)
      .digest("hex");
    const inputSha256 = createHash("sha256")
      .update(definition.input)
      .digest("hex");
    if (
      attempt.providerName !== index.provider.providerName ||
      attempt.configuredModelId !== index.provider.configuredModelId ||
      attempt.clientRequestId !==
        `phase8_case_${attempt.role}_${attempt.publicCaseId}` ||
      attempt.caseContentHash !== bundle.casePackage.provenance.contentHash ||
      attempt.promptSha256 !== promptSha256 ||
      attempt.inputSha256 !== inputSha256 ||
      attempt.schemaSha256 !== sha256Canonical(definition.schema) ||
      attempt.store !== false
    ) {
      throw new Error(`case review request identity drifted: ${attempt.publicCaseId}/${attempt.role}`);
    }
  }
  return integrity;
}

function resolveEvidenceDirectory(modelRoot: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error("--evidence must be model-relative");
  const path = resolve(modelRoot, requested);
  const relativePath = relative(modelRoot, path);
  if (
    relativePath === "" || relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
  ) {
    throw new Error("--evidence must stay inside model/");
  }
  return path;
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--evidence") {
      throw new Error("用法：node dist/src/evaluation/case-ai-cross-review-verify.js --evidence <model-relative-dir>");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const evidenceDirectory = resolveEvidenceDirectory(modelRoot, argv[1]!);
    const indexPath = resolve(evidenceDirectory, "ai-evidence-index.json");
    if (!existsSync(indexPath)) throw new Error("case review evidence index is missing");
    const result = verifyCaseAiCrossReviewIndex({ modelRoot, indexPath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `病例 AI 交叉审核证据复验失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
