import type { CasePackageV2 } from "../../src/domain/case-package.js";
import { computeCaseContentHash } from "../../src/domain/case-content-hash.js";

import { createCaseFixture } from "./case-fixture.js";

const FIXTURE_HASH = `sha256:${"0".repeat(64)}`;

export function createCaseV2Fixture(): CasePackageV2 {
  const legacy = createCaseFixture();
  const casePackage: CasePackageV2 = {
    schemaVersion: "case-package-v2-rc1",
    evaluationVersion: legacy.evaluationVersion,
    packageStatus: "fixture",
    internalCaseId: legacy.internalCaseId,
    publicCaseId: legacy.publicCaseId,
    caseVersion: "1.1.0-rc.1",
    locale: legacy.locale,
    playerVisible: {
      chiefComplaint: legacy.playerVisible.chiefComplaint,
    },
    patientIdentity: {
      patientRoleId: "patient-role.fixture-001",
      patientDisplayName: legacy.playerVisible.patientDisplayName,
      ageBand: "adult",
      genderDisplay: "unspecified",
      educationOrOccupation: "Synthetic fixture researcher",
      dailyLife: "Works with deterministic test data only.",
      interests: ["fixture puzzles"],
    },
    patientPersona: {
      personaTemplateId: "talkative_digressive",
      personaTemplateVersion: "patient-persona-templates-v2",
      languageStyle: "plain",
      communicationTraits: ["uses extra non-medical detail"],
      modifiers: {
        healthLiteracy: "typical",
        recallReliability: "typical",
        emotionalIntensity: "moderate",
      },
    },
    patientFacts: structuredClone(legacy.patientFacts),
    medicalTests: structuredClone(legacy.medicalTests),
    answerKey: structuredClone(legacy.answerKey),
    rubric: structuredClone(legacy.rubric),
    review: structuredClone(legacy.review),
    provenance: {
      schemaVersion: "provenance-record-v2",
      createdAt: "2026-09-02T00:00:00.000Z",
      contentHash: FIXTURE_HASH,
      sources: [
        {
          sourceId: "source.fixture.synthetic",
          sourceRole: "synthetic_structure",
          title: "Synthetic E1 fixture",
          authorsOrOrganization: "AhaMed test suite",
          versionOrPublicationDate: "2026-09-02",
          license: "internal-test-fixture",
          attributionRequirements: "None outside automated tests.",
          adaptationAllowed: true,
          commercialUseAllowed: true,
          retrievedAt: "2026-09-02T00:00:00.000Z",
          projectUsage: "Defines structure only; contains no real patient data.",
          includesVerbatimExcerpt: false,
          verifiedCaseFields: ["patientFacts", "medicalTests"],
          licenseAssessment: "cleared",
          riskNotes: [],
        },
      ],
    },
    releaseReview: {
      schemaVersion: "ai-case-cross-review-v3",
      caseId: legacy.internalCaseId,
      caseVersion: "1.1.0-rc.1",
      contentHash: FIXTURE_HASH,
      decision: "not_run",
      validations: [],
      findings: ["AI cross-review has not been run for this synthetic fixture."],
    },
    redFlagExclusionMatrix: {
      ...structuredClone(legacy.redFlagExclusionMatrix),
      caseVersion: "1.1.0-rc.1",
    },
  };
  casePackage.provenance.contentHash = computeCaseContentHash(casePackage);
  if (casePackage.releaseReview !== undefined) {
    casePackage.releaseReview.contentHash = casePackage.provenance.contentHash;
  }
  return casePackage;
}
