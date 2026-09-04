import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  validateJsonSchemaDocument,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";

import {
  PHASE7_SAFETY_CORPUS_V1,
  PHASE7_SAFETY_CORPUS_VERSION_V1,
} from "./phase7-safety-corpus.js";
import {
  runPhase7OfflineEvalHarness,
  type Phase7PublishedCaseReference,
} from "./phase7-eval-harness.js";
import { buildPhase7EvalCorpusFromManifest } from "./phase7-eval-corpus.js";
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import {
  evaluateMedicalSafetyV1,
  MEDICAL_SAFETY_TEMPLATES_V1,
} from "../safety/medical-safety-policy-v1.js";
import { computeCaseContentHash } from "../domain/case-content-hash.js";
import {
  assertCasePackage,
  type CasePackage,
} from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";

const DEFAULT_MANIFEST_URL = new URL(
  "../../../cases/manifest.v1-rc1.json",
  import.meta.url,
);
const DEFAULT_EVAL_MANIFEST_URL = new URL(
  "../../../cases/manifest.phase6-compat.v2-rc1.json",
  import.meta.url,
);
const PHASE6_MANIFEST_SCHEMA = JSON.parse(
  readFileSync(
    new URL("../../../cases/schemas/case-manifest-v1-rc1.schema.json", import.meta.url),
    "utf8",
  ),
) as JsonSchemaSubset;

interface CaseManifestV1Rc1 {
  publishedCases: Array<{
    publicCaseId: string;
    caseVersion: string;
    path: string;
    contentHash: string;
    releaseValidationMethod: "ai_cross_validation";
    validationRecordPath: string;
  }>;
}

export interface VerifiedPhase7PublishedCases {
  readonly cases: readonly Phase7PublishedCaseReference[];
}

const VERIFIED_PUBLISHED_CASE_SETS = new WeakSet<object>();

export interface Phase7OfflineDevelopmentReport {
  schemaVersion: "phase7-offline-development-report-v1";
  evidenceStatus: "development_only";
  releaseValidationMethod: "ai_cross_validation";
  caseManifestVersion: "case-manifest-v2-rc1";
  releasePolicyVersion: "model-release-policy-v1";
  reviewPolicy: "non_blocking";
  providerCalls: 0;
  evaluationCorpus: ReturnType<typeof runPhase7OfflineEvalHarness>;
  safetyCorpus: {
    datasetVersion: string;
    runtimeContext: "fictional_case_session";
    totalSamples: number;
    holdoutSamples: number;
    validatedSamples: number;
    decisionMismatches: number;
    templateMismatches: number;
    urgentFalseNegatives: number;
    selfHarmFalseNegatives: number;
    untrustedDecisionMismatches: number;
  };
  fullCandidateBenchmarkGate: ReturnType<typeof runPhase7OfflineEvalHarness>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePhase7PublishedCaseEntries(
  manifestValue: unknown,
): CaseManifestV1Rc1["publishedCases"] {
  const schemaResult = validateJsonSchemaDocument(
    PHASE6_MANIFEST_SCHEMA,
    manifestValue,
  );
  if (!schemaResult.valid) {
    throw new Error(
      `Phase 6 manifest contract is invalid: ${schemaResult.errors.join("; ")}`,
    );
  }
  if (!isRecord(manifestValue) || !Array.isArray(manifestValue["publishedCases"])) {
    throw new Error("Phase 6 manifest must contain publishedCases.");
  }

  const manifest = manifestValue as unknown as CaseManifestV1Rc1;
  const ids = new Set<string>();
  return manifest.publishedCases.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry["publicCaseId"] !== "string" ||
      entry["publicCaseId"].trim().length === 0 ||
      typeof entry["caseVersion"] !== "string" ||
      entry["caseVersion"].trim().length === 0 ||
      typeof entry["path"] !== "string" ||
      entry["path"].trim().length === 0 ||
      typeof entry["contentHash"] !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(entry["contentHash"]) ||
      entry["releaseValidationMethod"] !== "ai_cross_validation" ||
      typeof entry["validationRecordPath"] !== "string" ||
      entry["validationRecordPath"].trim().length === 0 ||
      ids.has(entry["publicCaseId"])
    ) {
      throw new Error(
        "Phase 6 publishedCases must contain unique AI-cross-validated publicCaseId values with caseVersion and sha256 contentHash bindings.",
      );
    }
    ids.add(entry["publicCaseId"]);
    return entry;
  });
}

function resolvePublishedArtifactPath(
  casesDirectory: string,
  artifactPath: string,
): string {
  const resolvedPath = resolve(casesDirectory, artifactPath);
  const relativePath = relative(casesDirectory, resolvedPath);
  if (
    isAbsolute(artifactPath) ||
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    !relativePath.startsWith(`published${sep}`)
  ) {
    throw new Error("published case artifact path must stay inside cases/published");
  }
  return resolvedPath;
}

function loadVerifiedPublishedCase(
  entry: CaseManifestV1Rc1["publishedCases"][number],
  casesDirectory: string,
): Phase7PublishedCaseReference {
  const casePath = resolvePublishedArtifactPath(casesDirectory, entry.path);
  const validationPath = resolvePublishedArtifactPath(
    casesDirectory,
    entry.validationRecordPath,
  );
  let caseValue: unknown;
  let validationValue: unknown;
  try {
    caseValue = JSON.parse(readFileSync(casePath, "utf8")) as unknown;
    validationValue = JSON.parse(readFileSync(validationPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `published case artifact could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assertCasePackageJsonSchema(caseValue);
  assertCasePackage(caseValue);
  const casePackage = caseValue satisfies CasePackage;
  if (casePackage.packageStatus !== "published") {
    throw new Error("published case artifact must have packageStatus=published");
  }
  if (
    casePackage.publicCaseId !== entry.publicCaseId ||
    casePackage.caseVersion !== entry.caseVersion ||
    casePackage.provenance.contentHash !== entry.contentHash
  ) {
    throw new Error("published case artifact does not match its manifest binding");
  }
  if (computeCaseContentHash(casePackage) !== entry.contentHash) {
    throw new Error("published case artifact canonical content hash does not match its manifest binding");
  }
  if (
    casePackage.releaseValidation === undefined ||
    !isDeepStrictEqual(casePackage.releaseValidation, validationValue)
  ) {
    throw new Error("published case validation sidecar does not match the embedded AI validation");
  }

  return {
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    contentHash: entry.contentHash,
    packageStatus: "published",
    releaseValidationMethod: "ai_cross_validation",
  };
}

export function loadPhase7PublishedCases(
  manifestUrl: URL = DEFAULT_MANIFEST_URL,
): VerifiedPhase7PublishedCases {
  const manifestValue = JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown;
  const casesDirectory = dirname(fileURLToPath(manifestUrl));
  const cases = Object.freeze(
    parsePhase7PublishedCaseEntries(manifestValue).map((entry) =>
      Object.freeze(loadVerifiedPublishedCase(entry, casesDirectory)),
    ),
  );
  const verifiedSet: VerifiedPhase7PublishedCases = Object.freeze({ cases });
  VERIFIED_PUBLISHED_CASE_SETS.add(verifiedSet);
  return verifiedSet;
}

export function createPhase7OfflineDevelopmentReport(
  publishedCases: VerifiedPhase7PublishedCases,
  evaluationManifestUrl: URL = DEFAULT_EVAL_MANIFEST_URL,
): Phase7OfflineDevelopmentReport {
  if (!VERIFIED_PUBLISHED_CASE_SETS.has(publishedCases)) {
    throw new Error("Phase 7 requires artifact-verified published cases");
  }
  let decisionMismatches = 0;
  let templateMismatches = 0;
  let urgentFalseNegatives = 0;
  let selfHarmFalseNegatives = 0;
  let untrustedDecisionMismatches = 0;
  const evaluationManifestPath = fileURLToPath(evaluationManifestUrl);
  const evaluationManifest = loadCaseManifestV2(evaluationManifestPath);
  const evaluationCorpus = buildPhase7EvalCorpusFromManifest({
    manifest: evaluationManifest,
    casesDirectory: dirname(evaluationManifestPath),
    bindings: publishedCases.cases,
  });

  for (const sample of PHASE7_SAFETY_CORPUS_V1) {
    const result = evaluateMedicalSafetyV1({
      text: sample.text,
      context: "fictional_case_session",
    });
    const untrustedResult = evaluateMedicalSafetyV1({
      text: sample.text,
      context: "untrusted",
    });
    const expectedRuntimeDecision =
      sample.label === "AMBIGUOUS_CONSERVATIVE" &&
      (sample.person === "self" || sample.person === "third_person")
        ? "EXIT_REAL_HEALTH"
        : sample.expectedDecision;
    const expectedRuntimeTemplate =
      MEDICAL_SAFETY_TEMPLATES_V1[expectedRuntimeDecision].templateId;
    if (result.decision !== expectedRuntimeDecision) {
      decisionMismatches += 1;
    }
    if (result.templateId !== expectedRuntimeTemplate) {
      templateMismatches += 1;
    }
    if (
      sample.label === "REAL_HEALTH_RED_FLAG" &&
      result.decision !== "EXIT_URGENT_RED_FLAG"
    ) {
      urgentFalseNegatives += 1;
    }
    if (
      sample.label === "SELF_HARM_CRISIS" &&
      result.decision !== "EXIT_SELF_HARM_CRISIS"
    ) {
      selfHarmFalseNegatives += 1;
    }
    if (untrustedResult.decision !== sample.expectedDecision) {
      untrustedDecisionMismatches += 1;
    }
  }

  return {
    schemaVersion: "phase7-offline-development-report-v1",
    evidenceStatus: "development_only",
    releaseValidationMethod: "ai_cross_validation",
    caseManifestVersion: evaluationManifest.manifestVersion,
    releasePolicyVersion: evaluationManifest.releasePolicy.policyVersion,
    reviewPolicy: evaluationManifest.reviewPolicy,
    providerCalls: 0,
    evaluationCorpus: runPhase7OfflineEvalHarness({ corpus: evaluationCorpus }),
    safetyCorpus: {
      datasetVersion: PHASE7_SAFETY_CORPUS_VERSION_V1,
      runtimeContext: "fictional_case_session",
      totalSamples: PHASE7_SAFETY_CORPUS_V1.length,
      holdoutSamples: PHASE7_SAFETY_CORPUS_V1.filter(
        ({ split }) => split === "holdout",
      ).length,
      validatedSamples: PHASE7_SAFETY_CORPUS_V1.length,
      decisionMismatches,
      templateMismatches,
      urgentFalseNegatives,
      selfHarmFalseNegatives,
      untrustedDecisionMismatches,
    },
    fullCandidateBenchmarkGate: runPhase7OfflineEvalHarness({
      corpus: evaluationCorpus,
      requireFullCandidateBenchmark: true,
      publishedCases: publishedCases.cases,
    }),
  };
}

export function runPhase7OfflineDevelopmentReport(
  manifestUrl: URL = DEFAULT_MANIFEST_URL,
): Phase7OfflineDevelopmentReport {
  return createPhase7OfflineDevelopmentReport(
    loadPhase7PublishedCases(manifestUrl),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(runPhase7OfflineDevelopmentReport(), null, 2)}\n`,
  );
}
