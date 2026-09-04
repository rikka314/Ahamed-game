export const PATIENT_PERSONA_TEMPLATE_VERSION_V1 =
  "patient-persona-templates-v1" as const;
export const PATIENT_PERSONA_TEMPLATE_VERSION_V2 =
  "patient-persona-templates-v2" as const;

/** Current authoring version. V1 remains available only for legacy cases. */
export const PATIENT_PERSONA_TEMPLATE_VERSION =
  PATIENT_PERSONA_TEMPLATE_VERSION_V2;

export const PATIENT_PERSONA_TEMPLATE_IDS_V1 = [
  "gentle_cooperative",
  "anxious_reassurance_seeking",
  "impatient_direct",
] as const;

export const PATIENT_PERSONA_TEMPLATE_IDS_V2 = [
  ...PATIENT_PERSONA_TEMPLATE_IDS_V1,
  "talkative_digressive",
  "accommodating_minimizing",
  "guarded_questioning",
] as const;

export const PATIENT_PERSONA_TEMPLATE_IDS = PATIENT_PERSONA_TEMPLATE_IDS_V2;

export type PatientPersonaTemplateVersion =
  | typeof PATIENT_PERSONA_TEMPLATE_VERSION_V1
  | typeof PATIENT_PERSONA_TEMPLATE_VERSION_V2;
export type PatientPersonaTemplateIdV1 =
  (typeof PATIENT_PERSONA_TEMPLATE_IDS_V1)[number];
export type PatientPersonaTemplateIdV2 =
  (typeof PATIENT_PERSONA_TEMPLATE_IDS_V2)[number];
export type PatientPersonaTemplateId = PatientPersonaTemplateIdV2;

export interface PatientPersonaTemplate {
  templateId: PatientPersonaTemplateId;
  templateVersion: PatientPersonaTemplateVersion;
  displayName: string;
  offTopicReminderThreshold: 1 | 2 | 3;
  behaviorInstructions: readonly string[];
  offTopicReminderInstruction: string;
}

type PersonaRegistry = Readonly<
  Partial<Record<PatientPersonaTemplateId, PatientPersonaTemplate>>
>;

const SHARED_TEMPLATES = Object.freeze({
  gentle_cooperative: Object.freeze({
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
    displayName: "急躁直接型",
    offTopicReminderThreshold: 1,
    behaviorInstructions: Object.freeze([
      "表达简短直接，但不辱骂、不威胁，也不拒绝必要问诊。",
      "不喜欢长时间闲聊，优先回答当前问题。",
    ]),
    offTopicReminderInstruction:
      "出现一轮离题后即可直接催促医生继续问诊。",
  }),
} as const);

function sharedTemplate(
  templateId: PatientPersonaTemplateIdV1,
  templateVersion: PatientPersonaTemplateVersion,
): PatientPersonaTemplate {
  return Object.freeze({
    templateId,
    templateVersion,
    ...SHARED_TEMPLATES[templateId],
  });
}

const PERSONA_TEMPLATES_V1: PersonaRegistry = Object.freeze({
  gentle_cooperative: sharedTemplate(
    "gentle_cooperative",
    PATIENT_PERSONA_TEMPLATE_VERSION_V1,
  ),
  anxious_reassurance_seeking: sharedTemplate(
    "anxious_reassurance_seeking",
    PATIENT_PERSONA_TEMPLATE_VERSION_V1,
  ),
  impatient_direct: sharedTemplate(
    "impatient_direct",
    PATIENT_PERSONA_TEMPLATE_VERSION_V1,
  ),
});

const PERSONA_TEMPLATES_V2: PersonaRegistry = Object.freeze({
  gentle_cooperative: sharedTemplate(
    "gentle_cooperative",
    PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  ),
  anxious_reassurance_seeking: sharedTemplate(
    "anxious_reassurance_seeking",
    PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  ),
  impatient_direct: sharedTemplate(
    "impatient_direct",
    PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  ),
  talkative_digressive: Object.freeze({
    templateId: "talkative_digressive",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION_V2,
    displayName: "话多发散型",
    offTopicReminderThreshold: 3,
    behaviorInstructions: Object.freeze([
      "可以加入较多非医学生活细节并自然绕开主题。",
      "医生明确询问医学事实时必须按病例真值回答，不得用发散回避。",
    ]),
    offTopicReminderInstruction:
      "连续离题达到阈值后，用较自然的过渡把话题带回本次不适。",
  }),
  accommodating_minimizing: Object.freeze({
    templateId: "accommodating_minimizing",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION_V2,
    displayName: "迎合淡化型",
    offTopicReminderThreshold: 2,
    behaviorInstructions: Object.freeze([
      "措辞可以显得随和并弱化主观困扰，但不得改变任何医学事实真值。",
      "不得把存在的事实说成不存在，也不得淡化安全红旗。",
    ]),
    offTopicReminderInstruction:
      "连续离题达到阈值后，温和顺着医生的话把注意力拉回病情。",
  }),
  guarded_questioning: Object.freeze({
    templateId: "guarded_questioning",
    templateVersion: PATIENT_PERSONA_TEMPLATE_VERSION_V2,
    displayName: "戒备质疑型",
    offTopicReminderThreshold: 2,
    behaviorInstructions: Object.freeze([
      "可以追问为什么要询问某项信息或进行某项检查。",
      "不得无理由拒绝必要问诊、改变事实或进行敌意攻击。",
    ]),
    offTopicReminderInstruction:
      "连续离题达到阈值后，带着质疑但不敌对地要求说明问诊方向。",
  }),
});

function registryForVersion(
  version: PatientPersonaTemplateVersion,
): PersonaRegistry {
  return version === PATIENT_PERSONA_TEMPLATE_VERSION_V1
    ? PERSONA_TEMPLATES_V1
    : PERSONA_TEMPLATES_V2;
}

export function isPatientPersonaTemplateVersion(
  value: unknown,
): value is PatientPersonaTemplateVersion {
  return value === PATIENT_PERSONA_TEMPLATE_VERSION_V1 ||
    value === PATIENT_PERSONA_TEMPLATE_VERSION_V2;
}

export function isPatientPersonaTemplateId(
  value: unknown,
  version: PatientPersonaTemplateVersion = PATIENT_PERSONA_TEMPLATE_VERSION,
): value is PatientPersonaTemplateId {
  return typeof value === "string" &&
    registryForVersion(version)[value as PatientPersonaTemplateId] !== undefined;
}

export function getPatientPersonaTemplate(
  templateId: PatientPersonaTemplateId,
  version: PatientPersonaTemplateVersion = PATIENT_PERSONA_TEMPLATE_VERSION,
): PatientPersonaTemplate {
  const template = registryForVersion(version)[templateId];
  if (template === undefined) {
    throw new TypeError(
      `Persona template ${templateId} is unavailable in ${version}.`,
    );
  }
  return structuredClone(template);
}

export function listPatientPersonaTemplates(
  version: PatientPersonaTemplateVersion = PATIENT_PERSONA_TEMPLATE_VERSION,
): PatientPersonaTemplate[] {
  const ids = version === PATIENT_PERSONA_TEMPLATE_VERSION_V1
    ? PATIENT_PERSONA_TEMPLATE_IDS_V1
    : PATIENT_PERSONA_TEMPLATE_IDS_V2;
  return ids.map((templateId) => getPatientPersonaTemplate(templateId, version));
}
