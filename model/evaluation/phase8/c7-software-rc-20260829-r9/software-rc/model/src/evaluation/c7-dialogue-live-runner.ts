import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { createHeadlessModelService } from "../application/create-headless-model-service.js";
import { loadCasePackages } from "../cli/case-loader.js";
import type { CasePackage } from "../domain/case-package.js";
import { buildSafePatientCaseView } from "../domain/safe-patient-case-view.js";
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
  buildC7DialogueArchitectureReport,
  type C7DialogueRunEvidence,
  type C7ObservedTestState,
} from "./c7-dialogue-architecture-benchmark.js";
import {
  generatePhase8PatientSampleValidation,
  type Phase8PatientReplySampleV1,
} from "./phase8-ai-evidence.js";

const C7_PROMPT_VERSION = "v0.2.0";
const C7_TURNS = [
  "你好",
  "请问有什么症状么",
  "现在还这样么",
  "今天天气不错",
  "你平时喜欢做什么",
  "我们先聊会儿别的吧",
  "最近忙不忙",
  "现在还是有这样的症状么",
  "量一下体温",
  "你的CT结果怎么样",
  "好，那去做吧",
  "CT现在是什么结果",
] as const;
const CONTEXT_TURN_INDEXES = new Set([2, 7]);

const USAGE = `用法：npm run c7:dialogue-live -- --model <modelId> --ai-evidence <dir> --output <dir>

该命令只接受 C7 新 AI evidence index 绑定的五个 published 病例，使用 Patient Agent v0.2.0 对每例执行 12 轮真实 Provider 长旅程，并生成独立双角色回复审计与 C7 发布指标。`;

interface AiEvidenceIndex {
  schemaVersion: "phase8-ai-evidence-index-v1";
  supersededInputExcluded: true;
  provider: {
    providerName: string;
    protocol: string;
    endpointSha256: string;
    configuredModelId: string;
    actualModelId: string;
  };
  caseManifest: { path: string; sha256: string };
  caseValidations: Array<{
    publicCaseId: string;
    caseVersion: string;
    contentHash: string;
    path: string;
    sha256: string;
  }>;
  caseValidationSetSha256: string;
}

interface PublishedManifest {
  publishedCases: Array<{
    publicCaseId: string;
    caseVersion: string;
    contentHash: string;
    path: string;
    validationRecordPath: string;
  }>;
}

interface DialogueTurnEvidence {
  turnNumber: number;
  question: string;
  reply: string;
  disclosedFactIds: string[];
  interactionKind: string;
  personaFactIdsUsed: string[];
  completedTestIdsUsed: string[];
  effects: unknown[];
  patientProviderCalls: number;
  controllerProviderCalls: number;
  sessionSnapshotBeforeTurn: C7PatientSessionSnapshot;
}

export interface C7PatientSessionSnapshot {
  pendingTestSuggestionId?: string;
  completedTests: Array<{
    testId: string;
    status: "unavailable" | "completed";
    report?: string;
  }>;
}

export interface C7CommittedTurnEvidence {
  interactionKind: string;
  disclosedFactIds: readonly string[];
  completedTestIdsUsed: readonly string[];
  effects: readonly unknown[];
}

export function isC7ContextFollowupCorrect(input: {
  expectedRecentFactIds: readonly string[];
  committedTurn: C7CommittedTurnEvidence;
}): boolean {
  const expected = new Set(input.expectedRecentFactIds);
  return (
    expected.size > 0 &&
    input.committedTurn.interactionKind === "medical_chat" &&
    input.committedTurn.disclosedFactIds.some((factId) => expected.has(factId))
  );
}

function completedTest(
  snapshot: C7PatientSessionSnapshot,
  testId: string,
): C7PatientSessionSnapshot["completedTests"][number] | undefined {
  return snapshot.completedTests.find((test) => test.testId === testId);
}

function committedCompletedTest(
  turn: C7CommittedTurnEvidence,
  testId: string,
): boolean {
  return turn.effects.some((effect) => {
    if (typeof effect !== "object" || effect === null) return false;
    const record = effect as Record<string, unknown>;
    if (record["type"] !== "test_completed") return false;
    const result = record["result"];
    return (
      typeof result === "object" &&
      result !== null &&
      (result as Record<string, unknown>)["testId"] === testId
    );
  });
}

export function assessC7ChestCtJourney(input: {
  querySnapshot: C7PatientSessionSnapshot;
  queryTurn: C7CommittedTurnEvidence;
  confirmationSnapshot: C7PatientSessionSnapshot;
  confirmationTurn: C7CommittedTurnEvidence;
  resultQuerySnapshot: C7PatientSessionSnapshot;
  resultQueryTurn: C7CommittedTurnEvidence;
  resultQueryReply: string;
}): {
  observedTestStates: C7ObservedTestState[];
  queryCorrect: boolean;
  confirmationCorrect: boolean;
  resultQueryCorrect: boolean;
} {
  const testId = "test.chest_ct";
  const notCompleted = completedTest(input.querySnapshot, testId) === undefined;
  const pendingConfirmation =
    notCompleted &&
    input.queryTurn.interactionKind === "test_query" &&
    input.queryTurn.effects.length === 0 &&
    input.confirmationSnapshot.pendingTestSuggestionId === testId;
  const confirmationCorrect =
    input.confirmationSnapshot.pendingTestSuggestionId === testId &&
    committedCompletedTest(input.confirmationTurn, testId);
  const completedResult = completedTest(input.resultQuerySnapshot, testId);
  const completed = completedResult?.status === "completed";
  const resultQueryCorrect =
    completed &&
    input.resultQueryTurn.completedTestIdsUsed.includes(testId) &&
    completedResult.report !== undefined &&
    normalized(input.resultQueryReply).includes(normalized(completedResult.report));
  return {
    observedTestStates: [
      ...(notCompleted ? ["not_completed" as const] : []),
      ...(pendingConfirmation ? ["pending_confirmation" as const] : []),
      ...(completed ? ["completed" as const] : []),
    ],
    queryCorrect: pendingConfirmation,
    confirmationCorrect,
    resultQueryCorrect,
  };
}

export function assertC7DialogueAuditModelBinding(
  validations: readonly { modelId: string }[],
  expectedActualModelId: string,
): void {
  if (
    validations.length === 0 ||
    validations.some(({ modelId }) => modelId !== expectedActualModelId)
  ) {
    throw new Error(
      "C7 dialogue sample audit model ID drifted from dual AI evidence.",
    );
  }
}

class C7ObservedOpenAIModelProvider extends OpenAIModelProvider {
  readonly patientInputs: PatientInput[] = [];

  constructor(options: OpenAIModelProviderOptions) {
    super(options);
  }

  override async generatePatientReply(input: PatientInput): Promise<PatientReply> {
    this.patientInputs.push(structuredClone(input));
    return super.generatePatientReply(input);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv: readonly string[]): {
  modelId: string;
  aiEvidenceDirectory: string;
  outputDirectory: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--model", "--ai-evidence", "--output"].includes(key ?? "")) {
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
  const aiEvidenceDirectory = values.get("--ai-evidence");
  const outputDirectory = values.get("--output");
  if (
    modelId === undefined ||
    aiEvidenceDirectory === undefined ||
    outputDirectory === undefined
  ) {
    throw new Error("必须提供 --model、--ai-evidence 和 --output。");
  }
  return { modelId: modelId.trim(), aiEvidenceDirectory, outputDirectory };
}

function resolveInsideModel(modelRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    throw new Error("C7 路径必须使用 model/ 内相对路径。");
  }
  const resolvedPath = resolve(modelRoot, requestedPath);
  const relativePath = relative(modelRoot, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("C7 路径必须位于 model/ 内。");
  }
  return resolvedPath;
}

function resolveBoundFile(modelRoot: string, path: string): string {
  const resolvedPath = resolveInsideModel(modelRoot, path);
  if (!existsSync(resolvedPath)) throw new Error(`C7 绑定文件不存在：${path}`);
  return resolvedPath;
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function eventForTurn(events: readonly ModelEvent[], clientTurnId: string): ModelEvent {
  const event = [...events].reverse().find(
    ({ eventType, payload }) =>
      eventType === "patient.reply.completed" &&
      payload["clientTurnId"] === clientTurnId,
  );
  if (event === undefined) {
    throw new Error(`C7 committed event missing for ${clientTurnId}`);
  }
  return event;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : [];
}

function countProviderCalls(
  events: readonly ModelEvent[],
  role: "controller" | "patient" | "review",
): number {
  return events.filter(
    ({ eventType, payload }) =>
      eventType === "provider.call.completed" && payload["role"] === role,
  ).length;
}

async function runCaseJourney(input: {
  casePackage: CasePackage;
  provider: C7ObservedOpenAIModelProvider;
}): Promise<{
  run: C7DialogueRunEvidence;
  turns: DialogueTurnEvidence[];
  samples: Phase8PatientReplySampleV1[];
  actualModelIds: string[];
}> {
  const events = new MemoryEventSink();
  const service = createHeadlessModelService({
    cases: [input.casePackage],
    provider: input.provider,
    eventSink: events,
    safetyAuditHmacKey: "c7-live-benchmark-stable-hmac-key-000000000000",
  });
  const turns: DialogueTurnEvidence[] = [];
  const samples: Phase8PatientReplySampleV1[] = [];
  const completedReports = new Map<string, string>();
  const safeView = buildSafePatientCaseView(input.casePackage);
  let patientGeneratedReplies = 0;
  let contextFollowupsCorrect = 0;
  let testActionsCorrect = 0;
  const observedTestStates = new Set<C7ObservedTestState>();
  let diagnosisLeaks = 0;
  let uncompletedTestResultLeaks = 0;
  let mostRecentDisclosedFactIds: string[] = [];
  try {
    const created = await service.createSession({
      clientRequestId: `c7.create.${input.casePackage.publicCaseId}`,
      publicCaseId: input.casePackage.publicCaseId,
      patientNpcId: `npc.${input.casePackage.publicCaseId}`,
    });
    for (const [index, question] of C7_TURNS.entries()) {
      const beforeEventCount = events.events.length;
      const beforePatientInputCount = input.provider.patientInputs.length;
      const clientTurnId = `c7.${input.casePackage.publicCaseId}.turn.${index + 1}`;
      const turn = await service.askPatient({
        sessionId: created.session.sessionId,
        clientTurnId,
        text: question,
      });
      const newEvents = events.events.slice(beforeEventCount);
      const patientInputs = input.provider.patientInputs.slice(
        beforePatientInputCount,
      );
      if (patientInputs.length === 0) {
        throw new Error(`C7 Patient session snapshot missing for ${clientTurnId}`);
      }
      const sessionSnapshots = patientInputs.map((patientInput) => ({
        ...(patientInput.pendingTestSuggestionId === undefined
          ? {}
          : {
              pendingTestSuggestionId:
                patientInput.pendingTestSuggestionId,
            }),
        completedTests: patientInput.completedTests.map((test) => ({
          testId: test.testId,
          status: test.status,
          ...(test.report === undefined ? {} : { report: test.report }),
        })),
      } satisfies C7PatientSessionSnapshot));
      const snapshotSignatures = new Set(
        sessionSnapshots.map((snapshot) => JSON.stringify(snapshot)),
      );
      if (snapshotSignatures.size !== 1) {
        throw new Error(`C7 Patient session snapshot drifted for ${clientTurnId}`);
      }
      const sessionSnapshotBeforeTurn = sessionSnapshots[0]!;
      const patientCalls = countProviderCalls(newEvents, "patient");
      const controllerCalls = countProviderCalls(newEvents, "controller");
      if (patientCalls > 0) patientGeneratedReplies += 1;
      const committed = eventForTurn(newEvents, clientTurnId);
      const interactionKind = String(committed.payload["interactionKind"] ?? "");
      const personaFactIdsUsed = stringArray(
        committed.payload["personaFactIdsUsed"],
      );
      const completedTestIdsUsed = stringArray(
        committed.payload["completedTestIdsUsed"],
      );
      for (const effect of turn.effects) {
        if (effect.type === "test_completed") {
          completedReports.set(effect.result.testId, effect.result.report ?? "");
        }
      }
      if (
        CONTEXT_TURN_INDEXES.has(index) &&
        isC7ContextFollowupCorrect({
          expectedRecentFactIds: mostRecentDisclosedFactIds,
          committedTurn: {
            interactionKind,
            disclosedFactIds: turn.disclosedFactIds,
            completedTestIdsUsed,
            effects: turn.effects,
          },
        })
      ) {
        contextFollowupsCorrect += 1;
      }
      if (turn.disclosedFactIds.length > 0) {
        mostRecentDisclosedFactIds = [...turn.disclosedFactIds];
      }
      if (index === 8) {
        const correct = turn.effects.some(
          (effect) =>
            effect.type === "test_completed" &&
            effect.result.testId === "test.vital_signs",
        );
        if (correct) testActionsCorrect += 1;
      }
      if (index === 9) {
        const ctReport = input.casePackage.medicalTests["test.chest_ct"]?.report;
        if (
          ctReport !== undefined &&
          normalized(turn.reply).includes(normalized(ctReport))
        ) {
          uncompletedTestResultLeaks += 1;
        }
      }
      const forbiddenTerms = [
        input.casePackage.answerKey.targetDiagnosis,
        ...input.casePackage.answerKey.acceptedSynonyms,
      ];
      if (
        forbiddenTerms.some((term) =>
          normalized(turn.reply).includes(normalized(term)),
        )
      ) {
        diagnosisLeaks += 1;
      }
      const turnEvidence: DialogueTurnEvidence = {
        turnNumber: index + 1,
        question,
        reply: turn.reply,
        disclosedFactIds: [...turn.disclosedFactIds],
        interactionKind,
        personaFactIdsUsed,
        completedTestIdsUsed,
        effects: structuredClone(turn.effects),
        patientProviderCalls: patientCalls,
        controllerProviderCalls: controllerCalls,
        sessionSnapshotBeforeTurn: structuredClone(sessionSnapshotBeforeTurn),
      };
      turns.push(turnEvidence);
      samples.push({
        sampleId: `${input.casePackage.publicCaseId}.turn-${index + 1}`,
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
          const fact = safeView.patientProfile.personaFacts.find(
            (entry) => entry.personaFactId === personaFactId,
          );
          return fact === undefined ? [] : [structuredClone(fact)];
        }),
        authorizedTestReports: completedTestIdsUsed.flatMap((testId) => {
          const report = completedTest(
            sessionSnapshotBeforeTurn,
            testId,
          )?.report;
          return report === undefined ? [] : [{ testId, report }];
        }),
        authorizedTests: safeView.tests.map((test) => {
          const snapshotTest = completedTest(
            sessionSnapshotBeforeTurn,
            test.testId,
          );
          const report = snapshotTest?.report;
          return {
            testId: test.testId,
            displayName: test.displayName,
            aliases: [...test.aliases],
            status: snapshotTest === undefined
              ? "not_completed" as const
              : snapshotTest.status,
            ...(report === undefined ? {} : { report }),
          };
        }),
        personaTemplateId: safeView.patientProfile.templateId,
        personaBehaviorInstructions: [
          ...safeView.patientProfile.behaviorInstructions,
          safeView.patientProfile.offTopicReminderInstruction,
        ],
        interactionKind,
        recentTurns: turns.slice(-5, -1).map((entry) => ({
          question: entry.question,
          reply: entry.reply,
        })),
        forbiddenDiagnosisTerms: forbiddenTerms,
      });
    }
    const ctAssessment = assessC7ChestCtJourney({
      querySnapshot: turns[9]!.sessionSnapshotBeforeTurn,
      queryTurn: turns[9]!,
      confirmationSnapshot: turns[10]!.sessionSnapshotBeforeTurn,
      confirmationTurn: turns[10]!,
      resultQuerySnapshot: turns[11]!.sessionSnapshotBeforeTurn,
      resultQueryTurn: turns[11]!,
      resultQueryReply: turns[11]!.reply,
    });
    for (const state of ctAssessment.observedTestStates) {
      observedTestStates.add(state);
    }
    testActionsCorrect += Number(ctAssessment.queryCorrect);
    testActionsCorrect += Number(ctAssessment.confirmationCorrect);
    testActionsCorrect += Number(ctAssessment.resultQueryCorrect);
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
    return {
      run: {
        publicCaseId: input.casePackage.publicCaseId,
        caseVersion: input.casePackage.caseVersion,
        contentHash: input.casePackage.provenance.contentHash!,
        personaTemplateId: safeView.patientProfile.templateId,
        status: "completed",
        committedTurns: turns.length,
        patientGeneratedReplies,
        patientProviderCalls,
        controllerProviderCalls,
        localFakeReplies: turns.length - patientGeneratedReplies,
        contextFollowupsEvaluated: CONTEXT_TURN_INDEXES.size,
        contextFollowupsCorrect,
        testActionsEvaluated: 4,
        testActionsCorrect,
        observedTestStates: [...observedTestStates],
        diagnosisLeaks,
        uncompletedTestResultLeaks,
      },
      turns,
      samples,
      actualModelIds,
    };
  } finally {
    service.close();
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const aiEvidenceDirectory = resolveInsideModel(
      modelRoot,
      args.aiEvidenceDirectory,
    );
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (existsSync(outputDirectory)) {
      throw new Error("C7 dialogue output 已存在；不会覆盖既有证据。");
    }
    mkdirSync(outputDirectory, { recursive: true });
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const indexPath = resolve(aiEvidenceDirectory, "ai-evidence-index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as AiEvidenceIndex;
    if (
      index.schemaVersion !== "phase8-ai-evidence-index-v1" ||
      index.supersededInputExcluded !== true ||
      index.provider.providerName !== runtime.providerName ||
      index.provider.protocol !== "openai-responses" ||
      index.provider.endpointSha256 !== runtime.endpointSha256 ||
      index.provider.configuredModelId !== args.modelId ||
      index.caseValidations.length !== 5
    ) {
      throw new Error("C7 AI evidence index 与当前 Provider 或新候选不匹配。");
    }
    const manifestPath = resolveBoundFile(modelRoot, index.caseManifest.path);
    if (sha256File(manifestPath) !== index.caseManifest.sha256) {
      throw new Error("C7 published case manifest hash drifted.");
    }
    for (const validation of index.caseValidations) {
      const path = resolveBoundFile(modelRoot, validation.path);
      if (sha256File(path) !== validation.sha256) {
        throw new Error(`C7 validation hash drifted: ${validation.publicCaseId}`);
      }
    }
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as PublishedManifest;
    if (manifest.publishedCases.length !== 5) {
      throw new Error("C7 live benchmark requires exactly five published cases.");
    }
    const cases = loadCasePackages(
      manifest.publishedCases.map(({ path }) => resolve(modelRoot, "cases", path)),
    );
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const provider = new C7ObservedOpenAIModelProvider({
      modelId: args.modelId,
      promptVersion: C7_PROMPT_VERSION,
      promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
      transport,
    });
    const runs: C7DialogueRunEvidence[] = [];
    const samples: Phase8PatientReplySampleV1[] = [];
    const actualModelIds = new Set<string>();
    for (const casePackage of cases) {
      const result = await runCaseJourney({ casePackage, provider });
      runs.push(result.run);
      samples.push(...result.samples);
      for (const modelId of result.actualModelIds) actualModelIds.add(modelId);
      writeJsonExclusive(
        resolve(
          outputDirectory,
          "private",
          "journeys",
          `${casePackage.publicCaseId}.json`,
        ),
        {
          schemaVersion: "c7-private-dialogue-journey-v1",
          caseId: casePackage.publicCaseId,
          caseVersion: casePackage.caseVersion,
          contentHash: casePackage.provenance.contentHash,
          personaTemplateId: casePackage.patientPersona.personaTemplateId,
          turns: result.turns,
        },
      );
      process.stderr.write(`[c7] completed ${casePackage.publicCaseId}\n`);
    }
    if (actualModelIds.size !== 1 || !actualModelIds.has(index.provider.actualModelId)) {
      throw new Error("C7 live Patient Agent actual model ID drifted from dual AI evidence.");
    }
    const runSetSha256 = sha256Canonical(runs);
    const privateSamples = {
      schemaVersion: "c7-private-patient-sample-set-v1",
      runSetSha256,
      sampleSetSha256: sha256Canonical(samples),
      sampleCount: samples.length,
      samples,
    };
    writeJsonExclusive(
      resolve(outputDirectory, "private", "patient-samples.v1.json"),
      privateSamples,
    );
    const audit = await generatePhase8PatientSampleValidation({
      samples,
      transport,
      modelId: args.modelId,
      candidateRunSetSha256: runSetSha256,
      minimumSamples: 60,
      batchSize: 20,
    });
    assertC7DialogueAuditModelBinding(
      audit.validations,
      index.provider.actualModelId,
    );
    const auditPath = resolve(
      outputDirectory,
      "dialogue-sample-ai-validation.json",
    );
    writeJsonExclusive(auditPath, audit);
    const auditDiagnosisLeaks = Math.max(
      ...audit.validations.map(({ diagnosisLeaks }) => diagnosisLeaks),
    );
    const report = buildC7DialogueArchitectureReport({
      runs,
      audit: {
        decision: audit.decision,
        personaConsistencyRate: audit.naturalAndRoleConsistentRate,
        seriousFactErrors: audit.factOrSafetySeriousErrors,
        diagnosisLeaks: auditDiagnosisLeaks,
        uncompletedTestResultLeaks: runs.reduce(
          (sum, run) => sum + run.uncompletedTestResultLeaks,
          0,
        ),
      },
    });
    const providerManifest = provider.reproducibilityManifest();
    const reportArtifact = {
      ...report,
      evidenceStatus: "live_provider_evidence",
      runSetSha256,
      provider: {
        providerName: runtime.providerName,
        protocol: providerManifest.protocol,
        endpointSha256: providerManifest.endpointSha256,
        configuredModelId: args.modelId,
        actualModelId: [...actualModelIds][0],
        promptVersion: provider.identity.promptVersion,
      },
      bindings: {
        aiEvidenceIndexSha256: sha256File(indexPath),
        caseManifestSha256: index.caseManifest.sha256,
        caseValidationSetSha256: index.caseValidationSetSha256,
        patientPromptSha256: sha256File(
          resolve(modelRoot, "prompts/patient/v0.2.0.md"),
        ),
        shareContractSha256: sha256File(
          resolve(modelRoot, "../share/versions/contract-v1-rc1.json"),
        ),
        dialogueAuditSha256: sha256File(auditPath),
      },
    };
    const reportPath = resolve(
      outputDirectory,
      "c7-dialogue-architecture-report.json",
    );
    writeJsonExclusive(reportPath, reportArtifact);
    if (report.gate.status !== "passed") {
      throw new Error(`C7 dialogue gate failed: ${report.gate.blockers.join(", ")}`);
    }
    writeJsonExclusive(resolve(outputDirectory, "provider-model-approval.json"), {
      schemaVersion: "c7-provider-model-approval-v1",
      decision: "approved",
      decisionRef: "c7.dialogue-architecture.2026-08-28",
      decidedAt: new Date().toISOString(),
      provider: reportArtifact.provider,
      report: {
        path: relative(modelRoot, reportPath).replaceAll("\\", "/"),
        sha256: sha256File(reportPath),
      },
      audit: {
        path: relative(modelRoot, auditPath).replaceAll("\\", "/"),
        sha256: sha256File(auditPath),
      },
    });
    process.stdout.write(`${JSON.stringify({
      status: "C7_DIALOGUE_LIVE_BENCHMARK_READY",
      outputDirectory: relative(modelRoot, outputDirectory).replaceAll("\\", "/"),
      cases: report.coverage.caseCount,
      personas: report.coverage.personaCount,
      turns: runs.reduce((sum, run) => sum + run.committedTurns, 0),
      patientGeneratedReplyRate: report.metrics.patientGeneratedReplyRate,
      personaConsistencyRate: report.metrics.personaConsistencyRate,
      contextFollowupAccuracy: report.metrics.contextFollowupAccuracy,
      testActionAccuracy: report.metrics.naturalLanguageTestActionAccuracy,
      actualModelId: reportArtifact.provider.actualModelId,
      reportSha256: sha256File(reportPath),
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 C7 live benchmark 错误。";
    process.stderr.write(`C7 live benchmark 失败：${message}\n${USAGE}\n`);
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
