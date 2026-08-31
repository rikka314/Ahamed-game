import type {
  CasePackage,
  FactStatus,
} from "./case-package.js";
import {
  getPatientPersonaTemplate,
  isPatientPersonaTemplateId,
  PATIENT_PERSONA_TEMPLATE_VERSION,
  type PatientPersonaTemplate,
  type PatientPersonaTemplateId,
} from "./patient-persona.js";

export const PATIENT_DIALOGUE_METADATA_VERSION =
  "patient-dialogue-metadata-v1" as const;

export interface PatientPersonaFact {
  personaFactId: string;
  value: string;
}

export interface PatientProfile {
  templateId: PatientPersonaTemplateId;
  templateVersion: typeof PATIENT_PERSONA_TEMPLATE_VERSION;
  /** Scene/UI label and surname hint; it is not required to be the patient's full legal name. */
  displayName: string;
  ageBand?: string;
  genderDisplay?: string;
  languageStyle: string;
  offTopicReminderThreshold: 1 | 2 | 3;
  behaviorInstructions: string[];
  offTopicReminderInstruction: string;
  communicationTraits: string[];
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
  casePackage: CasePackage,
): string[] {
  const issues: string[] = [];
  const persona = casePackage.patientPersona;
  if (!isPatientPersonaTemplateId(persona.personaTemplateId)) {
    issues.push("patientPersona.personaTemplateId is invalid");
  }
  if (persona.personaTemplateVersion !== PATIENT_PERSONA_TEMPLATE_VERSION) {
    issues.push(
      `patientPersona.personaTemplateVersion must equal ${PATIENT_PERSONA_TEMPLATE_VERSION}`,
    );
  }
  if (!nonEmpty(persona.educationOrOccupation)) {
    issues.push("patientPersona.educationOrOccupation is required");
  }
  if (!nonEmpty(persona.dailyLife)) {
    issues.push("patientPersona.dailyLife is required");
  }
  if (
    !uniqueNonEmptyStrings(persona.interests) ||
    persona.interests.length > 3
  ) {
    issues.push("patientPersona.interests must contain at most 3 unique strings");
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
  casePackage: CasePackage,
): void {
  const issues = patientDialogueMetadataIssues(casePackage);
  if (issues.length > 0) throw new PatientDialogueMetadataError(issues);
}

function personaFacts(casePackage: CasePackage): PatientPersonaFact[] {
  const persona = casePackage.patientPersona;
  return [
    {
      personaFactId: "persona.scene_label",
      value: casePackage.playerVisible.patientDisplayName,
    },
    ...(casePackage.playerVisible.ageBand === undefined
      ? []
      : [{
          personaFactId: "persona.age_band",
          value: casePackage.playerVisible.ageBand,
        }]),
    ...(casePackage.playerVisible.genderDisplay === undefined
      ? []
      : [{
          personaFactId: "persona.gender",
          value: casePackage.playerVisible.genderDisplay,
        }]),
    {
      personaFactId: "persona.education_or_occupation",
      value: persona.educationOrOccupation!,
    },
    { personaFactId: "persona.daily_life", value: persona.dailyLife! },
    ...persona.interests!.map((value, index) => ({
      personaFactId: `persona.interest.${index + 1}`,
      value,
    })),
  ];
}

function patientProfile(
  casePackage: CasePackage,
  template: PatientPersonaTemplate,
): PatientProfile {
  const persona = casePackage.patientPersona;
  return {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    displayName: casePackage.playerVisible.patientDisplayName,
    ...(casePackage.playerVisible.ageBand === undefined
      ? {}
      : { ageBand: casePackage.playerVisible.ageBand }),
    ...(casePackage.playerVisible.genderDisplay === undefined
      ? {}
      : { genderDisplay: casePackage.playerVisible.genderDisplay }),
    languageStyle: persona.languageStyle,
    offTopicReminderThreshold: template.offTopicReminderThreshold,
    behaviorInstructions: [...template.behaviorInstructions],
    offTopicReminderInstruction: template.offTopicReminderInstruction,
    communicationTraits: [...persona.communicationTraits!],
    socialBackground: {
      educationOrOccupation: persona.educationOrOccupation!,
      dailyLife: persona.dailyLife!,
      interests: [...persona.interests!],
    },
    personaFacts: personaFacts(casePackage),
  };
}

export function buildSafePatientCaseView(
  casePackage: CasePackage,
  completedTests: readonly CompletedPatientTest[] = [],
): SafePatientCaseView {
  assertPatientDialogueMetadata(casePackage);
  const template = getPatientPersonaTemplate(
    casePackage.patientPersona.personaTemplateId!,
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
