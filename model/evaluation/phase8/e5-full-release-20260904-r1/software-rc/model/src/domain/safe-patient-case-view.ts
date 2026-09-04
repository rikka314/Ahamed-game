import type {
  CasePackageV2,
  FactStatus,
  PatientPersonaModifiersV2,
  SupportedCasePackage,
} from "./case-package.js";
import { assertCasePackageV2 } from "./case-package.js";
import {
  getPatientPersonaTemplate,
  isPatientPersonaTemplateId,
  isPatientPersonaTemplateVersion,
  PATIENT_PERSONA_TEMPLATE_VERSION_V1,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplate,
  type PatientPersonaTemplateId,
  type PatientPersonaTemplateVersion,
} from "./patient-persona.js";

export const PATIENT_DIALOGUE_METADATA_VERSION =
  "patient-dialogue-metadata-v2" as const;

export interface PatientPersonaFact {
  personaFactId: string;
  value: string;
}

export interface PatientProfile {
  templateId: PatientPersonaTemplateId;
  templateVersion: PatientPersonaTemplateVersion;
  patientRoleId?: string;
  /** Scene/UI label and surname hint; it is not required to be the patient's full legal name. */
  displayName: string;
  ageBand?: string;
  genderDisplay?: string;
  languageStyle: string;
  offTopicReminderThreshold: 1 | 2 | 3;
  behaviorInstructions: string[];
  offTopicReminderInstruction: string;
  communicationTraits: string[];
  modifiers: PatientPersonaModifiersV2;
  socialBackground: {
    educationOrOccupation: string;
    dailyLife: string;
    interests: string[];
  };
  personaFacts: PatientPersonaFact[];
}

export interface SafePatientFact {
  factId: string;
  status: FactStatus;
  value: string;
  disclosure: "spontaneous" | "if_asked";
  questionMatchers: string[];
}

export type SafePatientTestStatus =
  | "not_completed"
  | "completed"
  | "unavailable";

export interface SafePatientTest {
  testId: string;
  displayName: string;
  aliases: string[];
  status: SafePatientTestStatus;
  report?: string;
}

export interface SafePatientCaseView {
  viewVersion: typeof PATIENT_DIALOGUE_METADATA_VERSION;
  publicCaseId: string;
  caseVersion: string;
  locale: string;
  patientProfile: PatientProfile;
  facts: SafePatientFact[];
  tests: SafePatientTest[];
}

export interface PublicPatientIdentityProjectionV1 {
  patientRoleId: string;
  patientDisplayName: string;
  ageBand?: string;
  genderDisplay?: string;
}

export interface CompletedPatientTest {
  testId: string;
  status: "unavailable" | "completed";
  report?: string;
}

export class PatientDialogueMetadataError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid patient dialogue metadata: ${issues.join("; ")}`);
    this.name = "PatientDialogueMetadataError";
    this.issues = issues;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every(nonEmpty) &&
    new Set(value).size === value.length;
}

export function patientDialogueMetadataIssues(
  casePackage: SupportedCasePackage,
): string[] {
  const issues: string[] = [];
  const persona = casePackage.patientPersona;
  const expectedVersion = casePackage.schemaVersion === "case-package-v2-rc1"
    ? PATIENT_PERSONA_TEMPLATE_VERSION_V2
    : PATIENT_PERSONA_TEMPLATE_VERSION_V1;
  if (
    !isPatientPersonaTemplateId(
      persona.personaTemplateId,
      expectedVersion,
    )
  ) {
    issues.push("patientPersona.personaTemplateId is invalid");
  }
  if (persona.personaTemplateVersion !== expectedVersion) {
    issues.push(
      `patientPersona.personaTemplateVersion must equal ${expectedVersion}`,
    );
  }
  const identity = casePackage.schemaVersion === "case-package-v2-rc1"
    ? casePackage.patientIdentity
    : casePackage.patientPersona;
  const identityPath = casePackage.schemaVersion === "case-package-v2-rc1"
    ? "patientIdentity"
    : "patientPersona";
  if (!nonEmpty(identity.educationOrOccupation)) {
    issues.push(`${identityPath}.educationOrOccupation is required`);
  }
  if (!nonEmpty(identity.dailyLife)) {
    issues.push(`${identityPath}.dailyLife is required`);
  }
  if (!uniqueNonEmptyStrings(identity.interests) || identity.interests.length > 3) {
    issues.push(`${identityPath}.interests must contain at most 3 unique strings`);
  }
  if (!uniqueNonEmptyStrings(persona.communicationTraits)) {
    issues.push("patientPersona.communicationTraits must be unique strings");
  }

  for (const [testId, definition] of Object.entries(
    casePackage.medicalTests,
  )) {
    if (!nonEmpty(definition.displayName)) {
      issues.push(`medicalTests.${testId}.displayName is required`);
    }
    if (
      !uniqueNonEmptyStrings(definition.aliases) ||
      definition.aliases.length === 0
    ) {
      issues.push(
        `medicalTests.${testId}.aliases must be a non-empty unique string array`,
      );
    }
  }
  return issues;
}

export function assertPatientDialogueMetadata(
  casePackage: SupportedCasePackage,
): void {
  const issues = patientDialogueMetadataIssues(casePackage);
  if (issues.length > 0) throw new PatientDialogueMetadataError(issues);
}

interface PatientIdentityDetails {
  patientDisplayName: string;
  ageBand?: string;
  genderDisplay?: string;
  educationOrOccupation: string;
  dailyLife: string;
  interests: string[];
}

function patientIdentityDetails(
  casePackage: SupportedCasePackage,
): PatientIdentityDetails {
  if (casePackage.schemaVersion === "case-package-v2-rc1") {
    return casePackage.patientIdentity;
  }
  return {
    patientDisplayName: casePackage.playerVisible.patientDisplayName,
    ...(casePackage.playerVisible.ageBand === undefined
      ? {}
      : { ageBand: casePackage.playerVisible.ageBand }),
    ...(casePackage.playerVisible.genderDisplay === undefined
      ? {}
      : { genderDisplay: casePackage.playerVisible.genderDisplay }),
    educationOrOccupation: casePackage.patientPersona.educationOrOccupation!,
    dailyLife: casePackage.patientPersona.dailyLife!,
    interests: casePackage.patientPersona.interests!,
  };
}

function personaFacts(casePackage: SupportedCasePackage): PatientPersonaFact[] {
  const identity = patientIdentityDetails(casePackage);
  return [
    {
      personaFactId: "persona.scene_label",
      value: identity.patientDisplayName,
    },
    ...(identity.ageBand === undefined
      ? []
      : [{
          personaFactId: "persona.age_band",
          value: identity.ageBand,
        }]),
    ...(identity.genderDisplay === undefined
      ? []
      : [{
          personaFactId: "persona.gender",
          value: identity.genderDisplay,
        }]),
    {
      personaFactId: "persona.education_or_occupation",
      value: identity.educationOrOccupation,
    },
    { personaFactId: "persona.daily_life", value: identity.dailyLife },
    ...identity.interests.map((value, index) => ({
      personaFactId: `persona.interest.${index + 1}`,
      value,
    })),
  ];
}

function patientProfile(
  casePackage: SupportedCasePackage,
  template: PatientPersonaTemplate,
): PatientProfile {
  const persona = casePackage.patientPersona;
  const identity = patientIdentityDetails(casePackage);
  return {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    ...(casePackage.schemaVersion === "case-package-v2-rc1"
      ? { patientRoleId: casePackage.patientIdentity.patientRoleId }
      : {}),
    displayName: identity.patientDisplayName,
    ...(identity.ageBand === undefined
      ? {}
      : { ageBand: identity.ageBand }),
    ...(identity.genderDisplay === undefined
      ? {}
      : { genderDisplay: identity.genderDisplay }),
    languageStyle: persona.languageStyle,
    offTopicReminderThreshold: template.offTopicReminderThreshold,
    behaviorInstructions: [...template.behaviorInstructions],
    offTopicReminderInstruction: template.offTopicReminderInstruction,
    communicationTraits: [...persona.communicationTraits!],
    modifiers: casePackage.schemaVersion === "case-package-v2-rc1"
      ? structuredClone(casePackage.patientPersona.modifiers)
      : {
          healthLiteracy: "typical",
          recallReliability: "typical",
          emotionalIntensity: "moderate",
        },
    socialBackground: {
      educationOrOccupation: identity.educationOrOccupation,
      dailyLife: identity.dailyLife,
      interests: [...identity.interests],
    },
    personaFacts: personaFacts(casePackage),
  };
}

export function buildSafePatientCaseView(
  casePackage: SupportedCasePackage,
  completedTests: readonly CompletedPatientTest[] = [],
): SafePatientCaseView {
  if (casePackage.schemaVersion === "case-package-v2-rc1") {
    assertCasePackageV2(casePackage);
  }
  assertPatientDialogueMetadata(casePackage);
  const templateVersion = casePackage.patientPersona.personaTemplateVersion;
  if (!isPatientPersonaTemplateVersion(templateVersion)) {
    throw new PatientDialogueMetadataError([
      "patientPersona.personaTemplateVersion is invalid",
    ]);
  }
  const template = getPatientPersonaTemplate(
    casePackage.patientPersona.personaTemplateId!,
    templateVersion,
  );
  const completedById = new Map(
    completedTests.map((result) => [result.testId, result] as const),
  );
  const tests = Object.entries(casePackage.medicalTests).map(
    ([testId, definition]): SafePatientTest => {
      const completed = completedById.get(testId);
      if (definition.status === "unavailable") {
        return {
          testId,
          displayName: definition.displayName!,
          aliases: [...definition.aliases!],
          status: "unavailable",
        };
      }
      if (completed?.status === "completed") {
        return {
          testId,
          displayName: definition.displayName!,
          aliases: [...definition.aliases!],
          status: "completed",
          report: completed.report ?? definition.report!,
        };
      }
      return {
        testId,
        displayName: definition.displayName!,
        aliases: [...definition.aliases!],
        status: "not_completed",
      };
    },
  );

  return {
    viewVersion: PATIENT_DIALOGUE_METADATA_VERSION,
    publicCaseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    locale: casePackage.locale,
    patientProfile: patientProfile(casePackage, template),
    facts: Object.entries(casePackage.patientFacts).flatMap(
      ([factId, fact]): SafePatientFact[] =>
        fact.disclosure === "spontaneous" || fact.disclosure === "if_asked"
          ? [{
              factId,
              status: fact.status,
              value: fact.value,
              disclosure: fact.disclosure,
              questionMatchers: [...fact.questionMatchers],
            }]
          : [],
    ),
    tests,
  };
}

export function buildPublicPatientIdentityProjection(
  casePackage: CasePackageV2,
): PublicPatientIdentityProjectionV1 {
  assertCasePackageV2(casePackage);
  return {
    patientRoleId: casePackage.patientIdentity.patientRoleId,
    patientDisplayName: casePackage.patientIdentity.patientDisplayName,
    ...(casePackage.patientIdentity.ageBand === undefined
      ? {}
      : { ageBand: casePackage.patientIdentity.ageBand }),
    ...(casePackage.patientIdentity.genderDisplay === undefined
      ? {}
      : { genderDisplay: casePackage.patientIdentity.genderDisplay }),
  };
}
