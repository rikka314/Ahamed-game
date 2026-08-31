export const PATIENT_PERSONA_TEMPLATE_VERSION =
  "patient-persona-templates-v1" as const;

export const PATIENT_PERSONA_TEMPLATE_IDS = [
  "gentle_cooperative",
  "anxious_reassurance_seeking",
  "impatient_direct",
] as const;

export type PatientPersonaTemplateId =
  (typeof PATIENT_PERSONA_TEMPLATE_IDS)[number];

export interface PatientPersonaTemplate {
  templateId: PatientPersonaTemplateId;
  templateVersion: typeof PATIENT_PERSONA_TEMPLATE_VERSION;
  displayName: string;
  offTopicReminderThreshold: 1 | 2 | 3;
  behaviorInstructions: readonly string[];
  offTopicReminderInstruction: string;
}

const PERSONA_TEMPLATES: Readonly<
  Record<PatientPersonaTemplateId, PatientPersonaTemplate>
> = Object.freeze({
  gentle_cooperative: Object.freeze({
    templateId: "gentle_cooperative",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION,
    displayName: "温和配合型",
    offTopicReminderThreshold: 3,
    behaviorInstructions: Object.freeze([
      "语气温和、礼貌，愿意配合医生逐步问诊。",
      "回答保持自然，不主动一次说完全部病史。",
    ]),
    offTopicReminderInstruction:
      "连续离题达到阈值后，礼貌提醒医生尽快继续了解病情。",
  }),
  anxious_reassurance_seeking: Object.freeze({
    templateId: "anxious_reassurance_seeking",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION,
    displayName: "焦虑求安慰型",
    offTopicReminderThreshold: 2,
    behaviorInstructions: Object.freeze([
      "容易担忧，但不得夸大或补造病例中不存在的危险症状。",
      "可以自然询问情况是否严重，并希望得到安抚。",
    ]),
    offTopicReminderInstruction:
      "连续离题达到阈值后，表达焦虑并请求医生把注意力拉回病情。",
  }),
  impatient_direct: Object.freeze({
    templateId: "impatient_direct",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION,
    displayName: "急躁直接型",
    offTopicReminderThreshold: 1,
    behaviorInstructions: Object.freeze([
      "表达简短直接，但不辱骂、不威胁，也不拒绝必要问诊。",
      "不喜欢长时间闲聊，优先回答当前问题。",
    ]),
    offTopicReminderInstruction:
      "出现一轮离题后即可直接催促医生继续问诊。",
  }),
});

export function isPatientPersonaTemplateId(
  value: unknown,
): value is PatientPersonaTemplateId {
  return PATIENT_PERSONA_TEMPLATE_IDS.includes(
    value as PatientPersonaTemplateId,
  );
}

export function getPatientPersonaTemplate(
  templateId: PatientPersonaTemplateId,
): PatientPersonaTemplate {
  return structuredClone(PERSONA_TEMPLATES[templateId]);
}

export function listPatientPersonaTemplates(): PatientPersonaTemplate[] {
  return PATIENT_PERSONA_TEMPLATE_IDS.map(getPatientPersonaTemplate);
}
