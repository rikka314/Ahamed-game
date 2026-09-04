import {
  loadPhase6CaseBundlesFromManifest,
  validatePhase6CaseBundle,
} from "./phase6-case-production.js";

const { manifest, bundles, report } = loadPhase6CaseBundlesFromManifest({
  casesDirectory: "cases",
  manifestPath: "cases/manifest.phase6-compat.v2-rc2.json",
});
const cases = bundles.map((bundle) => ({
  publicCaseId: bundle.casePackage.publicCaseId,
  caseVersion: bundle.casePackage.caseVersion,
  ...validatePhase6CaseBundle(bundle, manifest.releasePolicy),
}));
const structurallyReady = cases.filter(
  ({ structuralIssues }) => structuralIssues.length === 0,
).length;
const publishable = cases.filter(
  ({ structuralIssues, publicationBlockers }) =>
    structuralIssues.length === 0 && publicationBlockers.length === 0,
).length;
const findings = [
  ...report.findings,
  ...cases.flatMap(({ publicCaseId, structuralIssues, publicationBlockers }) => [
    ...structuralIssues.map((message) => ({
      code: "CASE_STRUCTURAL_ISSUE",
      publicCaseId,
      message,
    })),
    ...publicationBlockers.map((code) => ({
      code,
      publicCaseId,
      message: "AI cross-review status is recorded as a non-blocking release finding.",
    })),
  ]),
];

console.log(
  JSON.stringify(
    {
      phase: 6,
      status: "reported",
      manifestVersion: manifest.manifestVersion,
      releasePolicyVersion: manifest.releasePolicy.policyVersion,
      reviewPolicy: manifest.reviewPolicy,
      reviewSummary: manifest.reviewSummary,
      total: cases.length,
      structurallyReady,
      publishable,
      findings,
      cases,
    },
    null,
    2,
  ),
);
