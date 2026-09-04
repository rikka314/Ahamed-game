import {
  getPatientPersonaTemplate,
  PATIENT_PERSONA_TEMPLATE_IDS_V2,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplateId,
} from "../domain/patient-persona.js";

export const E3_PERSONA_RULE_CORPUS_VERSION =
  "e3-persona-rule-corpus-v1" as const;
export const E3_PERSONA_BENCHMARK_REPORT_VERSION =
  "e3-persona-benchmark-report-v2" as const;

export const E3_PERSONA_SCENARIO_IDS = [
  "greeting",
  "chief_complaint",
  "onset",
  "multiple_questions",
  "repeated_question",
  "ambiguous_reference",
  "consecutive_off_topic",
  "reassurance_and_emotion",
  "questioning_a_test",
  "unknown_fact",
  "explicit_test_order",
  "diagnosis_discussion_without_submission",
] as const;

export type E3PersonaScenarioId =
  (typeof E3_PERSONA_SCENARIO_IDS)[number];

export interface E3PersonaScenario {
  readonly scenarioId: E3PersonaScenarioId;
  readonly displayName: string;
  readonly userTurns: readonly string[];
  readonly expectedBehavior: string;
}

const RAW_E3_PERSONA_SCENARIOS: readonly E3PersonaScenario[] = [
  {
    scenarioId: "greeting",
    displayName: "问候",
    userTurns: ["你好，我们先简单认识一下。"],
    expectedBehavior: "以患者身份自然回应问候，不泄露病情答案或系统设定。",
  },
  {
    scenarioId: "chief_complaint",
    displayName: "直接询问主诉",
    userTurns: ["你今天最主要哪里不舒服？"],
    expectedBehavior: "直接回答主诉，只使用允许主动披露或本轮询问命中的事实。",
  },
  {
    scenarioId: "onset",
    displayName: "追问起病",
    userTurns: ["这些不舒服是什么时候开始的？"],
    expectedBehavior: "回答起病时间并保持病例时间线不变。",
  },
  {
    scenarioId: "multiple_questions",
    displayName: "多问题",
    userTurns: ["鼻涕是什么样的，嗓子和咳嗽怎么样，有没有发烧？"],
    expectedBehavior: "逐项回应可回答的问题，不用人格风格回避明确医学询问。",
  },
  {
    scenarioId: "repeated_question",
    displayName: "重复询问",
    userTurns: ["我再确认一次，具体是什么时候开始的？"],
    expectedBehavior: "重复回答应与此前起病时间一致，可以自然改述但不能改变真值。",
  },
  {
    scenarioId: "ambiguous_reference",
    displayName: "模糊指代",
    userTurns: ["刚才说的那个现在还明显吗？"],
    expectedBehavior: "结合完整已提交历史理解最近指代；不确定时先澄清而不是编造。",
  },
  {
    scenarioId: "consecutive_off_topic",
    displayName: "连续离题",
    userTurns: [
      "我们先聊聊学校生活吧。",
      "你最近听了什么音乐？",
      "先别说病情，散步时一般去哪里？",
    ],
    expectedBehavior: "连续离题达到该人格阈值后，按模板方式把对话带回本次病情。",
  },
  {
    scenarioId: "reassurance_and_emotion",
    displayName: "安慰与情绪回应",
    userTurns: ["在这个虚构病例里，听起来这两天让你挺难受的，我会慢慢了解。"],
    expectedBehavior: "以人格对应的情绪强度回应安慰，不增加新的症状或危险征象。",
  },
  {
    scenarioId: "questioning_a_test",
    displayName: "质疑检查",
    userTurns: ["如果建议做胸部 CT，你会担心这个检查吗？"],
    expectedBehavior: "可以按人格表达疑问或顾虑，但不能声称检查已经完成或透露结果。",
  },
  {
    scenarioId: "unknown_fact",
    displayName: "询问 unknown 事实",
    userTurns: ["最近接触过有类似症状的人吗？不确定就直接说不确定。"],
    expectedBehavior: "对 unknown 事实表达不知道、没注意或不确定，不能说成明确不存在。",
  },
  {
    scenarioId: "explicit_test_order",
    displayName: "明确申请检查",
    userTurns: ["我现在明确给你申请胸部 CT 检查。"],
    expectedBehavior: "识别检查申请或确认需要，不在检查完成前透露任何检查结果。",
  },
  {
    scenarioId: "diagnosis_discussion_without_submission",
    displayName: "讨论诊断但未明确提交",
    userTurns: ["我在考虑普通感冒或流感，但目前还没有最终结论，你怎么看？"],
    expectedBehavior: "把不确定的诊断讨论留在问诊中，不替医生提交诊断或泄露标准答案。",
  },
];

export const E3_PERSONA_SCENARIOS: readonly E3PersonaScenario[] = Object.freeze(
  RAW_E3_PERSONA_SCENARIOS.map((scenario) =>
    Object.freeze({
      ...scenario,
      userTurns: Object.freeze([...scenario.userTurns]),
    })
  ),
);

export interface E3PersonaMedicalInvariants {
  factTruthUnchanged: true;
  testStateUnchanged: true;
  diagnosisHidden: true;
  uncompletedTestResultHidden: true;
  unknownRemainsUnknown: true;
}

export interface E3PersonaRuleAssertion {
  assertionId: string;
  personaTemplateId: PatientPersonaTemplateId;
  scenarioId: E3PersonaScenarioId;
  expectedBehaviors: string[];
  prohibitedBehaviors: string[];
  medicalInvariants: E3PersonaMedicalInvariants;
}

export interface E3PersonaRuleCorpus {
  schemaVersion: typeof E3_PERSONA_RULE_CORPUS_VERSION;
  personaTemplateVersion: typeof PATIENT_PERSONA_TEMPLATE_VERSION_V2;
  personaCount: number;
  scenarioCount: number;
  assertionCount: number;
  minimumCommittedTurnsPerPersona: number;
  scenarios: E3PersonaScenario[];
  assertions: E3PersonaRuleAssertion[];
}

const PROHIBITED_BEHAVIORS = Object.freeze([
  "不得改变任何 patientFacts 的 status、value 或 disclosure。",
  "不得把 unknown 事实回答为明确没有或正常。",
  "不得泄露标准诊断、隐藏事实或未完成检查结果。",
  "不得让人格改变检查状态、答案、rubric 或诊断提交语义。",
]);

export function buildE3PersonaRuleCorpus(): E3PersonaRuleCorpus {
  const assertions = PATIENT_PERSONA_TEMPLATE_IDS_V2.flatMap(
    (personaTemplateId) => {
      const template = getPatientPersonaTemplate(
        personaTemplateId,
        PATIENT_PERSONA_TEMPLATE_VERSION_V2,
      );
      return E3_PERSONA_SCENARIOS.map((scenario) => ({
        assertionId: `e3.persona.${personaTemplateId}.${scenario.scenarioId}`,
        personaTemplateId,
        scenarioId: scenario.scenarioId,
        expectedBehaviors: [
          ...template.behaviorInstructions,
          template.offTopicReminderInstruction,
          scenario.expectedBehavior,
        ],
        prohibitedBehaviors: [...PROHIBITED_BEHAVIORS],
        medicalInvariants: {
          factTruthUnchanged: true,
          testStateUnchanged: true,
          diagnosisHidden: true,
          uncompletedTestResultHidden: true,
          unknownRemainsUnknown: true,
        },
      } satisfies E3PersonaRuleAssertion));
    },
  );
  const corpus: E3PersonaRuleCorpus = {
    schemaVersion: E3_PERSONA_RULE_CORPUS_VERSION,
    personaTemplateVersion: PATIENT_PERSONA_TEMPLATE_VERSION_V2,
    personaCount: PATIENT_PERSONA_TEMPLATE_IDS_V2.length,
    scenarioCount: E3_PERSONA_SCENARIOS.length,
    assertionCount: assertions.length,
    minimumCommittedTurnsPerPersona: E3_PERSONA_SCENARIOS.reduce(
      (sum, scenario) => sum + scenario.userTurns.length,
      0,
    ),
    scenarios: E3_PERSONA_SCENARIOS.map((scenario) => structuredClone(scenario)),
    assertions,
  };
  assertE3PersonaRuleCorpus(corpus);
  return corpus;
}

export function assertE3PersonaRuleCorpus(
  corpus: E3PersonaRuleCorpus,
): void {
  const expectedAssertionCount =
    PATIENT_PERSONA_TEMPLATE_IDS_V2.length * E3_PERSONA_SCENARIOS.length;
  if (
    corpus.schemaVersion !== E3_PERSONA_RULE_CORPUS_VERSION ||
    corpus.personaTemplateVersion !== PATIENT_PERSONA_TEMPLATE_VERSION_V2 ||
    corpus.personaCount !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length ||
    corpus.scenarioCount !== E3_PERSONA_SCENARIOS.length ||
    corpus.assertionCount !== expectedAssertionCount ||
    corpus.assertions.length !== expectedAssertionCount ||
    corpus.minimumCommittedTurnsPerPersona < 12
  ) {
    throw new TypeError("E3 persona rule corpus coverage is invalid");
  }
  const assertionIds = new Set(
    corpus.assertions.map(({ assertionId }) => assertionId),
  );
  if (assertionIds.size !== corpus.assertions.length) {
    throw new TypeError("E3 persona rule assertion IDs must be unique");
  }
  for (const personaTemplateId of PATIENT_PERSONA_TEMPLATE_IDS_V2) {
    const personaAssertions = corpus.assertions.filter(
      (assertion) => assertion.personaTemplateId === personaTemplateId,
    );
    const scenarioIds = new Set(
      personaAssertions.map(({ scenarioId }) => scenarioId),
    );
    if (
      personaAssertions.length !== E3_PERSONA_SCENARIOS.length ||
      E3_PERSONA_SCENARIO_IDS.some((scenarioId) => !scenarioIds.has(scenarioId))
    ) {
      throw new TypeError(
        `E3 persona ${personaTemplateId} does not cover all scenarios`,
      );
    }
  }
}

export interface E3ScenarioMedicalReference {
  scenarioId: E3PersonaScenarioId;
  questionOrdinal: number;
  factIds: string[];
  testStates: string[];
}

export interface E3PersonaRunEvidence {
  runId: string;
  personaTemplateId: PatientPersonaTemplateId;
  status: "completed" | "failed" | "not_run";
  anchorPublicCaseId: string;
  anchorCaseVersion: string;
  medicalContentDigest: string;
  variantContentHash: string;
  committedTurns: number;
  fullHistoryTurns: number;
  patientGeneratedReplies: number;
  patientProviderCalls: number;
  controllerProviderCalls: number;
  localFakeReplies: number;
  diagnosisLeaks: number;
  uncompletedTestResultLeaks: number;
  scenarioMedicalReferences: E3ScenarioMedicalReference[];
  failureCode?: string;
}

export type E3PersonaAuditRole =
  | "persona_consistency_reviewer"
  | "medical_fact_boundary_reviewer";

export type E3PersonaReviewDecision =
  | "approved"
  | "revision_recommended"
  | "rejected"
  | "not_run";

export interface E3PersonaAuditEvidence {
  validatorId: string;
  role: E3PersonaAuditRole;
  modelId?: string;
  promptVersion: string;
  validationRunId: string;
  isolation: {
    independentInvocation: true;
    counterpartOutputVisible: false;
  };
  runStatus: "completed" | "failed_to_run" | "skipped";
  decision: E3PersonaReviewDecision;
  assessedItems: number;
  personaConsistencyRate: number;
  seriousFactErrors: number;
  diagnosisLeaks: number;
  uncompletedTestResultLeaks: number;
  unknownAsAbsentErrors: number;
  identifiedPersonaIds: PatientPersonaTemplateId[];
  findings: string[];
}

export type E3PersonaFindingCode =
  | "RULE_ASSERTION_COVERAGE_BELOW_TARGET"
  | "RULE_PERSONA_OR_SCENARIO_COVERAGE_MISMATCH"
  | "REAL_PERSONA_COVERAGE_MISMATCH"
  | "COMMITTED_TURNS_BELOW_TARGET"
  | "FULL_HISTORY_COVERAGE_INCOMPLETE"
  | "MEDICAL_CONTENT_DIGEST_DRIFT"
  | "MEDICAL_REFERENCE_COVERAGE_INCOMPLETE"
  | "CROSS_PERSONA_MEDICAL_REFERENCE_DRIFT"
  | "PATIENT_GENERATED_REPLY_RATE_BELOW_TARGET"
  | "CONTROLLER_PROVIDER_CALLS_NONZERO"
  | "LOCAL_FAKE_REPLIES_NONZERO"
  | "PERSONA_CONSISTENCY_BELOW_TARGET"
  | "SERIOUS_FACT_ERRORS_NONZERO"
  | "DIAGNOSIS_LEAK_NONZERO"
  | "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO"
  | "UNKNOWN_AS_ABSENT_NONZERO"
  | "PERSONA_NOT_IDENTIFIED"
  | "AUDIT_DECISION_NON_APPROVED"
  | "AUDIT_REPORTED_FINDINGS"
  | "AUDIT_ASSESSMENT_COVERAGE_INCOMPLETE"
  | "AUDIT_NOT_COMPLETED"
  | "PERSONA_RUN_FAILED";

export interface E3PersonaFinding {
  code: E3PersonaFindingCode;
  message: string;
  scope?: string;
  expected?: number | string;
  actual?: number | string;
}

export interface E3PersonaBenchmarkReport {
  schemaVersion: typeof E3_PERSONA_BENCHMARK_REPORT_VERSION;
  generatedAt: string;
  reviewPolicy: "non_blocking";
  status: "reported";
  decision: E3PersonaReviewDecision;
  coverage: {
    ruleAssertions: number;
    rulePersonas: number;
    ruleScenarios: number;
    realPersonas: number;
    committedTurns: number;
    minimumTurnsPerPersona: number;
  };
  metrics: {
    patientGeneratedReplyRate: number;
    personaConsistencyRate: number;
    seriousFactErrors: number;
    diagnosisLeaks: number;
    uncompletedTestResultLeaks: number;
    unknownAsAbsentErrors: number;
  };
  audit: E3PersonaAuditEvidence[];
  findings: E3PersonaFinding[];
  runs: E3PersonaRunEvidence[];
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function addFinding(
  findings: E3PersonaFinding[],
  condition: boolean,
  finding: E3PersonaFinding,
): void {
  if (condition) findings.push(finding);
}

function medicalReferenceSignature(
  reference: E3ScenarioMedicalReference | undefined,
): string {
  if (reference === undefined) return "missing";
  return JSON.stringify({
    factIds: [...reference.factIds].sort(),
    testStates: [...reference.testStates].sort(),
  });
}

export function buildE3PersonaBenchmarkReport(input: {
  ruleCorpus: E3PersonaRuleCorpus;
  runs: readonly E3PersonaRunEvidence[];
  audit: readonly E3PersonaAuditEvidence[];
  generatedAt?: string;
}): E3PersonaBenchmarkReport {
  assertE3PersonaRuleCorpus(input.ruleCorpus);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError("E3 persona report generatedAt is invalid");
  }
  const runs = input.runs.map((run) => structuredClone(run));
  const audit = input.audit.map((entry) => structuredClone(entry));
  const expectedAuditRoles: readonly E3PersonaAuditRole[] = [
    "persona_consistency_reviewer",
    "medical_fact_boundary_reviewer",
  ];
  if (
    audit.length !== expectedAuditRoles.length ||
    new Set(audit.map(({ role }) => role)).size !== expectedAuditRoles.length ||
    expectedAuditRoles.some((role) => !audit.some((entry) => entry.role === role))
  ) {
    throw new TypeError("E3 audit evidence must contain exactly two distinct roles");
  }
  const findings: E3PersonaFinding[] = [];
  const completedRuns = runs.filter(({ status }) => status === "completed");
  const realPersonas = new Set(
    completedRuns.map(({ personaTemplateId }) => personaTemplateId),
  );
  const rulePersonas = new Set(
    input.ruleCorpus.assertions.map(({ personaTemplateId }) => personaTemplateId),
  );
  const ruleScenarios = new Set(
    input.ruleCorpus.assertions.map(({ scenarioId }) => scenarioId),
  );
  const committedTurns = runs.reduce(
    (sum, run) => sum + run.committedTurns,
    0,
  );
  const minimumTurnsPerPersona = runs.length === 0
    ? 0
    : Math.min(...runs.map(({ committedTurns: turns }) => turns));
  const totalPatientReplies = runs.reduce(
    (sum, run) => sum + run.patientGeneratedReplies,
    0,
  );
  const personaAudit = audit.find(
    ({ role }) => role === "persona_consistency_reviewer",
  );
  const medicalAudit = audit.find(
    ({ role }) => role === "medical_fact_boundary_reviewer",
  );
  const personaConsistencyRate = personaAudit?.personaConsistencyRate ?? 0;
  const seriousFactErrors = medicalAudit?.seriousFactErrors ?? 0;
  const diagnosisLeaks = Math.max(
    runs.reduce((sum, run) => sum + run.diagnosisLeaks, 0),
    medicalAudit?.diagnosisLeaks ?? 0,
  );
  const uncompletedTestResultLeaks = Math.max(
    runs.reduce(
      (sum, run) => sum + run.uncompletedTestResultLeaks,
      0,
    ),
    medicalAudit?.uncompletedTestResultLeaks ?? 0,
  );
  const unknownAsAbsentErrors = medicalAudit?.unknownAsAbsentErrors ?? 0;
  const patientGeneratedReplyRate = safeRate(
    totalPatientReplies,
    committedTurns,
  );

  addFinding(
    findings,
    input.ruleCorpus.assertionCount < 72,
    {
      code: "RULE_ASSERTION_COVERAGE_BELOW_TARGET",
      message: "E3 rule corpus contains fewer than 72 assertions",
      expected: 72,
      actual: input.ruleCorpus.assertionCount,
    },
  );
  addFinding(
    findings,
    rulePersonas.size !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length ||
      ruleScenarios.size !== E3_PERSONA_SCENARIOS.length,
    {
      code: "RULE_PERSONA_OR_SCENARIO_COVERAGE_MISMATCH",
      message: "E3 rule corpus does not cover all six personas and 12 scenarios",
    },
  );
  addFinding(
    findings,
    realPersonas.size !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length ||
      completedRuns.length !== PATIENT_PERSONA_TEMPLATE_IDS_V2.length,
    {
      code: "REAL_PERSONA_COVERAGE_MISMATCH",
      message: "E3 live evidence does not contain exactly one completed run for each persona",
      expected: PATIENT_PERSONA_TEMPLATE_IDS_V2.length,
      actual: realPersonas.size,
    },
  );
  addFinding(
    findings,
    minimumTurnsPerPersona < 12 || committedTurns < 72,
    {
      code: "COMMITTED_TURNS_BELOW_TARGET",
      message: "E3 live evidence is below 12 committed turns per persona or 72 total turns",
      expected: "12 per persona and 72 total",
      actual: `${minimumTurnsPerPersona} per persona and ${committedTurns} total`,
    },
  );
  addFinding(
    findings,
    runs.some((run) => run.fullHistoryTurns !== run.committedTurns),
    {
      code: "FULL_HISTORY_COVERAGE_INCOMPLETE",
      message: "one or more committed turns did not receive the complete prior history",
    },
  );
  addFinding(
    findings,
    new Set(runs.map(({ medicalContentDigest }) => medicalContentDigest)).size > 1,
    {
      code: "MEDICAL_CONTENT_DIGEST_DRIFT",
      message: "persona variants do not share identical medical content",
    },
  );
  for (const scenario of E3_PERSONA_SCENARIOS) {
    for (const questionOrdinal of scenario.userTurns.map((_, index) => index + 1)) {
      const references = runs.map((run) =>
        run.scenarioMedicalReferences.find(
          (reference) =>
            reference.scenarioId === scenario.scenarioId &&
            reference.questionOrdinal === questionOrdinal,
        )
      );
      const scope = `${scenario.scenarioId}:${questionOrdinal}`;
      const referenceCoverageIncomplete = references.some(
        (reference) => reference === undefined,
      );
      addFinding(findings, referenceCoverageIncomplete, {
        code: "MEDICAL_REFERENCE_COVERAGE_INCOMPLETE",
        message: "one or more personas have no committed evidence for this question",
        scope,
        expected: PATIENT_PERSONA_TEMPLATE_IDS_V2.length,
        actual: references.filter((reference) => reference !== undefined).length,
      });
      if (referenceCoverageIncomplete) continue;
      const signatures = new Set(references.map(medicalReferenceSignature));
      addFinding(findings, signatures.size > 1, {
        code: "CROSS_PERSONA_MEDICAL_REFERENCE_DRIFT",
        message: "the same question referenced different medical facts or test states across personas",
        scope,
      });
    }
  }
  addFinding(findings, patientGeneratedReplyRate < 1, {
    code: "PATIENT_GENERATED_REPLY_RATE_BELOW_TARGET",
    message: "not every committed turn has a real Patient Agent reply",
    expected: 1,
    actual: patientGeneratedReplyRate,
  });
  addFinding(
    findings,
    runs.some(({ controllerProviderCalls }) => controllerProviderCalls > 0),
    {
      code: "CONTROLLER_PROVIDER_CALLS_NONZERO",
      message: "E3 observed one or more Controller provider calls",
    },
  );
  addFinding(
    findings,
    runs.some(({ localFakeReplies }) => localFakeReplies > 0),
    {
      code: "LOCAL_FAKE_REPLIES_NONZERO",
      message: "E3 observed one or more local fake replies",
    },
  );
  addFinding(findings, personaConsistencyRate < 0.95, {
    code: "PERSONA_CONSISTENCY_BELOW_TARGET",
    message: "AI-audited persona consistency is below 95%",
    expected: 0.95,
    actual: personaConsistencyRate,
  });
  addFinding(findings, seriousFactErrors > 0, {
    code: "SERIOUS_FACT_ERRORS_NONZERO",
    message: "AI audit found serious medical fact errors",
    expected: 0,
    actual: seriousFactErrors,
  });
  addFinding(findings, diagnosisLeaks > 0, {
    code: "DIAGNOSIS_LEAK_NONZERO",
    message: "E3 found target diagnosis leakage",
    expected: 0,
    actual: diagnosisLeaks,
  });
  addFinding(findings, uncompletedTestResultLeaks > 0, {
    code: "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO",
    message: "E3 found an uncompleted-test result leak",
    expected: 0,
    actual: uncompletedTestResultLeaks,
  });
  addFinding(findings, unknownAsAbsentErrors > 0, {
    code: "UNKNOWN_AS_ABSENT_NONZERO",
    message: "E3 AI audit found unknown facts stated as absent",
    expected: 0,
    actual: unknownAsAbsentErrors,
  });
  const identifiedPersonas = new Set(
    personaAudit?.identifiedPersonaIds ?? [],
  );
  for (const personaTemplateId of PATIENT_PERSONA_TEMPLATE_IDS_V2) {
    addFinding(findings, !identifiedPersonas.has(personaTemplateId), {
      code: "PERSONA_NOT_IDENTIFIED",
      message: "independent persona reviewer did not identify the expected persona",
      scope: personaTemplateId,
    });
  }
  for (const validation of audit) {
    addFinding(findings, validation.decision !== "approved", {
      code: "AUDIT_DECISION_NON_APPROVED",
      message: "an independent E3 audit role returned a non-approved decision",
      scope: validation.role,
      expected: "approved",
      actual: validation.decision,
    });
    addFinding(findings, validation.findings.length > 0, {
      code: "AUDIT_REPORTED_FINDINGS",
      message: "an independent E3 audit role reported one or more findings",
      scope: validation.role,
      expected: 0,
      actual: validation.findings.length,
    });
    const expectedAssessedItems = validation.role ===
        "persona_consistency_reviewer"
      ? PATIENT_PERSONA_TEMPLATE_IDS_V2.length
      : committedTurns;
    addFinding(
      findings,
      validation.runStatus === "completed" &&
        validation.assessedItems !== expectedAssessedItems,
      {
        code: "AUDIT_ASSESSMENT_COVERAGE_INCOMPLETE",
        message: "an independent E3 audit role did not assess the complete evidence set",
        scope: validation.role,
        expected: expectedAssessedItems,
        actual: validation.assessedItems,
      },
    );
  }
  for (const role of expectedAuditRoles) {
    const validation = audit.find((entry) => entry.role === role);
    addFinding(
      findings,
      validation === undefined || validation.runStatus !== "completed",
      {
        code: "AUDIT_NOT_COMPLETED",
        message: "an independent E3 audit role did not complete",
        scope: role,
      },
    );
  }
  addFinding(findings, runs.some(({ status }) => status !== "completed"), {
    code: "PERSONA_RUN_FAILED",
    message: "one or more live persona runs did not complete",
  });

  const seriousFindingCodes = new Set<E3PersonaFindingCode>([
    "SERIOUS_FACT_ERRORS_NONZERO",
    "DIAGNOSIS_LEAK_NONZERO",
    "UNCOMPLETED_TEST_RESULT_LEAK_NONZERO",
    "UNKNOWN_AS_ABSENT_NONZERO",
    "MEDICAL_CONTENT_DIGEST_DRIFT",
  ]);
  const anyAuditCompleted = audit.some(
    ({ runStatus }) => runStatus === "completed",
  );
  const anyAuditRejected = audit.some(
    ({ decision }) => decision === "rejected",
  );
  const decision: E3PersonaReviewDecision = findings.length === 0
    ? "approved"
    : anyAuditRejected ||
        findings.some(({ code }) => seriousFindingCodes.has(code))
    ? "rejected"
    : anyAuditCompleted
    ? "revision_recommended"
    : "not_run";

  return {
    schemaVersion: E3_PERSONA_BENCHMARK_REPORT_VERSION,
    generatedAt,
    reviewPolicy: "non_blocking",
    status: "reported",
    decision,
    coverage: {
      ruleAssertions: input.ruleCorpus.assertionCount,
      rulePersonas: rulePersonas.size,
      ruleScenarios: ruleScenarios.size,
      realPersonas: realPersonas.size,
      committedTurns,
      minimumTurnsPerPersona,
    },
    metrics: {
      patientGeneratedReplyRate,
      personaConsistencyRate,
      seriousFactErrors,
      diagnosisLeaks,
      uncompletedTestResultLeaks,
      unknownAsAbsentErrors,
    },
    audit,
    findings,
    runs,
  };
}
