import { computeCaseContentHash } from "../domain/case-content-hash.js";
import { assertCasePackage } from "../domain/case-package.js";
import { assertCasePackageJsonSchema } from "../domain/case-package-schema.js";
import { assertPatientDialogueMetadata } from "../domain/safe-patient-case-view.js";
import { loadPhase6CaseBundles } from "./phase6-case-production.js";

const cases = loadPhase6CaseBundles().map(({ casePackage }) => {
  const issues: string[] = [];
  try {
    assertCasePackageJsonSchema(casePackage);
    assertCasePackage(casePackage);
    assertPatientDialogueMetadata(casePackage);
    if (casePackage.provenance.contentHash !== computeCaseContentHash(casePackage)) {
      issues.push("canonical content hash mismatch");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return {
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    personaTemplateId: casePackage.patientPersona.personaTemplateId,
    contentHash: casePackage.provenance.contentHash,
    structurallyReady: issues.length === 0,
    issues,
  };
});

const structurallyReady = cases.filter(
  ({ structurallyReady }) => structurallyReady,
).length;
console.log(JSON.stringify({
  architectureStage: "C1",
  releaseStatus: "pending_c7_dual_ai_validation",
  total: cases.length,
  structurallyReady,
  cases,
}, null, 2));

if (structurallyReady !== cases.length) process.exitCode = 1;
