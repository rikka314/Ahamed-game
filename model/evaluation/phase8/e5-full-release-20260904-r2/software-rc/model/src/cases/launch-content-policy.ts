import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  validateJsonSchemaDocument,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";

export const LAUNCH_CONTENT_POLICY_SCHEMA_VERSION =
  "launch-content-policy-v1" as const;
export const LAUNCH_CONTENT_POLICY_VERSION =
  "launch-content-policy-2026-09-02" as const;
export const LAUNCH_CONTENT_POLICY_QUALITY_RECORD_SCHEMA_VERSION =
  "launch-content-policy-e0-quality-record-v1" as const;

export type LaunchDifficulty = "basic" | "advanced";
export type LaunchCaseOrigin = "migrated" | "new";
export type LaunchProductionBatch = "M0" | "B1" | "B2" | "B3" | "B4" | "B5";
export type LaunchReviewStatus =
  | "approved"
  | "revision_recommended"
  | "rejected"
  | "not_run";

export interface LaunchDiseaseDomainPolicy {
  domainId: string;
  displayName: string;
  quota: number;
  migratedCaseQuota: number;
  newCaseQuota: number;
}

export interface LaunchPersonaPolicy {
  personaTemplateId: string;
  displayName: string;
  quota: number;
  minimumDomainCoverage: number;
  offTopicReminderTurns: number;
  observableBehaviors: string[];
  prohibitedBehaviors: string[];
}

export interface LaunchCasePlan {
  sequence: number;
  publicCaseId: string;
  diseaseDomainId: string;
  topic: string;
  difficulty: LaunchDifficulty;
  personaTemplateId: string;
  productionBatch: LaunchProductionBatch;
  origin: LaunchCaseOrigin;
  patientRoleId: string;
  launchSafetyClass: "routine_outpatient" | "excluded_high_risk";
  boundary: string;
}

export interface LaunchContentPolicy {
  schemaVersion: typeof LAUNCH_CONTENT_POLICY_SCHEMA_VERSION;
  policyVersion: typeof LAUNCH_CONTENT_POLICY_VERSION;
  status: "frozen";
  frozenAt: string;
  reviewPolicy: {
    mode: "non_blocking";
    currentStatus: LaunchReviewStatus;
    aggregateDecisions: LaunchReviewStatus[];
    technicalErrorsRemainBlocking: true;
  };
  targets: {
    totalCases: number;
    migratedCases: number;
    newCases: number;
    basicCases: number;
    advancedCases: number;
    diseaseDomains: number;
    personas: number;
    casesPerPersona: number;
    minimumDomainsPerPersona: number;
    uniquePatientRoles: number;
  };
  diseaseDomains: LaunchDiseaseDomainPolicy[];
  personas: LaunchPersonaPolicy[];
  productionBatches: Array<{
    batchId: LaunchProductionBatch;
    kind: "migration" | "new_content";
    quota: number;
  }>;
  cases: LaunchCasePlan[];
  launchExclusions: Array<{
    exclusionId: string;
    category:
      | "clinical_risk"
      | "persona_scope"
      | "runtime_scope"
      | "source_rights"
      | "product_scope";
    rule: string;
  }>;
  versionPolicy: {
    casePackageSchemaVersion: "case-package-v2-rc1";
    personaTemplateVersion: "patient-persona-templates-v2";
    provenanceSchemaVersion: "provenance-record-v2";
    redFlagPolicyVersion: "red-flag-policy-manifest-v2";
    aiCaseReviewSchemaVersion: "ai-case-cross-review-v3";
    contentManifestVersion: "launch-case-manifest-v2-rc1";
    patientPromptVersion: "v0.5.0";
    contentHashPolicyVersion: "case-content-hash-v2";
    migratedCaseVersion: { candidate: string; final: string };
    newCaseVersion: { candidate: string; final: string };
    readOnlyCompatibleInputs: string[];
    releaseRule: "load_only_manifest_listed_v2_cases";
    contentHashIncludes: string[];
    contentHashExcludes: string[];
  };
  sourceLicensePolicy: {
    policyVersion: "source-license-policy-v1";
    reviewPolicy: "non_blocking";
    sourceRoles: string[];
    decisionRules: Array<{
      sourceKind: string;
      allowedRoles: string[];
      disposition:
        | "usable_with_conditions"
        | "reference_only"
        | "prohibited"
        | "unresolved_high_risk";
      allowVerbatimReuse: boolean;
      requiresAttribution: boolean;
      requiresPerSourceLicenseReview: boolean;
      notes: string;
    }>;
    prohibitedSourceKinds: string[];
    unresolvedSource: {
      riskLevel: "high";
      disposition: "record_high_risk_and_continue";
      allowCaseDevelopment: true;
      allowVerbatimReuse: false;
      manifestFindingRequired: true;
    };
    reviewers: Array<{
      role: "source_provenance" | "license_risk";
      independentInvocation: true;
      counterpartOutputVisible: false;
    }>;
  };
  supersededEvidence: {
    status: "superseded";
    recordPath: string;
    reason: string;
    artifacts: Array<{
      artifactId: string;
      path: string;
      status: "superseded";
    }>;
  };
}

export interface LaunchContentPolicyMetrics {
  totalCases: number;
  migratedCases: number;
  newCases: number;
  basicCases: number;
  advancedCases: number;
  diseaseDomains: number;
  personas: number;
  uniquePublicCaseIds: number;
  uniquePatientRoleIds: number;
}

export interface LaunchContentPolicyValidationResult {
  valid: boolean;
  issues: string[];
  metrics: LaunchContentPolicyMetrics;
}

export interface LaunchContentPolicyQualityRecord {
  schemaVersion: typeof LAUNCH_CONTENT_POLICY_QUALITY_RECORD_SCHEMA_VERSION;
  policyVersion: typeof LAUNCH_CONTENT_POLICY_VERSION;
  recordedAt: string;
  technicalStatus: "passed" | "failed";
  aiReview: {
    reviewPolicy: "non_blocking";
    status: LaunchReviewStatus;
    findingsCount: number;
  };
  metrics: LaunchContentPolicyMetrics;
  checks: Array<{
    checkId: string;
    status: "pass" | "fail";
    details: string;
  }>;
  findings: string[];
  supersededEvidence: {
    status: "superseded";
    recordPath: string;
    artifactCount: number;
  };
}

export class LaunchContentPolicyValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Launch content policy validation failed: ${issues.join("; ")}`);
    this.name = "LaunchContentPolicyValidationError";
  }
}

function readJson(name: string): unknown {
  const path = fileURLToPath(new URL(`../../../cases/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const launchContentPolicySchema = readJson(
  "schemas/launch-content-policy-v1.schema.json",
) as JsonSchemaSubset;

const EMPTY_METRICS: LaunchContentPolicyMetrics = {
  totalCases: 0,
  migratedCases: 0,
  newCases: 0,
  basicCases: 0,
  advancedCases: 0,
  diseaseDomains: 0,
  personas: 0,
  uniquePublicCaseIds: 0,
  uniquePatientRoleIds: 0,
};

function countBy<T>(items: readonly T[], select: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = select(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function duplicateValues(values: readonly string[]): string[] {
  return [...countBy(values, (value) => value).entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function policyMetrics(policy: LaunchContentPolicy): LaunchContentPolicyMetrics {
  return {
    totalCases: policy.cases.length,
    migratedCases: policy.cases.filter(({ origin }) => origin === "migrated").length,
    newCases: policy.cases.filter(({ origin }) => origin === "new").length,
    basicCases: policy.cases.filter(({ difficulty }) => difficulty === "basic").length,
    advancedCases: policy.cases.filter(({ difficulty }) => difficulty === "advanced").length,
    diseaseDomains: policy.diseaseDomains.length,
    personas: policy.personas.length,
    uniquePublicCaseIds: new Set(policy.cases.map(({ publicCaseId }) => publicCaseId)).size,
    uniquePatientRoleIds: new Set(policy.cases.map(({ patientRoleId }) => patientRoleId)).size,
  };
}

function validateReferencesAndIdentity(policy: LaunchContentPolicy, issues: string[]): void {
  const domainIds = new Set(policy.diseaseDomains.map(({ domainId }) => domainId));
  const personaIds = new Set(
    policy.personas.map(({ personaTemplateId }) => personaTemplateId),
  );
  const batchIds = new Set(
    policy.productionBatches.map(({ batchId }) => batchId),
  );
  for (const duplicated of duplicateValues(
    policy.cases.map(({ publicCaseId }) => publicCaseId),
  )) {
    issues.push(`publicCaseId ${duplicated} is duplicated`);
  }
  for (const duplicated of duplicateValues(
    policy.cases.map(({ patientRoleId }) => patientRoleId),
  )) {
    issues.push(`patientRoleId ${duplicated} is duplicated`);
  }
  for (const duplicated of duplicateValues(
    policy.cases.map(({ sequence }) => String(sequence)),
  )) {
    issues.push(`case sequence ${duplicated} is duplicated`);
  }
  for (const plannedCase of policy.cases) {
    const caseCode = `c${String(plannedCase.sequence).padStart(2, "0")}`;
    if (!plannedCase.publicCaseId.startsWith(`case_${caseCode}_`)) {
      issues.push(`case ${plannedCase.sequence} publicCaseId must start with case_${caseCode}_`);
    }
    if (plannedCase.patientRoleId !== `patient-role.public-${caseCode}`) {
      issues.push(`case ${plannedCase.sequence} patientRoleId must equal patient-role.public-${caseCode}`);
    }
    if (!domainIds.has(plannedCase.diseaseDomainId)) {
      issues.push(`case ${caseCode} references unknown disease domain ${plannedCase.diseaseDomainId}`);
    }
    if (!personaIds.has(plannedCase.personaTemplateId)) {
      issues.push(`case ${caseCode} references unknown persona ${plannedCase.personaTemplateId}`);
    }
    if (!batchIds.has(plannedCase.productionBatch)) {
      issues.push(`case ${caseCode} references unknown production batch ${plannedCase.productionBatch}`);
    }
    if (
      plannedCase.sequence <= 5 &&
      (plannedCase.origin !== "migrated" || plannedCase.productionBatch !== "M0")
    ) {
      issues.push("C01-C05 must be migrated in M0");
    }
    if (plannedCase.sequence > 5 && plannedCase.origin !== "new") {
      issues.push("C06-C30 must be new cases");
    }
    if (plannedCase.launchSafetyClass !== "routine_outpatient") {
      issues.push(`case ${caseCode} is in excluded high-risk launch scope`);
    }
  }
}

function validateQuotas(policy: LaunchContentPolicy, issues: string[]): void {
  const metrics = policyMetrics(policy);
  if (metrics.totalCases !== policy.targets.totalCases) {
    issues.push(`case quota must equal ${policy.targets.totalCases}`);
  }
  if (metrics.migratedCases !== policy.targets.migratedCases) {
    issues.push(`migrated case quota must equal ${policy.targets.migratedCases}`);
  }
  if (metrics.newCases !== policy.targets.newCases) {
    issues.push(`new case quota must equal ${policy.targets.newCases}`);
  }
  if (
    metrics.basicCases !== policy.targets.basicCases ||
    metrics.advancedCases !== policy.targets.advancedCases
  ) {
    issues.push(
      `difficulty quota basic=${policy.targets.basicCases}, advanced=${policy.targets.advancedCases} is required`,
    );
  }

  const domainCounts = countBy(policy.cases, ({ diseaseDomainId }) => diseaseDomainId);
  const domainMigratedCounts = countBy(
    policy.cases.filter(({ origin }) => origin === "migrated"),
    ({ diseaseDomainId }) => diseaseDomainId,
  );
  const domainNewCounts = countBy(
    policy.cases.filter(({ origin }) => origin === "new"),
    ({ diseaseDomainId }) => diseaseDomainId,
  );
  for (const domain of policy.diseaseDomains) {
    if ((domainCounts.get(domain.domainId) ?? 0) !== domain.quota) {
      issues.push(`domain ${domain.domainId} quota must equal ${domain.quota}`);
    }
    if (
      (domainMigratedCounts.get(domain.domainId) ?? 0) !==
      domain.migratedCaseQuota
    ) {
      issues.push(
        `domain ${domain.domainId} migrated-case quota must equal ${domain.migratedCaseQuota}`,
      );
    }
    if ((domainNewCounts.get(domain.domainId) ?? 0) !== domain.newCaseQuota) {
      issues.push(
        `domain ${domain.domainId} new-case quota must equal ${domain.newCaseQuota}`,
      );
    }
  }

  const personaCounts = countBy(
    policy.cases,
    ({ personaTemplateId }) => personaTemplateId,
  );
  for (const persona of policy.personas) {
    if ((personaCounts.get(persona.personaTemplateId) ?? 0) !== persona.quota) {
      issues.push(
        `persona ${persona.personaTemplateId} quota must equal ${persona.quota}`,
      );
    }
    const coveredDomains = new Set(
      policy.cases
        .filter(
          ({ personaTemplateId }) =>
            personaTemplateId === persona.personaTemplateId,
        )
        .map(({ diseaseDomainId }) => diseaseDomainId),
    );
    if (coveredDomains.size < persona.minimumDomainCoverage) {
      issues.push(
        `persona ${persona.personaTemplateId} must span at least ${persona.minimumDomainCoverage} disease domains`,
      );
    }
  }

  const batchCounts = countBy(
    policy.cases,
    ({ productionBatch }) => productionBatch,
  );
  for (const batch of policy.productionBatches) {
    if ((batchCounts.get(batch.batchId) ?? 0) !== batch.quota) {
      issues.push(`batch ${batch.batchId} quota must equal ${batch.quota}`);
    }
    const expectedKind = batch.batchId === "M0" ? "migration" : "new_content";
    if (batch.kind !== expectedKind) {
      issues.push(`batch ${batch.batchId} kind must equal ${expectedKind}`);
    }
  }
}

function reportDuplicates(
  label: string,
  values: readonly string[],
  issues: string[],
): void {
  for (const duplicated of duplicateValues(values)) {
    issues.push(`${label} ${duplicated} is duplicated`);
  }
}

function validatePolicyCatalogs(
  policy: LaunchContentPolicy,
  issues: string[],
): void {
  reportDuplicates(
    "disease domain",
    policy.diseaseDomains.map(({ domainId }) => domainId),
    issues,
  );
  reportDuplicates(
    "persona policy",
    policy.personas.map(({ personaTemplateId }) => personaTemplateId),
    issues,
  );
  reportDuplicates(
    "production batch",
    policy.productionBatches.map(({ batchId }) => batchId),
    issues,
  );
  reportDuplicates(
    "launch exclusion",
    policy.launchExclusions.map(({ exclusionId }) => exclusionId),
    issues,
  );
  reportDuplicates(
    "source decision rule",
    policy.sourceLicensePolicy.decisionRules.map(({ sourceKind }) => sourceKind),
    issues,
  );
  reportDuplicates(
    "superseded artifact",
    policy.supersededEvidence.artifacts.map(({ artifactId }) => artifactId),
    issues,
  );
  const reviewerRoles = new Set(
    policy.sourceLicensePolicy.reviewers.map(({ role }) => role),
  );
  if (
    reviewerRoles.size !== 2 ||
    !reviewerRoles.has("source_provenance") ||
    !reviewerRoles.has("license_risk")
  ) {
    issues.push("source reviewers must contain both isolated roles");
  }
}

export function validateLaunchContentPolicy(
  value: unknown,
): LaunchContentPolicyValidationResult {
  const schemaResult = validateJsonSchemaDocument(
    launchContentPolicySchema,
    value,
  );
  if (!schemaResult.valid) {
    return {
      valid: false,
      issues: schemaResult.errors.map((issue) => `JSON Schema: ${issue}`),
      metrics: { ...EMPTY_METRICS },
    };
  }

  const policy = value as LaunchContentPolicy;
  const issues: string[] = [];
  validatePolicyCatalogs(policy, issues);
  validateReferencesAndIdentity(policy, issues);
  validateQuotas(policy, issues);
  return {
    valid: issues.length === 0,
    issues,
    metrics: policyMetrics(policy),
  };
}

export function assertLaunchContentPolicy(
  value: unknown,
): asserts value is LaunchContentPolicy {
  const result = validateLaunchContentPolicy(value);
  if (!result.valid) throw new LaunchContentPolicyValidationError(result.issues);
}

export function loadLaunchContentPolicy(): LaunchContentPolicy {
  const value = readJson("policy/launch-content-policy-v1.json");
  assertLaunchContentPolicy(value);
  return value;
}

function qualityCheck(
  checkId: string,
  passed: boolean,
  details: string,
): LaunchContentPolicyQualityRecord["checks"][number] {
  return { checkId, status: passed ? "pass" : "fail", details };
}

export function createLaunchContentPolicyQualityRecord(
  policy: LaunchContentPolicy,
  recordedAt: string,
): LaunchContentPolicyQualityRecord {
  const validation = validateLaunchContentPolicy(policy);
  const personaDistributionPasses = policy.personas.every((persona) => {
    const matching = policy.cases.filter(
      ({ personaTemplateId }) => personaTemplateId === persona.personaTemplateId,
    );
    return (
      matching.length === persona.quota &&
      new Set(matching.map(({ diseaseDomainId }) => diseaseDomainId)).size >=
        persona.minimumDomainCoverage
    );
  });
  const checks = [
    qualityCheck("case_count", validation.metrics.totalCases === 30, `${validation.metrics.totalCases}/30 cases`),
    qualityCheck("new_case_count", validation.metrics.newCases === 25, `${validation.metrics.newCases}/25 new cases`),
    qualityCheck("difficulty_quota", validation.metrics.basicCases === 24 && validation.metrics.advancedCases === 6, `${validation.metrics.basicCases} basic, ${validation.metrics.advancedCases} advanced`),
    qualityCheck("disease_domain_quota", policy.diseaseDomains.every((domain) => policy.cases.filter(({ diseaseDomainId }) => diseaseDomainId === domain.domainId).length === domain.quota), `${validation.metrics.diseaseDomains}/9 domains`),
    qualityCheck("persona_distribution", personaDistributionPasses, `${validation.metrics.personas}/6 personas with five cases and minimum domain spread`),
    qualityCheck("identity_uniqueness", validation.metrics.uniquePublicCaseIds === 30 && validation.metrics.uniquePatientRoleIds === 30, `${validation.metrics.uniquePublicCaseIds} publicCaseIds, ${validation.metrics.uniquePatientRoleIds} patientRoleIds`),
    qualityCheck("launch_exclusions", policy.cases.every(({ launchSafetyClass }) => launchSafetyClass === "routine_outpatient") && policy.launchExclusions.length >= 8, `${policy.launchExclusions.length} explicit exclusions; no high-risk launch case`),
    qualityCheck("source_license_policy", policy.sourceLicensePolicy.reviewPolicy === "non_blocking" && !policy.sourceLicensePolicy.unresolvedSource.allowVerbatimReuse, `${policy.sourceLicensePolicy.decisionRules.length} source decision rules`),
    qualityCheck("version_policy", policy.versionPolicy.migratedCaseVersion.candidate === "1.1.0-rc.1" && policy.versionPolicy.newCaseVersion.candidate === "1.0.0-rc.1", `${policy.versionPolicy.casePackageSchemaVersion}, ${policy.versionPolicy.personaTemplateVersion}`),
    qualityCheck("superseded_evidence", policy.supersededEvidence.status === "superseded" && policy.supersededEvidence.artifacts.length >= 5, `${policy.supersededEvidence.artifacts.length} historical artifact groups`),
  ];
  return {
    schemaVersion: LAUNCH_CONTENT_POLICY_QUALITY_RECORD_SCHEMA_VERSION,
    policyVersion: policy.policyVersion,
    recordedAt,
    technicalStatus:
      validation.valid && checks.every(({ status }) => status === "pass")
        ? "passed"
        : "failed",
    aiReview: {
      reviewPolicy: policy.reviewPolicy.mode,
      status: policy.reviewPolicy.currentStatus,
      findingsCount: 0,
    },
    metrics: validation.metrics,
    checks,
    findings: validation.issues,
    supersededEvidence: {
      status: policy.supersededEvidence.status,
      recordPath: policy.supersededEvidence.recordPath,
      artifactCount: policy.supersededEvidence.artifacts.length,
    },
  };
}
