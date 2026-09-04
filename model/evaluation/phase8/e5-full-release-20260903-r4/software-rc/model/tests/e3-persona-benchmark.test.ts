import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  generateE3PersonaAiCrossReview,
  type E3PersonaAuditJourney,
} from "../src/evaluation/e3-persona-ai-audit.js";
import {
  buildE3PersonaBenchmarkReport,
  buildE3PersonaRuleCorpus,
  E3_PERSONA_SCENARIOS,
  type E3PersonaAuditEvidence,
  type E3PersonaRunEvidence,
} from "../src/evaluation/e3-persona-benchmark.js";
import {
  assertE3LowRiskAnchor,
  buildE3PersonaCaseVariants,
  isE3NonBlockingJourneyFailure,
  renameE3EvidenceDirectory,
} from "../src/evaluation/e3-persona-live-runner.js";
import {
  createE3JourneyArtifactBindings,
  verifyE3PersonaEvidenceDirectory,
} from "../src/evaluation/e3-persona-evidence.js";
import { computeMedicalContentDigest } from "../src/domain/case-content-hash.js";
import { ModelServiceError } from "../src/domain/errors.js";
import { loadCasePackages } from "../src/cli/case-loader.js";
import { PATIENT_PERSONA_TEMPLATE_IDS_V2 } from "../src/domain/patient-persona.js";
import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
  OpenAITransportResponse,
} from "../src/providers/openai-model-provider.js";
import type { Phase8PatientReplySampleV1 } from "../src/evaluation/phase8-ai-evidence.js";
import { sha256Canonical } from "../src/release/phase8-release.js";
import { evaluateMedicalSafetyV1 } from "../src/safety/medical-safety-policy-v1.js";
import { createCaseFixture } from "./fixtures/case-fixture.js";

const MEDICAL_DIGEST = `sha256:${"a".repeat(64)}`;

function references(): E3PersonaRunEvidence["scenarioMedicalReferences"] {
  return E3_PERSONA_SCENARIOS.flatMap((scenario) =>
    scenario.userTurns.map((_, index) => ({
      scenarioId: scenario.scenarioId,
      questionOrdinal: index + 1,
      factIds: scenario.scenarioId === "onset" ? ["fact.onset"] : [],
      testStates: ["test.chest_ct:not_completed"],
    }))
  );
}

function run(
  personaTemplateId: (typeof PATIENT_PERSONA_TEMPLATE_IDS_V2)[number],
  index: number,
): E3PersonaRunEvidence {
  return {
    runId: `e3-run-${String(index + 1).padStart(2, "0")}`,
    personaTemplateId,
    status: "completed",
    anchorPublicCaseId: "case_c01_respiratory_001",
    anchorCaseVersion: "1.1.0-e3.1",
    medicalContentDigest: MEDICAL_DIGEST,
    variantContentHash: `sha256:${String(index).repeat(64)}`,
    committedTurns: 14,
    fullHistoryTurns: 14,
    patientGeneratedReplies: 14,
    patientProviderCalls: 14,
    controllerProviderCalls: 0,
    localFakeReplies: 0,
    diagnosisLeaks: 0,
    uncompletedTestResultLeaks: 0,
    scenarioMedicalReferences: references(),
  };
}

function audit(): E3PersonaAuditEvidence[] {
  return [
    {
      validatorId: "validator.ai.e3-persona-consistency.v1",
      role: "persona_consistency_reviewer",
      modelId: "gpt-e3",
      promptVersion: "e3-persona-consistency-review-v1",
      validationRunId: "run.persona",
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "completed",
      decision: "approved",
      assessedItems: 6,
      personaConsistencyRate: 1,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
      unknownAsAbsentErrors: 0,
      identifiedPersonaIds: [...PATIENT_PERSONA_TEMPLATE_IDS_V2],
      findings: [],
    },
    {
      validatorId: "validator.ai.e3-medical-fact-boundary.v1",
      role: "medical_fact_boundary_reviewer",
      modelId: "gpt-e3",
      promptVersion: "e3-medical-fact-boundary-review-v1",
      validationRunId: "run.medical",
      isolation: {
        independentInvocation: true,
        counterpartOutputVisible: false,
      },
      runStatus: "completed",
      decision: "approved",
      assessedItems: 84,
      personaConsistencyRate: 1,
      seriousFactErrors: 0,
      diagnosisLeaks: 0,
      uncompletedTestResultLeaks: 0,
      unknownAsAbsentErrors: 0,
      identifiedPersonaIds: [],
      findings: [],
    },
  ];
}

test("E3 rule corpus expands six personas across all 12 scenarios", () => {
  const corpus = buildE3PersonaRuleCorpus();

  assert.equal(corpus.personaCount, 6);
  assert.equal(corpus.scenarioCount, 12);
  assert.equal(corpus.assertionCount, 72);
  assert.equal(corpus.assertions.length, 72);
  assert.equal(corpus.minimumCommittedTurnsPerPersona, 14);
  for (const personaTemplateId of PATIENT_PERSONA_TEMPLATE_IDS_V2) {
    assert.equal(
      corpus.assertions.filter(
        (assertion) => assertion.personaTemplateId === personaTemplateId,
      ).length,
      12,
    );
  }
  assert.ok(
    corpus.assertions.every((assertion) =>
      Object.values(assertion.medicalInvariants).every(Boolean)
    ),
  );
});

test("E3 scenario definitions are deeply immutable", () => {
  const originalTurnCount = E3_PERSONA_SCENARIOS.reduce(
    (sum, scenario) => sum + scenario.userTurns.length,
    0,
  );
  assert.throws(
    () => (E3_PERSONA_SCENARIOS[0]!.userTurns as string[]).push("tamper"),
    TypeError,
  );
  assert.equal(
    E3_PERSONA_SCENARIOS.reduce(
      (sum, scenario) => sum + scenario.userTurns.length,
      0,
    ),
    originalTurnCount,
  );
});

test("E3 scenario turns all pass the fictional-case medical safety preflight", () => {
  const turns = E3_PERSONA_SCENARIOS.flatMap(({ userTurns }) => userTurns);

  assert.equal(turns.length, 14);
  for (const text of turns) {
    assert.equal(
      evaluateMedicalSafetyV1({ text, context: "fictional_case_session" }).decision,
      "ALLOW_GAME",
      text,
    );
  }
});

test("E3 builds six Persona v2 variants without changing medical content", () => {
  const variants = buildE3PersonaCaseVariants(createCaseFixture());

  assert.deepEqual(
    variants.map(({ patientPersona }) => patientPersona.personaTemplateId),
    PATIENT_PERSONA_TEMPLATE_IDS_V2,
  );
  assert.equal(new Set(variants.map(computeMedicalContentDigest)).size, 1);
  assert.equal(
    new Set(variants.map(({ provenance }) => provenance.contentHash)).size,
    6,
  );
  assert.ok(
    variants.every(
      ({ patientPersona }) =>
        patientPersona.personaTemplateVersion ===
        "patient-persona-templates-v2",
    ),
  );
});

test("E3 derives provenance and patient role IDs from the selected anchor", () => {
  const anchor = createCaseFixture();
  anchor.publicCaseId = "case_c02_alternate_anchor";
  const variants = buildE3PersonaCaseVariants(anchor);

  assert.ok(
    variants.every(({ patientIdentity }) =>
      patientIdentity.patientRoleId.includes("case_c02_alternate_anchor")
    ),
  );
  assert.ok(
    variants.every(({ provenance }) =>
      provenance.sources.every(
        ({ sourceId, title }) =>
          sourceId.includes("case_c02_alternate_anchor") &&
          title.includes("case_c02_alternate_anchor") &&
          !sourceId.includes("c01") &&
          !title.includes("C01"),
      )
    ),
  );
});

test("E3 freezes the CLI to the reviewed low-risk C01 anchor", () => {
  const anchorPath = resolve("cases", "draft", "c01-common-cold-v1.json");
  const [anchor] = loadCasePackages([anchorPath]);
  const anchorSha256 = createHash("sha256")
    .update(readFileSync(anchorPath))
    .digest("hex");

  assert.doesNotThrow(() => assertE3LowRiskAnchor(anchor!, anchorSha256));
  assert.throws(
    () => assertE3LowRiskAnchor(anchor!, "0".repeat(64)),
    /anchor identity or SHA-256 drifted/u,
  );
});

test("E3 reports approved observation when all rule, live, and audit targets pass", () => {
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs: PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run),
    audit: audit(),
    generatedAt: "2026-09-02T10:00:00.000Z",
  });

  assert.equal(report.status, "reported");
  assert.equal(report.reviewPolicy, "non_blocking");
  assert.equal(report.decision, "approved");
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.ruleAssertions, 72);
  assert.equal(report.coverage.realPersonas, 6);
  assert.equal(report.coverage.committedTurns, 84);
  assert.equal(report.metrics.patientGeneratedReplyRate, 1);
});

test("E3 propagates a rejected AI audit even when numeric metrics are green", () => {
  const audits = audit();
  audits[0] = {
    ...audits[0]!,
    decision: "rejected",
    findings: ["reviewer rejected the persona evidence"],
  };
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs: PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run),
    audit: audits,
    generatedAt: "2026-09-03T10:00:00.000Z",
  });

  assert.equal(report.decision, "rejected");
  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has("AUDIT_DECISION_NON_APPROVED"));
  assert.ok(codes.has("AUDIT_REPORTED_FINDINGS"));
});

test("E3 turns quality failures into non-blocking findings", () => {
  const runs = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run);
  runs[0] = {
    ...runs[0]!,
    status: "failed",
    committedTurns: 10,
    fullHistoryTurns: 9,
    patientGeneratedReplies: 9,
    localFakeReplies: 1,
    diagnosisLeaks: 1,
    failureCode: "synthetic provider failure",
  };
  const audits = audit();
  audits[0] = {
    ...audits[0]!,
    decision: "revision_recommended",
    personaConsistencyRate: 0.9,
    identifiedPersonaIds: PATIENT_PERSONA_TEMPLATE_IDS_V2.slice(1),
  };
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs,
    audit: audits,
    generatedAt: "2026-09-02T10:00:00.000Z",
  });

  assert.equal(report.status, "reported");
  assert.equal(report.decision, "rejected");
  const codes = new Set(report.findings.map(({ code }) => code));
  assert.ok(codes.has("COMMITTED_TURNS_BELOW_TARGET"));
  assert.ok(codes.has("FULL_HISTORY_COVERAGE_INCOMPLETE"));
  assert.ok(codes.has("PERSONA_CONSISTENCY_BELOW_TARGET"));
  assert.ok(codes.has("PERSONA_NOT_IDENTIFIED"));
  assert.ok(codes.has("DIAGNOSIS_LEAK_NONZERO"));
  assert.ok(codes.has("PERSONA_RUN_FAILED"));
});

test("E3 detects fact or test-state drift for the same scenario", () => {
  const runs = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run);
  runs[5]!.scenarioMedicalReferences = references().map((reference) =>
    reference.scenarioId === "onset"
      ? { ...reference, factIds: ["fact.drift"] }
      : reference
  );
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs,
    audit: audit(),
    generatedAt: "2026-09-02T10:00:00.000Z",
  });

  assert.ok(
    report.findings.some(
      ({ code, scope }) =>
        code === "CROSS_PERSONA_MEDICAL_REFERENCE_DRIFT" && scope === "onset:1",
    ),
  );
});

test("E3 compares every question instead of a scenario-level union", () => {
  const runs = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run);
  for (const evidence of runs) {
    evidence.scenarioMedicalReferences = references().map((reference) => {
      if (reference.scenarioId !== "consecutive_off_topic") return reference;
      return {
        ...reference,
        factIds: reference.questionOrdinal === 1
          ? ["fact.a"]
          : reference.questionOrdinal === 2
          ? ["fact.b"]
          : [],
      };
    });
  }
  runs[5]!.scenarioMedicalReferences = runs[5]!.scenarioMedicalReferences.map(
    (reference) => {
      if (reference.scenarioId !== "consecutive_off_topic") return reference;
      return {
        ...reference,
        factIds: reference.questionOrdinal === 1
          ? ["fact.b"]
          : reference.questionOrdinal === 2
          ? ["fact.a"]
          : [],
      };
    },
  );
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs,
    audit: audit(),
    generatedAt: "2026-09-03T10:00:00.000Z",
  });
  const driftScopes = report.findings
    .filter(({ code }) => code === "CROSS_PERSONA_MEDICAL_REFERENCE_DRIFT")
    .map(({ scope }) => scope);

  assert.deepEqual(
    driftScopes,
    ["consecutive_off_topic:1", "consecutive_off_topic:2"],
  );
});

test("E3 reports incomplete medical-reference coverage without false drift", () => {
  const runs = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run);
  runs[5]!.scenarioMedicalReferences = [];
  const report = buildE3PersonaBenchmarkReport({
    ruleCorpus: buildE3PersonaRuleCorpus(),
    runs,
    audit: audit(),
    generatedAt: "2026-09-03T10:00:00.000Z",
  });

  assert.ok(
    report.findings.some(
      ({ code, scope }) =>
        code === "MEDICAL_REFERENCE_COVERAGE_INCOMPLETE" && scope === "onset:1",
    ),
  );
  assert.equal(
    report.findings.some(
      ({ code }) => code === "CROSS_PERSONA_MEDICAL_REFERENCE_DRIFT",
    ),
    false,
  );
});

test("E3 only downgrades explicit provider or model-quality errors", () => {
  assert.equal(
    isE3NonBlockingJourneyFailure(
      new ModelServiceError("MODEL_UNAVAILABLE", "provider unavailable"),
    ),
    true,
  );
  assert.equal(
    isE3NonBlockingJourneyFailure(
      new ModelServiceError("MODEL_OUTPUT_REJECTED", "schema drift"),
    ),
    true,
  );
  assert.equal(
    isE3NonBlockingJourneyFailure(
      new ModelServiceError("OPERATION_RECOVERY_REQUIRED", "identity drift"),
    ),
    false,
  );
  assert.equal(isE3NonBlockingJourneyFailure(new Error("evidence missing")), false);
});

test("E3 evidence publication retries transient directory locks", async () => {
  let attempts = 0;
  const waits: number[] = [];
  await renameE3EvidenceDirectory(
    "staging",
    "final",
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("directory is temporarily locked"), {
          code: "EPERM",
        });
      }
    },
    async (delayMs) => {
      waits.push(delayMs);
    },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [50, 100]);
  await assert.rejects(
    renameE3EvidenceDirectory(
      "staging",
      "final",
      async () => {
        throw Object.assign(new Error("source missing"), { code: "ENOENT" });
      },
      async () => undefined,
    ),
    /source missing/u,
  );
});

test("E3 evidence verifier rejects drift in core artifacts and journeys", () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "e3-persona-evidence-"));
  const journeyRoot = resolve(evidenceRoot, "private", "journeys");
  mkdirSync(journeyRoot, { recursive: true });
  const runs = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(run);
  const originalContent = new Map<string, string>();
  try {
    for (const evidence of runs) {
      const path = resolve(journeyRoot, `${evidence.runId}.json`);
      const content = `${JSON.stringify({ runId: evidence.runId })}\n`;
      originalContent.set(path, content);
      writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    }
    const ruleCorpus = buildE3PersonaRuleCorpus();
    const sampleSet = {
      schemaVersion: "e3-private-patient-sample-set-v1",
      sampleCount: 0,
      sampleSetSha256: sha256Canonical([]),
      samples: [],
    };
    const auditEvidence = audit();
    const ruleCorpusPath = resolve(evidenceRoot, "e3-persona-rule-corpus.v1.json");
    const sampleSetPath = resolve(evidenceRoot, "private", "patient-samples.v1.json");
    const auditPath = resolve(evidenceRoot, "e3-persona-ai-cross-review.v1.json");
    const ruleCorpusContent = `${JSON.stringify(ruleCorpus, null, 2)}\n`;
    const sampleSetContent = `${JSON.stringify(sampleSet, null, 2)}\n`;
    const auditContent = `${JSON.stringify(auditEvidence, null, 2)}\n`;
    writeFileSync(ruleCorpusPath, ruleCorpusContent, { encoding: "utf8", flag: "wx" });
    writeFileSync(sampleSetPath, sampleSetContent, { encoding: "utf8", flag: "wx" });
    writeFileSync(auditPath, auditContent, { encoding: "utf8", flag: "wx" });
    const report = buildE3PersonaBenchmarkReport({
      ruleCorpus,
      runs,
      audit: auditEvidence,
      generatedAt: "2026-09-03T10:00:00.000Z",
    });
    const journeyArtifacts = createE3JourneyArtifactBindings(
      evidenceRoot,
      runs.map(({ runId }) => runId),
    );
    const auditSha256 = createHash("sha256").update(auditContent).digest("hex");
    writeFileSync(
      resolve(evidenceRoot, "e3-persona-benchmark-report.v2.json"),
      `${JSON.stringify({
        ...report,
        bindings: {
          ruleCorpusSha256: sha256Canonical(ruleCorpus),
          sampleSetSha256: sampleSet.sampleSetSha256,
          auditSha256,
          journeyArtifacts,
        },
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    assert.equal(
      verifyE3PersonaEvidenceDirectory(evidenceRoot).journeyArtifacts.length,
      6,
    );

    const firstPath = resolve(journeyRoot, `${runs[0]!.runId}.json`);
    writeFileSync(firstPath, '{"tampered":true}\n', "utf8");
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /hash or size binding drifted/u,
    );
    writeFileSync(firstPath, originalContent.get(firstPath)!, "utf8");

    const secondPath = resolve(journeyRoot, `${runs[1]!.runId}.json`);
    rmSync(secondPath);
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /missing, unexpected, or drifted/u,
    );
    writeFileSync(secondPath, originalContent.get(secondPath)!, "utf8");

    const unexpectedPath = resolve(journeyRoot, "unexpected.json");
    writeFileSync(unexpectedPath, "{}\n", "utf8");
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /missing, unexpected, or drifted/u,
    );
    rmSync(unexpectedPath);

    writeFileSync(auditPath, "[]\n", "utf8");
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /AI cross-review file hash drifted/u,
    );
    writeFileSync(auditPath, auditContent, "utf8");

    writeFileSync(sampleSetPath, `${JSON.stringify({ ...sampleSet, sampleCount: 1 })}\n`, "utf8");
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /private patient sample set is invalid/u,
    );
    writeFileSync(sampleSetPath, sampleSetContent, "utf8");

    writeFileSync(
      sampleSetPath,
      `${JSON.stringify({ ...sampleSet, schemaVersion: "tampered" })}\n`,
      "utf8",
    );
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /private patient sample set is invalid/u,
    );
    writeFileSync(sampleSetPath, sampleSetContent, "utf8");

    rmSync(ruleCorpusPath);
    assert.throws(
      () => verifyE3PersonaEvidenceDirectory(evidenceRoot),
      /required evidence file is missing/u,
    );
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

class ScriptedE3AuditTransport implements OpenAIResponsesTransport {
  readonly providerName = "scripted-e3";
  readonly protocol = "openai-responses";
  readonly endpointSha256 = "b".repeat(64);
  readonly requests: OpenAITransportRequest[] = [];

  constructor(
    private readonly personaByRunId: ReadonlyMap<string, string>,
    private readonly fail = false,
  ) {}

  async create(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
    this.requests.push(request);
    if (this.fail) throw new Error("scripted audit unavailable");
    const input = JSON.parse(request.input) as Record<string, any>;
    const personaReview = request.schema.name.includes("persona_consistency");
    const assessments = personaReview
      ? input.journeys.map((journey: any) => ({
          runId: journey.runId,
          recognizedPersonaTemplateId: this.personaByRunId.get(journey.runId),
          consistentTurns: journey.turns.length,
          notes: "人格识别与逐轮风格均一致。",
        }))
      : input.samples.map((sample: any) => ({
          sampleId: sample.sampleId,
          seriousFactError: false,
          diagnosisLeak: false,
          uncompletedTestResultLeak: false,
          unknownAsAbsent: false,
          notes: "医学事实和检查边界一致。",
        }));
    return {
      status: "completed",
      outputText: JSON.stringify({ assessments }),
      responseId: `response-${this.requests.length}`,
      requestId: `request-${this.requests.length}`,
      modelId: "gpt-e3",
    };
  }
}

function auditInputs(): {
  journeys: E3PersonaAuditJourney[];
  samples: Phase8PatientReplySampleV1[];
  personaByRunId: Map<string, string>;
} {
  const personaByRunId = new Map<string, string>();
  const journeys = PATIENT_PERSONA_TEMPLATE_IDS_V2.map(
    (expectedPersonaTemplateId, index): E3PersonaAuditJourney => {
      const runId = `anonymous-run-${index + 1}`;
      personaByRunId.set(runId, expectedPersonaTemplateId);
      return {
        runId,
        expectedPersonaTemplateId,
        turns: Array.from({ length: 12 }, (_, turnIndex) => ({
          question: `问题 ${turnIndex + 1}`,
          reply: `回答 ${turnIndex + 1}`,
        })),
      };
    },
  );
  const samples = journeys.flatMap((journey) =>
    journey.turns.map((turn, index): Phase8PatientReplySampleV1 => ({
      sampleId: `${journey.runId}.turn-${index + 1}`,
      caseId: "case_c01_respiratory_001",
      caseVersion: "1.1.0-e3.1",
      question: turn.question,
      reply: turn.reply,
      disclosedFactIds: [],
      authorizedFacts: [],
      authorizedTests: [],
      personaTemplateId: journey.expectedPersonaTemplateId,
      forbiddenDiagnosisTerms: ["普通感冒"],
    })),
  );
  return { journeys, samples, personaByRunId };
}

test("E3 runs two isolated AI audit roles and recognizes all personas", async () => {
  const inputs = auditInputs();
  const transport = new ScriptedE3AuditTransport(inputs.personaByRunId);
  const review = await generateE3PersonaAiCrossReview({
    journeys: inputs.journeys,
    samples: inputs.samples,
    transport,
    modelId: "gpt-e3",
    expectedActualModelId: "gpt-e3",
    batchSize: 50,
    runId: (role) => `run.${role}`,
  });

  assert.equal(review.reviewPolicy, "non_blocking");
  assert.equal(review.decision, "approved");
  assert.equal(review.validations.length, 2);
  assert.equal(transport.requests.length, 3);
  assert.deepEqual(
    review.validations.map(({ role }) => role),
    ["persona_consistency_reviewer", "medical_fact_boundary_reviewer"],
  );
  assert.deepEqual(
    review.validations[0]!.identifiedPersonaIds,
    PATIENT_PERSONA_TEMPLATE_IDS_V2,
  );
  assert.ok(
    review.validations.every(
      ({ isolation }) =>
        isolation.independentInvocation && !isolation.counterpartOutputVisible,
    ),
  );
});

test("E3 records unavailable AI reviewers as not_run instead of throwing", async () => {
  const inputs = auditInputs();
  const review = await generateE3PersonaAiCrossReview({
    journeys: inputs.journeys,
    samples: inputs.samples,
    transport: new ScriptedE3AuditTransport(inputs.personaByRunId, true),
    modelId: "gpt-e3",
  });

  assert.equal(review.decision, "not_run");
  assert.equal(review.validations.length, 2);
  assert.ok(
    review.validations.every(
      ({ runStatus, decision }) =>
        runStatus === "failed_to_run" && decision === "not_run",
    ),
  );
});
