import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { computeCaseContentHash } from "../src/domain/case-content-hash.js";
import {
  assertCasePackage,
  type CasePackage,
} from "../src/domain/case-package.js";
import { assertCasePackageJsonSchema } from "../src/domain/case-package-schema.js";
import { listPatientPersonaTemplates } from "../src/domain/patient-persona.js";
import {
  assertPatientDialogueMetadata,
  buildSafePatientCaseView,
  patientDialogueMetadataIssues,
  PatientDialogueMetadataError,
} from "../src/domain/safe-patient-case-view.js";

const DRAFT_CASE_PATHS = [
  "cases/draft/c01-common-cold-v1.json",
  "cases/draft/c02-influenza-v1.json",
  "cases/draft/c03-acute-pharyngitis-v1.json",
  "cases/draft/c04-acute-bronchitis-v1.json",
  "cases/draft/c05-mild-cap-v1.json",
] as const;

function loadCase(path: string): CasePackage {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertCasePackageJsonSchema(value);
  assertCasePackage(value);
  return value;
}

test("all five dialogue candidates validate their persona, test aliases, and canonical hash", () => {
  const cases = DRAFT_CASE_PATHS.map(loadCase);
  for (const casePackage of cases) {
    assert.doesNotThrow(() => assertPatientDialogueMetadata(casePackage));
    assert.equal(
      casePackage.provenance.contentHash,
      computeCaseContentHash(casePackage),
    );
  }
  assert.deepEqual(
    cases.map(({ patientPersona }) => patientPersona.personaTemplateId),
    [
      "gentle_cooperative",
      "anxious_reassurance_seeking",
      "impatient_direct",
      "gentle_cooperative",
      "anxious_reassurance_seeking",
    ],
  );
});

test("persona registry returns defensive copies of all three templates", () => {
  const templates = listPatientPersonaTemplates();
  assert.deepEqual(
    templates.map(({ templateId, offTopicReminderThreshold }) => ({
      templateId,
      offTopicReminderThreshold,
    })),
    [
      { templateId: "gentle_cooperative", offTopicReminderThreshold: 3 },
      { templateId: "anxious_reassurance_seeking", offTopicReminderThreshold: 2 },
      { templateId: "impatient_direct", offTopicReminderThreshold: 1 },
    ],
  );
  (templates[0]!.behaviorInstructions as string[])[0] = "mutated test value";
  assert.notEqual(
    listPatientPersonaTemplates()[0]!.behaviorInstructions[0],
    "mutated test value",
  );
});

test("dialogue metadata reports every malformed persona and test field", () => {
  const malformed = structuredClone(loadCase(DRAFT_CASE_PATHS[0]));
  malformed.patientPersona.personaTemplateId = "unsupported" as never;
  malformed.patientPersona.personaTemplateVersion = "obsolete" as never;
  malformed.patientPersona.educationOrOccupation = "";
  malformed.patientPersona.dailyLife = "";
  malformed.patientPersona.interests = ["music", "music"];
  malformed.patientPersona.communicationTraits = ["brief", "brief"];
  malformed.medicalTests["test.vital_signs"]!.displayName = "";
  malformed.medicalTests["test.vital_signs"]!.aliases = [];

  const issues = patientDialogueMetadataIssues(malformed);
  assert.ok(issues.some((issue) => issue.includes("personaTemplateId")));
  assert.ok(issues.some((issue) => issue.includes("personaTemplateVersion")));
  assert.ok(issues.some((issue) => issue.includes("educationOrOccupation")));
  assert.ok(issues.some((issue) => issue.includes("dailyLife")));
  assert.ok(issues.some((issue) => issue.includes("interests")));
  assert.ok(issues.some((issue) => issue.includes("communicationTraits")));
  assert.ok(issues.some((issue) => issue.includes("displayName")));
  assert.ok(issues.some((issue) => issue.includes("aliases")));
  assert.throws(
    () => assertPatientDialogueMetadata(malformed),
    PatientDialogueMetadataError,
  );

  const tooManyInterests = structuredClone(loadCase(DRAFT_CASE_PATHS[0]));
  tooManyInterests.patientPersona.interests = ["a", "b", "c", "d"];
  assert.ok(
    patientDialogueMetadataIssues(tooManyInterests).some((issue) =>
      issue.includes("interests")
    ),
  );
});

test("safe patient view excludes hidden truth and uncompleted test reports", () => {
  const casePackage = loadCase(DRAFT_CASE_PATHS[0]);
  const view = buildSafePatientCaseView(casePackage);
  const serialized = JSON.stringify(view);

  assert.equal(view.patientProfile.templateId, "gentle_cooperative");
  assert.equal(view.patientProfile.offTopicReminderThreshold, 3);
  assert.ok(
    view.facts.every(({ disclosure }) =>
      ["spontaneous", "if_asked"].includes(disclosure),
    ),
  );
  assert.ok(view.tests.every(({ status }) => status === "not_completed"));
  assert.ok(view.tests.every((definition) => definition.report === undefined));
  assert.ok(!serialized.includes(casePackage.answerKey.targetDiagnosis));
  assert.ok(!serialized.includes(casePackage.rubric.communicationRubricVersion));
  assert.ok(!serialized.includes("服务端教学与评分字段"));
  assert.ok(!serialized.includes(casePackage.medicalTests["test.vital_signs"]!.report!));
});

test("safe patient view exposes only reports for tests completed in the session", () => {
  const casePackage = loadCase(DRAFT_CASE_PATHS[0]);
  const report = casePackage.medicalTests["test.vital_signs"]!.report!;
  const view = buildSafePatientCaseView(casePackage, [
    { testId: "test.vital_signs", status: "completed", report },
  ]);

  assert.deepEqual(
    view.tests.map(({ testId, status }) => ({ testId, status })),
    [
      { testId: "test.vital_signs", status: "completed" },
      { testId: "test.complete_blood_count", status: "not_completed" },
      { testId: "test.chest_xray", status: "not_completed" },
      { testId: "test.chest_ct", status: "not_completed" },
    ],
  );
  assert.equal(view.tests[0]!.report, report);
  assert.equal(view.tests[1]!.report, undefined);
});

test("safe patient view handles unavailable tests and canonical report fallback", () => {
  const casePackage = loadCase(DRAFT_CASE_PATHS[0]);
  casePackage.medicalTests["test.chest_xray"]!.status = "unavailable";
  const view = buildSafePatientCaseView(casePackage, [
    { testId: "test.vital_signs", status: "completed" },
  ]);

  assert.equal(
    view.tests.find(({ testId }) => testId === "test.vital_signs")?.report,
    casePackage.medicalTests["test.vital_signs"]!.report,
  );
  assert.deepEqual(
    view.tests.find(({ testId }) => testId === "test.chest_xray"),
    {
      testId: "test.chest_xray",
      displayName: "胸部X线",
      aliases: ["胸片", "拍胸片", "胸部X光", "X线"],
      status: "unavailable",
    },
  );
});
