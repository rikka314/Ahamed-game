import { loadPhase6CaseBundles, validatePhase6CaseBundle } from "./phase6-case-production.js";

const bundles = loadPhase6CaseBundles();
const cases = bundles.map((bundle) => ({
  publicCaseId: bundle.casePackage.publicCaseId,
  caseVersion: bundle.casePackage.caseVersion,
  ...validatePhase6CaseBundle(bundle),
}));
const structurallyReady = cases.filter(
  ({ structuralIssues }) => structuralIssues.length === 0,
).length;
const publishable = cases.filter(
  ({ structuralIssues, publicationBlockers }) =>
    structuralIssues.length === 0 && publicationBlockers.length === 0,
).length;

console.log(
  JSON.stringify(
    {
      phase: 6,
      total: cases.length,
      structurallyReady,
      publishable,
      cases,
    },
    null,
    2,
  ),
);

if (structurallyReady !== cases.length || publishable !== cases.length) {
  process.exitCode = 1;
}
