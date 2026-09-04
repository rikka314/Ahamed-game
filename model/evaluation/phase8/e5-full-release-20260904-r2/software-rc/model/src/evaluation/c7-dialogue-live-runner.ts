import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { createHeadlessModelService } from "../application/create-headless-model-service.js";
import { loadCaseManifestV2 } from "../cases/case-manifest.js";
import { listC7CaseManifestBindings } from "../release/c7-case-release.js";
import { loadSupportedCasePackages } from "../cli/case-loader.js";
import type { SupportedCasePackage } from "../domain/case-package.js";
import { ModelServiceError } from "../domain/errors.js";
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
  assessC7BenchmarkTestJourney,
  selectC7BenchmarkTestScenario,
} from "../release/c7-runtime-release.js";
import {
  assertContainedDirectory,
  assertContainedRegularFile,
  publishDirectoryExclusive,
  resolveContainedDirectory,
  resolveContainedPathForCreate,
  resolveContainedRegularFile,
} from "../security/contained-path.js";
import {
  buildC7DialogueArchitectureReport,
  toC7DialogueReleasePolicy,
  type C7DialogueRunEvidence,
  type C7ObservedTestState,
} from "./c7-dialogue-architecture-benchmark.js";
import {
  generatePhase8PatientSampleValidation,
  type Phase8PatientReplySampleV1,
} from "./phase8-ai-evidence.js";
import { verifyC7DialogueEvidenceDirectory } from "./c7-dialogue-evidence-verify.js";

const C7_INITIAL_TURNS = [
  "你好",
  "请问有什么症状么",
  "现在还这样么",
  "今天天气不错",
  "你平时喜欢做什么",
  "我们先聊会儿别的吧",
  "最近忙不忙",
  "现在还是有这样的症状么",
  "量一下体温",
] as const;
const CONTEXT_TURN_INDEXES = new Set([2, 7]);

const USAGE = `用法：npm run c7:dialogue-live -- --model <modelId> --ai-evidence <dir> --output <dir>

该命令读取病例 Manifest 的病例数、Patient prompt 版本和最低真实对话轮数，执行真实 Provider 长旅程，并生成独立双角色回复审计与 C7 findings 报告。`;

export async function renameC7DialogueEvidenceDirectory(
  source: string,
  destination: string,
): Promise<void> {
  publishDirectoryExclusive(source, destination);
}

function dialogueQuestions(
  minimumTurns: number,
  benchmarkTest: { displayName: string },
): string[] {
  const questions: string[] = [
    ...C7_INITIAL_TURNS,
    `你的${benchmarkTest.displayName}结果怎么样`,
    "好，那去做吧",
    `${benchmarkTest.displayName}现在是什么结果`,
  ];
  while (questions.length < minimumTurns) {
    questions.push("请继续说说最近还有没有别的不舒服");
  }
  return questions;
}

interface AiEvidenceIndex {
  schemaVersion: "phase8-ai-evidence-index-v1";
  supersededInputExcluded: true;
  provider: {
    providerName: string;
    protocol: string;
    endpointSha256: string;
    configuredModelId: string;
    actualModelId?: string;
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
  reviewPolicy?: "non_blocking";
  reviewFindings?: Array<{ code: string; scope: string; decision: string }>;
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

export function assertC7DialogueAuditModelBinding(
  validations: readonly {
    modelId: string;
    runStatus?: "completed" | "failed_to_run";
    subcallCount?: number;
  }[],
  configuredModelId: string,
  expectedActualModelId?: string,
): void {
  const completedModelId = expectedActualModelId ?? configuredModelId;
  if (
    validations.length === 0 ||
    validations.some(({ modelId, runStatus, subcallCount }) =>
      runStatus === "failed_to_run" && (subcallCount ?? 0) === 0
        ? modelId !== configuredModelId
        : modelId !== completedModelId)
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
  return resolveContainedPathForCreate(modelRoot, requestedPath, "C7 path");
}

function resolveBoundFile(modelRoot: string, path: string): string {
  return resolveContainedRegularFile(modelRoot, path, `C7 bound file ${path}`);
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

export function countC7ProviderCalls(
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

export function collectC7ActualModelIds(
  events: readonly ModelEvent[],
  role: "controller" | "patient" | "review",
): string[] {
  return [...new Set(
    events
      .filter(({ eventType, payload }) =>
        payload["role"] === role &&
        typeof payload["modelId"] === "string" &&
        payload["modelId"].trim().length > 0 &&
        (eventType === "provider.call.completed" ||
          (eventType === "provider.call.failed" &&
            payload["responseStatus"] === "completed")))
      .map(({ payload }) => payload["modelId"] as string),
  )];
}

async function runCaseJourney(input: {
  casePackage: SupportedCasePackage;
  provider: C7ObservedOpenAIModelProvider;
  questions: readonly string[];
}): Promise<{
  run: C7DialogueRunEvidence;
  turns: DialogueTurnEvidence[];
  samples: Phase8PatientReplySampleV1[];
  actualModelIds: string[];
  uncommittedAttempt?: {
    patientProviderCalls: number;
    controllerProviderCalls: number;
  };
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
  const benchmarkTest = selectC7BenchmarkTestScenario(input.casePackage);
  let patientGeneratedReplies = 0;
  let contextFollowupsCorrect = 0;
  const observedTestStates = new Set<C7ObservedTestState>();
  let diagnosisLeaks = 0;
  let uncompletedTestResultLeaks = 0;
  let mostRecentDisclosedFactIds: string[] = [];
  let failureCode: "MODEL_UNAVAILABLE" | "MODEL_OUTPUT_REJECTED" | undefined;
  try {
    const created = await service.createSession({
      clientRequestId: `c7.create.${input.casePackage.publicCaseId}`,
      publicCaseId: input.casePackage.publicCaseId,
      patientNpcId: `npc.${input.casePackage.publicCaseId}`,
    });
    for (const [index, question] of input.questions.entries()) {
      const beforeEventCount = events.events.length;
      const beforePatientInputCount = input.provider.patientInputs.length;
      const clientTurnId = `c7.${input.casePackage.publicCaseId}.turn.${index + 1}`;
      let turn: Awaited<ReturnType<typeof service.askPatient>>;
      try {
        turn = await service.askPatient({
          sessionId: created.session.sessionId,
          clientTurnId,
          text: question,
        });
      } catch (error) {
        if (
          error instanceof ModelServiceError &&
          (error.code === "MODEL_UNAVAILABLE" ||
            error.code === "MODEL_OUTPUT_REJECTED")
        ) {
          failureCode = error.code;
          break;
        }
        throw error;
      }
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
      const patientCalls = countC7ProviderCalls(newEvents, "patient");
      const controllerCalls = countC7ProviderCalls(newEvents, "controller");
      if (countC7ProviderCalls(newEvents, "patient", ["completed"]) > 0) {
        patientGeneratedReplies += 1;
      }
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
      if (index === 9) {
        if (
          normalized(turn.reply).includes(normalized(benchmarkTest.report))
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
    const testAssessment = assessC7BenchmarkTestJourney({
      testId: benchmarkTest.testId,
      turns,
    });
    for (const state of testAssessment.observedTestStates) {
      observedTestStates.add(state);
    }
    const patientProviderCalls = countC7ProviderCalls(events.events, "patient");
    const controllerProviderCalls = countC7ProviderCalls(events.events, "controller");
    const committedPatientProviderCalls = turns.reduce(
      (sum, turn) => sum + turn.patientProviderCalls,
      0,
    );
    const committedControllerProviderCalls = turns.reduce(
      (sum, turn) => sum + turn.controllerProviderCalls,
      0,
    );
    const uncommittedAttempt = {
      patientProviderCalls: patientProviderCalls - committedPatientProviderCalls,
      controllerProviderCalls:
        controllerProviderCalls - committedControllerProviderCalls,
    };
    if (
      uncommittedAttempt.patientProviderCalls < 0 ||
      uncommittedAttempt.controllerProviderCalls < 0
    ) {
      throw new Error("C7 Provider call accounting became negative.");
    }
    const actualModelIds = collectC7ActualModelIds(events.events, "patient");
    return {
      run: {
        publicCaseId: input.casePackage.publicCaseId,
        caseVersion: input.casePackage.caseVersion,
        contentHash: input.casePackage.provenance.contentHash!,
        personaTemplateId: safeView.patientProfile.templateId,
        status: failureCode === undefined ? "completed" : "failed",
        committedTurns: turns.length,
        patientGeneratedReplies,
        patientProviderCalls,
        controllerProviderCalls,
        localFakeReplies: turns.length - patientGeneratedReplies,
        contextFollowupsEvaluated: [...CONTEXT_TURN_INDEXES].filter(
          (index) => index < turns.length,
        ).length,
        contextFollowupsCorrect,
        testActionsEvaluated: testAssessment.testActionsEvaluated,
        testActionsCorrect: testAssessment.testActionsCorrect,
        observedTestStates: [...observedTestStates],
        diagnosisLeaks,
        uncompletedTestResultLeaks,
        ...(failureCode === undefined ? {} : { failureCode }),
      },
      turns,
      samples,
      actualModelIds,
      ...(uncommittedAttempt.patientProviderCalls === 0 &&
          uncommittedAttempt.controllerProviderCalls === 0
        ? {}
        : { uncommittedAttempt }),
    };
  } finally {
    service.close();
  }
}

async function main(): Promise<void> {
  let stagingDirectory: string | undefined;
  let retainFailedEvidence = false;
  try {
    const args = parseArguments(process.argv.slice(2));
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const aiEvidenceDirectory = resolveContainedDirectory(
      modelRoot,
      args.aiEvidenceDirectory,
      "C7 AI evidence input",
    );
    const outputDirectory = resolveInsideModel(modelRoot, args.outputDirectory);
    if (existsSync(outputDirectory)) {
      throw new Error("C7 dialogue output 已存在；不会覆盖既有证据。");
    }
    stagingDirectory = `${outputDirectory}.tmp-${randomUUID()}`;
    mkdirSync(stagingDirectory, { recursive: true });
    assertContainedDirectory(modelRoot, stagingDirectory, "C7 dialogue staging output");
    const stagedOutputDirectory = stagingDirectory;
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const contentManifest = loadCaseManifestV2(resolveContainedRegularFile(
      modelRoot,
      "cases/manifest.phase6-compat.v2-rc2.json",
      "C7 content manifest",
    ));
    const releasePolicy = toC7DialogueReleasePolicy(
      contentManifest.releasePolicy,
    );
    const indexPath = assertContainedRegularFile(
      modelRoot,
      resolve(aiEvidenceDirectory, "ai-evidence-index.json"),
      "C7 AI evidence index",
    );
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as AiEvidenceIndex;
    if (
      index.schemaVersion !== "phase8-ai-evidence-index-v1" ||
      index.supersededInputExcluded !== true ||
      index.provider.providerName !== runtime.providerName ||
      index.provider.protocol !== "openai-responses" ||
      index.provider.endpointSha256 !== runtime.endpointSha256 ||
      index.provider.configuredModelId !== args.modelId ||
      index.caseValidations.length !== releasePolicy.expectedCaseCount
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
    const manifestValue = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as unknown;
    const caseBindings = listC7CaseManifestBindings(manifestValue);
    if (caseBindings.length !== releasePolicy.expectedCaseCount) {
      throw new Error(
        `C7 live benchmark manifest expected ${releasePolicy.expectedCaseCount} cases.`,
      );
    }
    const cases = loadSupportedCasePackages(
      caseBindings.map(({ path }) => resolveBoundFile(resolve(modelRoot, "cases"), path)),
    );
    cases.forEach((casePackage, index) => {
      const binding = caseBindings[index]!;
      if (
        casePackage.publicCaseId !== binding.publicCaseId ||
        casePackage.caseVersion !== binding.caseVersion ||
        casePackage.provenance.contentHash !== binding.contentHash ||
        casePackage.packageStatus !== binding.packageStatus
      ) {
        throw new Error(`C7 live benchmark case binding drifted: ${binding.publicCaseId}`);
      }
    });
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const provider = new C7ObservedOpenAIModelProvider({
      modelId: args.modelId,
      promptVersion: contentManifest.patientPromptVersion,
      promptRegistry: new FilePromptRegistry(resolveContainedDirectory(
        modelRoot,
        "prompts",
        "C7 prompt registry",
      )),
      transport,
    });
    const runs: C7DialogueRunEvidence[] = [];
    const samples: Phase8PatientReplySampleV1[] = [];
    const actualModelIds = new Set<string>();
    for (const casePackage of cases) {
      const questions = dialogueQuestions(
        releasePolicy.minimumRealDialogueTurnsPerCase,
        selectC7BenchmarkTestScenario(casePackage),
      );
      const result = await runCaseJourney({ casePackage, provider, questions });
      runs.push(result.run);
      samples.push(...result.samples);
      for (const modelId of result.actualModelIds) actualModelIds.add(modelId);
      writeJsonExclusive(
        resolve(
          stagedOutputDirectory,
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
          runStatus: result.run.status === "completed"
            ? "completed"
            : "failed_to_run",
          ...(result.run.failureCode === undefined
            ? {}
            : { failureCode: result.run.failureCode }),
          ...(result.uncommittedAttempt === undefined
            ? {}
            : { uncommittedAttempt: result.uncommittedAttempt }),
          turns: result.turns,
        },
      );
      process.stderr.write(`[c7] completed ${casePackage.publicCaseId}\n`);
    }
    if (
      actualModelIds.size > 1 ||
      (index.provider.actualModelId !== undefined &&
        actualModelIds.size > 0 &&
        !actualModelIds.has(index.provider.actualModelId))
    ) {
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
      resolve(stagedOutputDirectory, "private", "patient-samples.v1.json"),
      privateSamples,
    );
    const audit = await generatePhase8PatientSampleValidation({
      samples,
      transport,
      modelId: args.modelId,
      candidateRunSetSha256: runSetSha256,
      minimumSamples:
        releasePolicy.expectedCaseCount *
        releasePolicy.minimumRealDialogueTurnsPerCase,
      batchSize: 20,
    });
    for (const validation of audit.validations) {
      if (validation.runStatus !== "failed_to_run" || validation.subcallCount > 0) {
        actualModelIds.add(validation.modelId);
      }
    }
    if (
      actualModelIds.size > 1 ||
      (index.provider.actualModelId !== undefined &&
        actualModelIds.size > 0 &&
        !actualModelIds.has(index.provider.actualModelId))
    ) {
      throw new Error("C7 live or audit actual model ID drifted from dual AI evidence.");
    }
    const liveActualModelId = [...actualModelIds][0];
    assertC7DialogueAuditModelBinding(
      audit.validations,
      index.provider.configuredModelId,
      liveActualModelId,
    );
    const auditPath = resolve(
      stagedOutputDirectory,
      "dialogue-sample-ai-validation.json",
    );
    writeJsonExclusive(auditPath, audit);
    const auditDiagnosisLeaks = Math.max(
      ...audit.validations.map(({ diagnosisLeaks }) => diagnosisLeaks),
    );
    const report = buildC7DialogueArchitectureReport({
      runs,
      policy: releasePolicy,
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
        ...(liveActualModelId === undefined ? {} : { actualModelId: liveActualModelId }),
        promptVersion: provider.identity.promptVersion,
      },
      bindings: {
        aiEvidenceIndexSha256: sha256File(indexPath),
        caseManifestSha256: index.caseManifest.sha256,
        caseValidationSetSha256: index.caseValidationSetSha256,
        patientPromptSha256: sha256File(
          resolveContainedRegularFile(
            modelRoot,
            `prompts/patient/${contentManifest.patientPromptVersion}.md`,
            "C7 Patient prompt",
          ),
        ),
        shareContractSha256: sha256File(
          resolveContainedRegularFile(
            resolve(modelRoot, ".."),
            "share/versions/contract-v1-rc2.json",
            "C7 share contract",
          ),
        ),
        dialogueAuditSha256: sha256File(auditPath),
      },
      upstreamReviewPolicy: index.reviewPolicy ?? "non_blocking",
      upstreamReviewFindings: index.reviewFindings ?? [],
    };
    const reportPath = resolve(
      stagedOutputDirectory,
      "c7-dialogue-architecture-report.json",
    );
    writeJsonExclusive(reportPath, reportArtifact);
    writeJsonExclusive(resolve(stagedOutputDirectory, "provider-model-approval.json"), {
      schemaVersion: "c7-provider-model-approval-v1",
      decision: report.findings.length === 0
        ? "approved"
        : "revision_recommended",
      decisionRef: "c7.dialogue-architecture.2026-08-28",
      decidedAt: new Date().toISOString(),
      provider: reportArtifact.provider,
      report: {
        path: relative(
          modelRoot,
          resolve(outputDirectory, "c7-dialogue-architecture-report.json"),
        ).replaceAll("\\", "/"),
        sha256: sha256File(reportPath),
      },
      audit: {
        path: relative(
          modelRoot,
          resolve(outputDirectory, "dialogue-sample-ai-validation.json"),
        ).replaceAll("\\", "/"),
        sha256: sha256File(auditPath),
      },
    });
    retainFailedEvidence = true;
    const reportSha256 = sha256File(reportPath);
    const stagedVerification = verifyC7DialogueEvidenceDirectory({
      modelRoot,
      dialogueEvidenceDirectory: relative(
        modelRoot,
        stagedOutputDirectory,
      ).replaceAll("\\", "/"),
      logicalDialogueEvidenceDirectory: args.outputDirectory,
      aiEvidenceDirectory: args.aiEvidenceDirectory,
    });
    resolveInsideModel(modelRoot, args.outputDirectory);
    await renameC7DialogueEvidenceDirectory(
      stagedOutputDirectory,
      outputDirectory,
    );
    assertContainedDirectory(modelRoot, outputDirectory, "C7 dialogue final output");
    const verified = verifyC7DialogueEvidenceDirectory({
      modelRoot,
      dialogueEvidenceDirectory: args.outputDirectory,
      aiEvidenceDirectory: args.aiEvidenceDirectory,
    });
    if (sha256Canonical(stagedVerification) !== sha256Canonical(verified)) {
      throw new Error("C7 dialogue verification changed during immutable publication.");
    }
    stagingDirectory = undefined;
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
      findings: report.findings.length + (index.reviewFindings?.length ?? 0),
      actualModelId: reportArtifact.provider.actualModelId ?? null,
      reportSha256,
      verificationStatus: verified.status,
    }, null, 2)}\n`);
  } catch (error) {
    if (
      !retainFailedEvidence && stagingDirectory !== undefined &&
      existsSync(stagingDirectory)
    ) {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
    const message = error instanceof Error ? error.message : "未知 C7 live benchmark 错误。";
    process.stderr.write(`C7 live benchmark 失败：${message}\n${USAGE}\n`);
    if (
      retainFailedEvidence && stagingDirectory !== undefined &&
      existsSync(stagingDirectory)
    ) {
      process.stderr.write(`完整但未发布的失败证据已保留：${stagingDirectory}\n`);
    }
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
