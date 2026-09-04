import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { createHeadlessModelService } from "../application/create-headless-model-service.js";
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import { loadCasePackages } from "../cli/case-loader.js";
import {
  assertCasePackageV2,
  migrateCasePackageV1ToV2,
  type CasePackage,
  type CasePackageV2,
} from "../domain/case-package.js";
import {
  computeCaseContentHash,
  computeMedicalContentDigest,
} from "../domain/case-content-hash.js";
import { ModelServiceError } from "../domain/errors.js";
import {
  getPatientPersonaTemplate,
  PATIENT_PERSONA_TEMPLATE_IDS_V2,
  PATIENT_PERSONA_TEMPLATE_VERSION_V2,
  type PatientPersonaTemplateId,
} from "../domain/patient-persona.js";
import { MemoryEventSink, type ModelEvent } from "../observability/event-sink.js";
import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
  OpenAIModelProvider,
  type OpenAIModelProviderOptions,
} from "../providers/openai-model-provider.js";
import type { PatientInput, PatientReply } from "../providers/model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import { sha256Canonical } from "../release/phase8-release.js";
import {
  buildE3PersonaNotRunReview,
  generateE3PersonaAiCrossReview,
  type E3PersonaAuditJourney,
} from "./e3-persona-ai-audit.js";
import { createE3JourneyArtifactBindings } from "./e3-persona-evidence.js";
import { buildE3ReuseSourceBinding } from "./e3-reuse-policy.js";
import {
  buildE3PersonaBenchmarkReport,
  buildE3PersonaRuleCorpus,
  E3_PERSONA_SCENARIOS,
  type E3PersonaRunEvidence,
  type E3PersonaScenarioId,
  type E3ScenarioMedicalReference,
} from "./e3-persona-benchmark.js";
import type { Phase8PatientReplySampleV1 } from "./phase8-ai-evidence.js";

const DEFAULT_ANCHOR_CASE = "cases/draft/c01-common-cold-v1.json";
const E3_LOW_RISK_ANCHOR_PUBLIC_CASE_ID = "case_c01_respiratory_001";
const E3_LOW_RISK_ANCHOR_SHA256 =
  "5daa0ff35a04ea58cfb1cddfab848c47bd729bbdc847eff8b7453a56b416f1d1";
const E3_RENAME_ATTEMPTS = 8;
const USAGE = `用法：npm run eval:e3:persona-live -- --model <modelId> --output <model内相对目录> [--anchor-case <model内相对病例路径>]

该命令用同一个低风险锚点病例构造六个 Persona v2 变体，运行每人格至少 12 个已提交真实 Patient Agent 轮次，再执行两个隔离 AI 审计角色。质量缺口写入 non-blocking findings；路径、病例结构和制品写入错误仍会失败。`;

type RenameOperation = (source: string, destination: string) => Promise<void>;
type RenameDelay = (delayMs: number) => Promise<unknown>;

function isTransientRenameError(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = String(error.code);
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

export async function renameE3EvidenceDirectory(
  source: string,
  destination: string,
  renameOperation: RenameOperation = rename,
  wait: RenameDelay = delay,
): Promise<void> {
  for (let attempt = 0; attempt < E3_RENAME_ATTEMPTS; attempt += 1) {
    try {
      await renameOperation(source, destination);
      return;
    } catch (error) {
      const isFinalAttempt = attempt === E3_RENAME_ATTEMPTS - 1;
      if (isFinalAttempt || !isTransientRenameError(error)) throw error;
      await wait(Math.min(50 * (2 ** attempt), 400));
    }
  }
}

const PERSONA_COMMUNICATION_TRAITS: Readonly<
  Record<PatientPersonaTemplateId, readonly string[]>
> = Object.freeze({
  gentle_cooperative: Object.freeze(["礼貌耐心", "逐问逐答"]),
  anxious_reassurance_seeking: Object.freeze(["容易担忧", "希望得到安慰"]),
  impatient_direct: Object.freeze(["表达简短直接", "希望尽快结束"]),
  talkative_digressive: Object.freeze(["会补充日常细节", "容易绕开主题"]),
  accommodating_minimizing: Object.freeze(["措辞随和", "弱化主观困扰"]),
  guarded_questioning: Object.freeze(["常追问提问原因", "较少主动披露"]),
});

interface E3TurnEvidence {
  turnNumber: number;
  scenarioId: E3PersonaScenarioId;
  question: string;
  reply: string;
  interactionKind: string;
  disclosedFactIds: string[];
  personaFactIdsUsed: string[];
  completedTestIdsUsed: string[];
  effects: unknown[];
  patientProviderCalls: number;
  controllerProviderCalls: number;
  priorHistoryTurns: number;
  testStatesBeforeTurn: string[];
}

interface E3JourneyResult {
  run: E3PersonaRunEvidence;
  journey: {
    schemaVersion: "e3-private-persona-journey-v1";
    runId: string;
    personaTemplateId: PatientPersonaTemplateId;
    medicalContentDigest: string;
    status: "completed" | "failed" | "not_run";
    failureCode?: string;
    turns: E3TurnEvidence[];
  };
  auditJourney: E3PersonaAuditJourney;
  samples: Phase8PatientReplySampleV1[];
  actualModelIds: string[];
}

class E3ObservedOpenAIModelProvider extends OpenAIModelProvider {
  readonly patientInputs: PatientInput[] = [];

  constructor(options: OpenAIModelProviderOptions) {
    super(options);
  }

  override async generatePatientReply(input: PatientInput): Promise<PatientReply> {
    this.patientInputs.push(structuredClone(input));
    return super.generatePatientReply(input);
  }
}

function parseArguments(argv: readonly string[]): {
  modelId: string;
  anchorCase: string;
  outputDirectory: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--model", "--anchor-case", "--output"].includes(key ?? "")) {
      throw new Error(`未知参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key!, value);
    index += 1;
  }
  const modelId = values.get("--model") ?? process.env["AHAMED_MODEL_ID"];
  const outputDirectory = values.get("--output");
  if (modelId === undefined || outputDirectory === undefined) {
    throw new Error("必须提供 --model 和 --output。");
  }
  return {
    modelId: modelId.trim(),
    anchorCase: values.get("--anchor-case") ?? DEFAULT_ANCHOR_CASE,
    outputDirectory,
  };
}

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    throw new Error("E3 路径必须使用 model/ 内相对路径。");
  }
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("E3 路径必须位于 model/ 内。");
  }
  return resolvedPath;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : [];
}

export class E3EvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E3EvidenceIntegrityError";
  }
}

function eventForTurn(events: readonly ModelEvent[], clientTurnId: string): ModelEvent {
  const event = [...events].reverse().find(
    ({ eventType, payload }) =>
      eventType === "patient.reply.completed" &&
      payload["clientTurnId"] === clientTurnId,
  );
  if (event === undefined) {
    throw new E3EvidenceIntegrityError(
      `E3 committed event missing for ${clientTurnId}`,
    );
  }
  return event;
}

function countProviderCalls(
  events: readonly ModelEvent[],
  role: "controller" | "patient" | "review",
  statuses: readonly ("completed" | "failed")[] = ["completed", "failed"],
): number {
  return events.filter(
    ({ eventType, payload }) =>
      statuses.some((status) => eventType === `provider.call.${status}`) &&
      payload["role"] === role,
  ).length;
}

const NON_BLOCKING_E3_JOURNEY_ERROR_CODES = new Set([
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_REJECTED",
  "SAFETY_PROMPT_INJECTION",
  "SAFETY_REAL_HEALTH_INPUT",
  "SAFETY_INTERRUPTED",
]);

export function isE3NonBlockingJourneyFailure(
  error: unknown,
): error is ModelServiceError {
  return error instanceof ModelServiceError &&
    NON_BLOCKING_E3_JOURNEY_ERROR_CODES.has(error.code);
}

export function buildE3PersonaCaseVariants(
  anchorCase: CasePackage,
): CasePackageV2[] {
  const anchorId = anchorCase.publicCaseId;
  const migrated = migrateCasePackageV1ToV2(anchorCase, {
    patientRoleId: `patient-role.e3-anchor.${anchorId}`,
    caseVersion: "1.1.0-e3.1",
    modifiers: {
      healthLiteracy: "typical",
      recallReliability: "typical",
      emotionalIntensity: "moderate",
    },
    provenanceSources: [
      {
        sourceId: `source.e3.anchor.${anchorId}`,
        sourceRole: "synthetic_structure",
        title: `E3 persona anchor derived from synthetic case ${anchorId}`,
        authorsOrOrganization: "AhaMed test suite",
        versionOrPublicationDate: "2026-09-03",
        license: "internal-synthetic-case",
        attributionRequirements:
          `Preserve the original ${anchorId} provenance record.`,
        adaptationAllowed: true,
        commercialUseAllowed: true,
        retrievedAt: "2026-09-03T00:00:00.000Z",
        projectUsage: "Persona-only counterfactual benchmark anchor.",
        includesVerbatimExcerpt: false,
        verifiedCaseFields: ["patientFacts", "medicalTests", "answerKey", "rubric"],
        licenseAssessment: "cleared",
        riskNotes: [],
      },
    ],
  });
  return PATIENT_PERSONA_TEMPLATE_IDS_V2.map((personaTemplateId) => {
    const variant = structuredClone(migrated);
    variant.patientPersona.personaTemplateId = personaTemplateId;
    variant.patientPersona.personaTemplateVersion =
      PATIENT_PERSONA_TEMPLATE_VERSION_V2;
    variant.patientPersona.communicationTraits = [
      ...PERSONA_COMMUNICATION_TRAITS[personaTemplateId],
    ];
    variant.provenance.contentHash = computeCaseContentHash(variant);
    assertCasePackageV2(variant);
    return variant;
  });
}

export function assertE3LowRiskAnchor(
  anchorCase: CasePackage,
  anchorSha256: string,
): void {
  if (
    anchorCase.publicCaseId !== E3_LOW_RISK_ANCHOR_PUBLIC_CASE_ID ||
    anchorSha256 !== E3_LOW_RISK_ANCHOR_SHA256
  ) {
    throw new E3EvidenceIntegrityError(
      "E3 low-risk C01 anchor identity or SHA-256 drifted",
    );
  }
}

function scenarioMedicalReferences(
  turns: readonly E3TurnEvidence[],
): E3ScenarioMedicalReference[] {
  const ordinalByScenario = new Map<E3PersonaScenarioId, number>();
  return turns.map((turn) => {
    const questionOrdinal = (ordinalByScenario.get(turn.scenarioId) ?? 0) + 1;
    ordinalByScenario.set(turn.scenarioId, questionOrdinal);
    return {
      scenarioId: turn.scenarioId,
      questionOrdinal,
      factIds: [...new Set(turn.disclosedFactIds)].sort(),
      testStates: [...new Set(turn.testStatesBeforeTurn)].sort(),
    };
  });
}

function notRunJourney(input: {
  runId: string;
  casePackage: CasePackageV2;
  reason: string;
}): E3JourneyResult {
  const medicalContentDigest = computeMedicalContentDigest(input.casePackage);
  const run: E3PersonaRunEvidence = {
    runId: input.runId,
    personaTemplateId: input.casePackage.patientPersona.personaTemplateId,
    status: "not_run",
    anchorPublicCaseId: input.casePackage.publicCaseId,
    anchorCaseVersion: input.casePackage.caseVersion,
    medicalContentDigest,
    variantContentHash: input.casePackage.provenance.contentHash,
    committedTurns: 0,
    fullHistoryTurns: 0,
    patientGeneratedReplies: 0,
    patientProviderCalls: 0,
    controllerProviderCalls: 0,
    localFakeReplies: 0,
    diagnosisLeaks: 0,
    uncompletedTestResultLeaks: 0,
    scenarioMedicalReferences: scenarioMedicalReferences([]),
    failureCode: input.reason,
  };
  return {
    run,
    journey: {
      schemaVersion: "e3-private-persona-journey-v1",
      runId: input.runId,
      personaTemplateId: input.casePackage.patientPersona.personaTemplateId,
      medicalContentDigest,
      status: "not_run",
      failureCode: input.reason,
      turns: [],
    },
    auditJourney: {
      runId: input.runId,
      expectedPersonaTemplateId:
        input.casePackage.patientPersona.personaTemplateId,
      turns: [],
    },
    samples: [],
    actualModelIds: [],
  };
}

async function runPersonaJourney(input: {
  runId: string;
  casePackage: CasePackageV2;
  provider: E3ObservedOpenAIModelProvider;
}): Promise<E3JourneyResult> {
  const events = new MemoryEventSink();
  const service = createHeadlessModelService({
    cases: [input.casePackage],
    provider: input.provider,
    eventSink: events,
    safetyAuditHmacKey: "e3-persona-live-benchmark-hmac-key-000000000000",
  });
  const medicalContentDigest = computeMedicalContentDigest(input.casePackage);
  const turns: E3TurnEvidence[] = [];
  const samples: Phase8PatientReplySampleV1[] = [];
  let fullHistoryTurns = 0;
  let patientGeneratedReplies = 0;
  let diagnosisLeaks = 0;
  let uncompletedTestResultLeaks = 0;
  let failureCode: string | undefined;
  try {
    const created = await service.createSession({
      clientRequestId: `${input.runId}.create`,
      publicCaseId: input.casePackage.publicCaseId,
      patientNpcId: `npc.${input.runId}`,
    });
    let turnNumber = 0;
    outer: for (const scenario of E3_PERSONA_SCENARIOS) {
      for (const question of scenario.userTurns) {
        turnNumber += 1;
        const beforeEventCount = events.events.length;
        const beforeInputCount = input.provider.patientInputs.length;
        const clientTurnId = `${input.runId}.turn.${turnNumber}`;
        try {
          const turn = await service.askPatient({
            sessionId: created.session.sessionId,
            clientTurnId,
            text: question,
          });
          const newEvents = events.events.slice(beforeEventCount);
          const patientInputs = input.provider.patientInputs.slice(beforeInputCount);
          const patientInput = patientInputs.at(-1);
          if (patientInput === undefined) {
            throw new E3EvidenceIntegrityError(
              `E3 Patient input missing for ${clientTurnId}`,
            );
          }
          if (
            patientInputs.every(
              ({ recentTurns }) => recentTurns.length === turnNumber - 1,
            )
          ) {
            fullHistoryTurns += 1;
          }
          const patientProviderCalls = countProviderCalls(newEvents, "patient");
          const completedPatientProviderCalls = countProviderCalls(
            newEvents,
            "patient",
            ["completed"],
          );
          const controllerProviderCalls = countProviderCalls(newEvents, "controller");
          if (completedPatientProviderCalls > 0) patientGeneratedReplies += 1;
          const committed = eventForTurn(newEvents, clientTurnId);
          const interactionKind = String(
            committed.payload["interactionKind"] ?? "",
          );
          const personaFactIdsUsed = stringArray(
            committed.payload["personaFactIdsUsed"],
          );
          const completedTestIdsUsed = stringArray(
            committed.payload["completedTestIdsUsed"],
          );
          const testStatesBeforeTurn = patientInput.safeCaseView.tests.map(
            ({ testId, status }) => `${testId}:${status}`,
          );
          const forbiddenDiagnosisTerms = [
            input.casePackage.answerKey.targetDiagnosis,
            ...input.casePackage.answerKey.acceptedSynonyms,
          ];
          if (
            forbiddenDiagnosisTerms.some((term) =>
              normalized(turn.reply).includes(normalized(term))
            )
          ) {
            diagnosisLeaks += 1;
          }
          for (const test of patientInput.safeCaseView.tests) {
            const privateReport = input.casePackage.medicalTests[test.testId]?.report;
            if (
              test.status !== "completed" &&
              privateReport !== undefined &&
              normalized(turn.reply).includes(normalized(privateReport))
            ) {
              uncompletedTestResultLeaks += 1;
            }
          }
          turns.push({
            turnNumber,
            scenarioId: scenario.scenarioId,
            question,
            reply: turn.reply,
            interactionKind,
            disclosedFactIds: [...turn.disclosedFactIds],
            personaFactIdsUsed,
            completedTestIdsUsed,
            effects: structuredClone(turn.effects),
            patientProviderCalls,
            controllerProviderCalls,
            priorHistoryTurns: patientInput.recentTurns.length,
            testStatesBeforeTurn,
          });
          samples.push({
            sampleId: `${input.runId}.turn-${turnNumber}`,
            caseId: input.casePackage.publicCaseId,
            caseVersion: input.casePackage.caseVersion,
            question,
            reply: turn.reply,
            disclosedFactIds: [...turn.disclosedFactIds],
            authorizedFacts: turn.disclosedFactIds.flatMap((factId) => {
              const fact = input.casePackage.patientFacts[factId];
              return fact === undefined
                ? []
                : [{ factId, status: fact.status, value: fact.value }];
            }),
            authorizedPersonaFacts: personaFactIdsUsed.flatMap((personaFactId) => {
              const fact = patientInput.patientProfile.personaFacts.find(
                (entry) => entry.personaFactId === personaFactId,
              );
              return fact === undefined ? [] : [structuredClone(fact)];
            }),
            authorizedTestReports: completedTestIdsUsed.flatMap((testId) => {
              const completed = patientInput.completedTests.find(
                (test) => test.testId === testId,
              );
              return completed?.report === undefined
                ? []
                : [{ testId, report: completed.report }];
            }),
            authorizedTests: patientInput.safeCaseView.tests.map((test) => ({
              testId: test.testId,
              displayName: test.displayName,
              aliases: [...test.aliases],
              status: test.status,
              ...(test.report === undefined ? {} : { report: test.report }),
            })),
            personaTemplateId: input.casePackage.patientPersona.personaTemplateId,
            personaBehaviorInstructions: [
              ...patientInput.patientProfile.behaviorInstructions,
              patientInput.patientProfile.offTopicReminderInstruction,
            ],
            interactionKind,
            recentTurns: patientInput.recentTurns.map((entry) => ({
              question: entry.userText,
              reply: entry.patientReply,
            })),
            forbiddenDiagnosisTerms,
          });
        } catch (error) {
          if (!isE3NonBlockingJourneyFailure(error)) {
            throw error;
          }
          const providerFailure = [...events.events].reverse().find(
            ({ eventType }) => eventType === "provider.call.failed",
          );
          const providerFailureCode = providerFailure?.payload["failureCode"];
          const message = error instanceof Error
            ? error.message
            : "unknown E3 turn failure";
          failureCode = typeof providerFailureCode === "string"
            ? `${message} [${providerFailureCode}]`
            : message;
          break outer;
        }
      }
    }
  } finally {
    service.close();
  }
  const patientProviderCalls = countProviderCalls(events.events, "patient");
  const controllerProviderCalls = countProviderCalls(events.events, "controller");
  const actualModelIds = [...new Set(
    events.events
      .filter(
        ({ eventType, payload }) =>
          eventType === "provider.call.completed" &&
          payload["role"] === "patient" &&
          typeof payload["modelId"] === "string",
      )
      .map(({ payload }) => payload["modelId"] as string),
  )];
  const run: E3PersonaRunEvidence = {
    runId: input.runId,
    personaTemplateId: input.casePackage.patientPersona.personaTemplateId,
    status: failureCode === undefined ? "completed" : "failed",
    anchorPublicCaseId: input.casePackage.publicCaseId,
    anchorCaseVersion: input.casePackage.caseVersion,
    medicalContentDigest,
    variantContentHash: input.casePackage.provenance.contentHash,
    committedTurns: turns.length,
    fullHistoryTurns,
    patientGeneratedReplies,
    patientProviderCalls,
    controllerProviderCalls,
    localFakeReplies: turns.length - patientGeneratedReplies,
    diagnosisLeaks,
    uncompletedTestResultLeaks,
    scenarioMedicalReferences: scenarioMedicalReferences(turns),
    ...(failureCode === undefined ? {} : { failureCode }),
  };
  return {
    run,
    journey: {
      schemaVersion: "e3-private-persona-journey-v1",
      runId: input.runId,
      personaTemplateId: input.casePackage.patientPersona.personaTemplateId,
      medicalContentDigest,
      status: run.status,
      ...(run.failureCode === undefined ? {} : { failureCode: run.failureCode }),
      turns,
    },
    auditJourney: {
      runId: input.runId,
      expectedPersonaTemplateId:
        input.casePackage.patientPersona.personaTemplateId,
      turns: turns.map(({ question, reply }) => ({ question, reply })),
    },
    samples,
    actualModelIds,
  };
}

async function main(): Promise<void> {
  let stagingDirectory: string | undefined;
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const anchorPath = resolveInsideModel(modelRoot, args.anchorCase);
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (!existsSync(anchorPath)) {
      throw new Error(`E3 锚点病例不存在：${args.anchorCase}`);
    }
    if (existsSync(outputDirectory)) {
      throw new Error("E3 输出目录已存在；不会覆盖既有证据。");
    }
    stagingDirectory = `${outputDirectory}.tmp-${randomUUID()}`;
    mkdirSync(stagingDirectory, { recursive: true });
    const [anchorCase] = loadCasePackages([anchorPath]);
    const anchorSha256 = sha256File(anchorPath);
    assertE3LowRiskAnchor(anchorCase!, anchorSha256);
    const caseVariants = buildE3PersonaCaseVariants(anchorCase!);
    const medicalDigests = new Set(caseVariants.map(computeMedicalContentDigest));
    if (medicalDigests.size !== 1) {
      throw new Error("E3 六人格病例变体的医学内容不一致。");
    }
    const contentManifest = loadCaseManifestV2(
      resolve(modelRoot, "cases/manifest.phase6-compat.v2-rc2.json"),
    );
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const provider = new E3ObservedOpenAIModelProvider({
      modelId: args.modelId,
      promptVersion: contentManifest.patientPromptVersion,
      promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
      transport,
      callTimeoutMs: 300_000,
      operationTimeoutMs: 620_000,
      maxRetries: 1,
    });
    const ruleCorpus = buildE3PersonaRuleCorpus();
    const results: E3JourneyResult[] = [];
    let providerInfrastructureFailure: string | undefined;
    for (const [index, casePackage] of caseVariants.entries()) {
      const runId = `e3-run-${String(index + 1).padStart(2, "0")}`;
      const result = providerInfrastructureFailure === undefined
        ? await runPersonaJourney({ runId, casePackage, provider })
        : notRunJourney({
            runId,
            casePackage,
            reason: `Skipped after Provider infrastructure failure: ${providerInfrastructureFailure}`,
          });
      if (
        providerInfrastructureFailure === undefined &&
        result.run.status === "failed" &&
        result.run.committedTurns === 0 &&
        result.run.failureCode !== undefined &&
        /\[OPENAI_[A-Z_]+\]/u.test(
          result.run.failureCode,
        )
      ) {
        providerInfrastructureFailure = result.run.failureCode;
      }
      results.push(result);
      writeJsonExclusive(
        resolve(
          stagingDirectory,
          "private",
          "journeys",
          `${result.run.runId}.json`,
        ),
        result.journey,
      );
      process.stderr.write(
        `[e3] ${result.run.personaTemplateId}: ${result.run.status} (${result.run.committedTurns} turns)${result.run.failureCode === undefined ? "" : ` - ${result.run.failureCode}`}\n`,
      );
    }
    const samples = results.flatMap(({ samples: value }) => value);
    const actualModelIds = [...new Set(
      results.flatMap(({ actualModelIds: values }) => values),
    )];
    if (actualModelIds.length > 1) {
      throw new Error("E3 Patient Agent actual model ID drifted during the run.");
    }
    const completeAuditCoverage =
      results.every(({ run }) => run.status === "completed") &&
      samples.length >= 72;
    const audit = completeAuditCoverage
      ? await generateE3PersonaAiCrossReview({
          journeys: results.map(({ auditJourney }) => auditJourney),
          samples,
          transport,
          modelId: args.modelId,
          ...(actualModelIds.length === 1
            ? { expectedActualModelId: actualModelIds[0] }
            : {}),
        })
      : buildE3PersonaNotRunReview(
          providerInfrastructureFailure ??
            "E3 live journeys did not reach the minimum 72 committed samples.",
        );
    const report = buildE3PersonaBenchmarkReport({
      ruleCorpus,
      runs: results.map(({ run }) => run),
      audit: audit.validations,
    });
    const ruleCorpusPath = resolve(
      stagingDirectory,
      "e3-persona-rule-corpus.v1.json",
    );
    const samplePath = resolve(
      stagingDirectory,
      "private",
      "patient-samples.v1.json",
    );
    const auditPath = resolve(
      stagingDirectory,
      "e3-persona-ai-cross-review.v1.json",
    );
    writeJsonExclusive(ruleCorpusPath, ruleCorpus);
    writeJsonExclusive(samplePath, {
      schemaVersion: "e3-private-patient-sample-set-v1",
      sampleCount: samples.length,
      sampleSetSha256: sha256Canonical(samples),
      samples,
    });
    writeJsonExclusive(auditPath, audit);
    const providerManifest = provider.reproducibilityManifest();
    const journeyArtifacts = createE3JourneyArtifactBindings(
      stagingDirectory,
      results.map(({ run }) => run.runId),
    );
    const reportPath = resolve(
      stagingDirectory,
      "e3-persona-benchmark-report.v2.json",
    );
    writeJsonExclusive(reportPath, {
      ...report,
      evidenceStatus: "live_provider_observation",
      provider: {
        providerName: runtime.providerName,
        protocol: providerManifest.protocol,
        endpointSha256: providerManifest.endpointSha256,
        configuredModelId: args.modelId,
        actualModelIds,
        promptVersion: provider.identity.promptVersion,
      },
      bindings: {
        anchorCasePath: relative(modelRoot, anchorPath).replaceAll("\\", "/"),
        anchorCaseSha256: anchorSha256,
        medicalContentDigest: [...medicalDigests][0],
        variantContentHashes: caseVariants.map(
          ({ provenance }) => provenance.contentHash,
        ),
        ruleCorpusSha256: sha256Canonical(ruleCorpus),
        patientPromptSha256: sha256File(
          resolve(
            modelRoot,
            `prompts/patient/${contentManifest.patientPromptVersion}.md`,
          ),
        ),
        sampleSetSha256: sha256Canonical(samples),
        auditSha256: sha256File(auditPath),
        journeyArtifacts,
        reusePolicy: {
          schemaVersion: "e3-reuse-policy-v1",
          configuredModelId: args.modelId,
          releasePolicySha256: sha256Canonical(contentManifest.releasePolicy),
          ...buildE3ReuseSourceBinding(modelRoot),
        },
      },
    });
    const reportSha256 = sha256File(reportPath);
    await renameE3EvidenceDirectory(stagingDirectory, outputDirectory);
    stagingDirectory = undefined;
    process.stdout.write(`${JSON.stringify({
      status: "E3_PERSONA_BENCHMARK_REPORTED",
      decision: report.decision,
      reviewPolicy: report.reviewPolicy,
      personas: report.coverage.realPersonas,
      ruleAssertions: report.coverage.ruleAssertions,
      committedTurns: report.coverage.committedTurns,
      personaConsistencyRate: report.metrics.personaConsistencyRate,
      findings: report.findings.length,
      outputDirectory: relative(modelRoot, outputDirectory).replaceAll("\\", "/"),
      reportSha256,
    }, null, 2)}\n`);
  } catch (error) {
    if (stagingDirectory !== undefined && existsSync(stagingDirectory)) {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
    const message = error instanceof Error ? error.message : "未知 E3 benchmark 错误。";
    process.stderr.write(`E3 persona benchmark 失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  await main();
}
