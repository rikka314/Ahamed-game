import { randomUUID } from "node:crypto";

import {
  listPatientPersonaTemplates,
  PATIENT_PERSONA_TEMPLATE_IDS_V2,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplateId,
} from "../domain/patient-persona.js";
import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
  OpenAITransportResponse,
} from "../providers/openai-model-provider.js";
import type {
  E3PersonaAuditEvidence,
  E3PersonaReviewDecision,
} from "./e3-persona-benchmark.js";
import type { Phase8PatientReplySampleV1 } from "./phase8-ai-evidence.js";

export const E3_PERSONA_AI_CROSS_REVIEW_VERSION =
  "e3-persona-ai-cross-review-v1" as const;

export interface E3PersonaAuditJourney {
  runId: string;
  expectedPersonaTemplateId: PatientPersonaTemplateId;
  turns: Array<{ question: string; reply: string }>;
}

export interface E3PersonaAiCrossReview {
  schemaVersion: typeof E3_PERSONA_AI_CROSS_REVIEW_VERSION;
  reviewPolicy: "non_blocking";
  decision: E3PersonaReviewDecision;
  validations: E3PersonaAuditEvidence[];
}

export function buildE3PersonaNotRunReview(
  reason: string,
): E3PersonaAiCrossReview {
  if (reason.trim().length === 0) {
    throw new TypeError("E3 not-run review reason is required");
  }
  const roles = [
    "persona_consistency_reviewer",
    "medical_fact_boundary_reviewer",
  ] as const;
  return {
    schemaVersion: E3_PERSONA_AI_CROSS_REVIEW_VERSION,
    reviewPolicy: "non_blocking",
    decision: "not_run",
    validations: roles.map((role) => ({
      validatorId: role === "persona_consistency_reviewer"
        ? "validator.ai.e3-persona-consistency.v1"
        : "validator.ai.e3-medical-fact-boundary.v1",
      role,
      promptVersion: role === "persona_consistency_reviewer"
        ? "e3-persona-consistency-review-v2"
        : "e3-medical-fact-boundary-review-v2",
      validationRunId: `run.${role}.${randomUUID()}`,
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "skipped",
      decision: "not_run",
      assessedItems: 0,
      personaConsistencyRate: 0,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
      unknownAsAbsentErrors: 0,
      identifiedPersonaIds: [],
      findings: [reason],
    })),
  };
}

interface PersonaAssessment {
  runId: string;
  recognizedPersonaTemplateId: PatientPersonaTemplateId;
  consistentTurns: number;
  notes: string;
}

interface MedicalAssessment {
  sampleId: string;
  seriousFactError: boolean;
  diagnosisLeak: boolean;
  uncompletedTestResultLeak: boolean;
  unknownAsAbsent: boolean;
  notes: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function createAuditResponse(
  transport: OpenAIResponsesTransport,
  request: OpenAITransportRequest,
): Promise<OpenAITransportResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await transport.create(request);
      if (
        response.status === "completed" &&
        response.failureCode === undefined &&
        response.outputText.trim().length > 0
      ) {
        return response;
      }
      lastError = new Error(
        `E3 audit response did not complete: ${response.failureCode ?? response.status}`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("E3 audit response failed");
}

function personaAuditSchema(
  runIds: readonly string[],
  maximumTurns: number,
): OpenAITransportRequest["schema"] {
  return {
    name: "ahamed_e3_persona_consistency_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assessments"],
      properties: {
        assessments: {
          type: "array",
          minItems: runIds.length,
          maxItems: runIds.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "runId",
              "recognizedPersonaTemplateId",
              "consistentTurns",
              "notes",
            ],
            properties: {
              runId: { type: "string", enum: [...runIds] },
              recognizedPersonaTemplateId: {
                type: "string",
                enum: [...PATIENT_PERSONA_TEMPLATE_IDS_V2],
              },
              consistentTurns: {
                type: "integer",
                minimum: 0,
                maximum: maximumTurns,
              },
              notes: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
      },
    },
  };
}

function medicalAuditSchema(
  sampleIds: readonly string[],
): OpenAITransportRequest["schema"] {
  return {
    name: "ahamed_e3_medical_fact_boundary_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assessments"],
      properties: {
        assessments: {
          type: "array",
          minItems: sampleIds.length,
          maxItems: sampleIds.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "sampleId",
              "seriousFactError",
              "diagnosisLeak",
              "uncompletedTestResultLeak",
              "unknownAsAbsent",
              "notes",
            ],
            properties: {
              sampleId: { type: "string", enum: [...sampleIds] },
              seriousFactError: { type: "boolean" },
              diagnosisLeak: { type: "boolean" },
              uncompletedTestResultLeak: { type: "boolean" },
              unknownAsAbsent: { type: "boolean" },
              notes: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
      },
    },
  };
}

function parsePersonaAssessments(
  value: unknown,
  journeys: readonly E3PersonaAuditJourney[],
): PersonaAssessment[] {
  if (!isRecord(value) || !Array.isArray(value["assessments"])) {
    throw new Error("E3 persona audit assessments are required");
  }
  const assessments = value["assessments"];
  if (assessments.length !== journeys.length) {
    throw new Error("E3 persona audit assessment count is invalid");
  }
  const journeyById = new Map(
    journeys.map((journey) => [journey.runId, journey] as const),
  );
  const seen = new Set<string>();
  return assessments.map((assessment) => {
    if (!isRecord(assessment)) {
      throw new Error("E3 persona audit assessment must be an object");
    }
    const runId = assessment["runId"];
    const recognized = assessment["recognizedPersonaTemplateId"];
    const consistentTurns = assessment["consistentTurns"];
    const journey = isNonEmptyString(runId) ? journeyById.get(runId) : undefined;
    if (
      journey === undefined ||
      seen.has(runId as string) ||
      !PATIENT_PERSONA_TEMPLATE_IDS_V2.includes(
        recognized as PatientPersonaTemplateId,
      ) ||
      !Number.isInteger(consistentTurns) ||
      (consistentTurns as number) < 0 ||
      (consistentTurns as number) > journey.turns.length ||
      !isNonEmptyString(assessment["notes"])
    ) {
      throw new Error("E3 persona audit assessment is invalid or drifted");
    }
    seen.add(runId as string);
    return {
      runId: runId as string,
      recognizedPersonaTemplateId: recognized as PatientPersonaTemplateId,
      consistentTurns: consistentTurns as number,
      notes: assessment["notes"] as string,
    };
  });
}

function parseMedicalAssessments(
  value: unknown,
  samples: readonly Phase8PatientReplySampleV1[],
): MedicalAssessment[] {
  if (!isRecord(value) || !Array.isArray(value["assessments"])) {
    throw new Error("E3 medical audit assessments are required");
  }
  const assessments = value["assessments"];
  if (assessments.length !== samples.length) {
    throw new Error("E3 medical audit assessment count is invalid");
  }
  const expectedIds = new Set(samples.map(({ sampleId }) => sampleId));
  const seen = new Set<string>();
  return assessments.map((assessment) => {
    if (!isRecord(assessment)) {
      throw new Error("E3 medical audit assessment must be an object");
    }
    const sampleId = assessment["sampleId"];
    if (
      !isNonEmptyString(sampleId) ||
      !expectedIds.has(sampleId) ||
      seen.has(sampleId) ||
      typeof assessment["seriousFactError"] !== "boolean" ||
      typeof assessment["diagnosisLeak"] !== "boolean" ||
      typeof assessment["uncompletedTestResultLeak"] !== "boolean" ||
      typeof assessment["unknownAsAbsent"] !== "boolean" ||
      !isNonEmptyString(assessment["notes"])
    ) {
      throw new Error("E3 medical audit assessment is invalid or drifted");
    }
    seen.add(sampleId);
    return {
      sampleId,
      seriousFactError: assessment["seriousFactError"] as boolean,
      diagnosisLeak: assessment["diagnosisLeak"] as boolean,
      uncompletedTestResultLeak:
        assessment["uncompletedTestResultLeak"] as boolean,
      unknownAsAbsent: assessment["unknownAsAbsent"] as boolean,
      notes: assessment["notes"] as string,
    };
  });
}

function failedValidation(
  role: E3PersonaAuditEvidence["role"],
  error: unknown,
): E3PersonaAuditEvidence {
  return {
    validatorId: role === "persona_consistency_reviewer"
      ? "validator.ai.e3-persona-consistency.v1"
      : "validator.ai.e3-medical-fact-boundary.v1",
    role,
    promptVersion: role === "persona_consistency_reviewer"
      ? "e3-persona-consistency-review-v2"
      : "e3-medical-fact-boundary-review-v2",
    validationRunId: `run.${role}.${randomUUID()}`,
    isolation: {
      independentInvocation: true,
      counterpartOutputVisible: false,
    },
    runStatus: "failed_to_run",
    decision: "not_run",
    assessedItems: 0,
    personaConsistencyRate: 0,
    seriousFactErrors: 0,
    diagnosisLeaks: 0,
    uncompletedTestResultLeaks: 0,
    unknownAsAbsentErrors: 0,
    identifiedPersonaIds: [],
    findings: [
      error instanceof Error ? error.message : "E3 AI audit failed to run",
    ],
  };
}

export async function generateE3PersonaAiCrossReview(input: {
  journeys: readonly E3PersonaAuditJourney[];
  samples: readonly Phase8PatientReplySampleV1[];
  transport: OpenAIResponsesTransport;
  modelId: string;
  expectedActualModelId?: string;
  batchSize?: number;
  runId?: (role: E3PersonaAuditEvidence["role"]) => string;
}): Promise<E3PersonaAiCrossReview> {
  if (
    input.journeys.length !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length ||
    new Set(input.journeys.map(({ runId }) => runId)).size !==
      input.journeys.length ||
    new Set(
      input.journeys.map(({ expectedPersonaTemplateId }) =>
        expectedPersonaTemplateId
      ),
    ).size !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length ||
    input.journeys.some(({ turns }) => turns.length < 12) ||
    input.samples.length < 72 ||
    new Set(input.samples.map(({ sampleId }) => sampleId)).size !==
      input.samples.length
  ) {
    throw new TypeError("E3 AI audit input coverage is invalid");
  }
  const batchSize = input.batchSize ?? 20;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new TypeError("E3 AI audit batchSize must be between 1 and 50");
  }
  const runId = input.runId ??
    ((role: E3PersonaAuditEvidence["role"]) => `run.${role}.${randomUUID()}`);
  const validations: E3PersonaAuditEvidence[] = [];

  try {
    const response = await createAuditResponse(input.transport, {
      operationId: `e3-persona-review-${randomUUID()}`,
      clientRequestId: "e3_persona_consistency_review",
      role: "review",
      modelId: input.modelId,
      instructions:
        "你是隔离运行的 Persona Consistency Reviewer。根据六种人格目录，对六条匿名完整旅程逐一识别最符合的人格，并统计每条旅程中符合该人格且仍保持患者角色的轮数。人格是一整段对话的主导倾向，不要求每一轮都出现标志性措辞；正常回答医学问题、简短确认检查或自然闲聊不应被判为人格丢失。只根据实际回复判断，不得假设 runId 暗示人格；你看不到 Medical Fact Boundary Reviewer 的任何输出。",
      input: JSON.stringify({
        schemaVersion: "e3-persona-consistency-review-input-v1",
        personaCatalog: listPatientPersonaTemplates(
          PATIENT_PERSONA_TEMPLATE_VERSION_V2,
        ).map((template) => ({
          personaTemplateId: template.templateId,
          behaviorInstructions: template.behaviorInstructions,
          offTopicReminderThreshold: template.offTopicReminderThreshold,
          offTopicReminderInstruction: template.offTopicReminderInstruction,
        })),
        journeys: input.journeys.map((journey) => ({
          runId: journey.runId,
          turns: journey.turns,
        })),
      }),
      schema: personaAuditSchema(
        input.journeys.map(({ runId: id }) => id),
        Math.max(...input.journeys.map(({ turns }) => turns.length)),
      ),
      store: false,
      timeoutMs: 300_000,
      maxOutputTokens: 6_000,
    });
    if (
      input.expectedActualModelId !== undefined &&
      response.modelId !== input.expectedActualModelId
    ) {
      throw new Error("E3 persona audit actual model ID drifted");
    }
    const assessments = parsePersonaAssessments(
      JSON.parse(response.outputText) as unknown,
      input.journeys,
    );
    const journeyById = new Map(
      input.journeys.map((journey) => [journey.runId, journey] as const),
    );
    const identifiedPersonaIds = assessments.flatMap((assessment) => {
      const expected = journeyById.get(assessment.runId)!
        .expectedPersonaTemplateId;
      return assessment.recognizedPersonaTemplateId === expected
        ? [expected]
        : [];
    });
    const consistentTurns = assessments.reduce(
      (sum, assessment) => sum + assessment.consistentTurns,
      0,
    );
    const totalTurns = input.journeys.reduce(
      (sum, journey) => sum + journey.turns.length,
      0,
    );
    const personaConsistencyRate = consistentTurns / totalTurns;
    const decision =
      personaConsistencyRate >= 0.95 &&
        new Set(identifiedPersonaIds).size ===
          PATIENT_PERSONA_TEMPLATE_IDS_V2.length
        ? "approved"
        : "revision_recommended";
    validations.push({
      validatorId: "validator.ai.e3-persona-consistency.v1",
      role: "persona_consistency_reviewer",
      modelId: response.modelId,
      promptVersion: "e3-persona-consistency-review-v2",
      validationRunId: runId("persona_consistency_reviewer"),
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "completed",
      decision,
      assessedItems: assessments.length,
      personaConsistencyRate,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
      unknownAsAbsentErrors: 0,
      identifiedPersonaIds,
      findings: assessments
        .filter((assessment) => {
          const journey = journeyById.get(assessment.runId)!;
          return assessment.recognizedPersonaTemplateId !==
              journey.expectedPersonaTemplateId ||
            assessment.consistentTurns < journey.turns.length;
        })
        .map((assessment) => `${assessment.runId}: ${assessment.notes}`),
    });
  } catch (error) {
    validations.push(failedValidation("persona_consistency_reviewer", error));
  }

  try {
    const assessments: MedicalAssessment[] = [];
    let actualModelId: string | undefined;
    for (let offset = 0; offset < input.samples.length; offset += batchSize) {
      const batch = input.samples.slice(offset, offset + batchSize);
      const response = await createAuditResponse(input.transport, {
        operationId: `e3-medical-boundary-${offset}-${randomUUID()}`,
        clientRequestId: `e3_medical_fact_boundary_${offset}`,
        role: "review",
        modelId: input.modelId,
        instructions:
          "你是隔离运行的 Medical Fact Boundary Reviewer。逐条核对患者回复中的医学事实、明确身份锚点和检查结果是否来自 authorizedFacts、authorizedPersonaFacts、authorizedTestReports 与 authorizedTests。social_chat 可以围绕已有身份、兴趣或日常背景自然补充不影响诊断的普通生活细节；合理的地点、活动方式或泛化偏好不属于医学事实，也不应算 seriousFactError。检查有临床意义的新增或矛盾医学事实、标准诊断泄漏、未完成检查结果泄漏，以及把 unknown 事实说成明确没有或正常；轻微同义改述、非矛盾概括、疑问句和纯情绪不属于严重医学错误。你看不到 Persona Consistency Reviewer 的任何输出，不得把风格差异当作医学错误。",
        input: JSON.stringify({
          schemaVersion: "e3-medical-fact-boundary-review-input-v1",
          samples: batch,
        }),
        schema: medicalAuditSchema(batch.map(({ sampleId }) => sampleId)),
        store: false,
        timeoutMs: 300_000,
        maxOutputTokens: Math.min(12_000, Math.max(2_000, batch.length * 300)),
      });
      if (
        (input.expectedActualModelId !== undefined &&
          response.modelId !== input.expectedActualModelId) ||
        (actualModelId !== undefined && response.modelId !== actualModelId)
      ) {
        throw new Error("E3 medical audit actual model ID drifted");
      }
      actualModelId ??= response.modelId;
      assessments.push(
        ...parseMedicalAssessments(
          JSON.parse(response.outputText) as unknown,
          batch,
        ),
      );
    }
    const seriousFactErrors = assessments.filter(
      ({ seriousFactError }) => seriousFactError,
    ).length;
    const diagnosisLeaks = assessments.filter(
      ({ diagnosisLeak }) => diagnosisLeak,
    ).length;
    const uncompletedTestResultLeaks = assessments.filter(
      ({ uncompletedTestResultLeak }) => uncompletedTestResultLeak,
    ).length;
    const unknownAsAbsentErrors = assessments.filter(
      ({ unknownAsAbsent }) => unknownAsAbsent,
    ).length;
    const decision =
      seriousFactErrors === 0 &&
        diagnosisLeaks === 0 &&
        uncompletedTestResultLeaks === 0 &&
        unknownAsAbsentErrors === 0
        ? "approved"
        : "rejected";
    validations.push({
      validatorId: "validator.ai.e3-medical-fact-boundary.v1",
      role: "medical_fact_boundary_reviewer",
      ...(actualModelId === undefined ? {} : { modelId: actualModelId }),
      promptVersion: "e3-medical-fact-boundary-review-v2",
      validationRunId: runId("medical_fact_boundary_reviewer"),
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "completed",
      decision,
      assessedItems: assessments.length,
      personaConsistencyRate: 1,
      seriousFactErrors,
      diagnosisLeaks,
      uncompletedTestResultLeaks,
      unknownAsAbsentErrors,
      identifiedPersonaIds: [],
      findings: assessments
        .filter((assessment) =>
          assessment.seriousFactError ||
          assessment.diagnosisLeak ||
          assessment.uncompletedTestResultLeak ||
          assessment.unknownAsAbsent
        )
        .map((assessment) => `${assessment.sampleId}: ${assessment.notes}`),
    });
  } catch (error) {
    validations.push(
      failedValidation("medical_fact_boundary_reviewer", error),
    );
  }

  const completed = validations.filter(
    ({ runStatus }) => runStatus === "completed",
  );
  const decision: E3PersonaReviewDecision = completed.length === 0
    ? "not_run"
    : validations.some(({ decision }) => decision === "rejected")
    ? "rejected"
    : validations.every(({ decision }) => decision === "approved")
    ? "approved"
    : "revision_recommended";
  return {
    schemaVersion: E3_PERSONA_AI_CROSS_REVIEW_VERSION,
    reviewPolicy: "non_blocking",
    decision,
    validations,
  };
}
