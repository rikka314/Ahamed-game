import { randomUUID } from "node:crypto";

import type {
  CasePackage,
  MedicalTestDefinition,
} from "../domain/case-package.js";
import { ModelServiceError } from "../domain/errors.js";
import type { EventSink } from "../observability/event-sink.js";
import type {
  MedicalEvaluation,
  ModelProvider,
} from "../providers/model-provider.js";
import type { CaseRepository } from "../repositories/case-repository.js";

type SessionPhase = "active" | "completed" | "failed";

export interface PublicTestResult {
  testId: string;
  status: "unavailable" | "completed";
  report?: string;
  assetId?: string;
  reasonCode?: string;
}

export interface PublicSessionView {
  contractVersion: "1";
  sessionId: string;
  caseId: string;
  caseVersion: string;
  patientNpcId: string;
  chiefComplaint: string;
  patientDisplay: {
    displayName: string;
    ageBand?: string;
    genderDisplay?: string;
  };
  allowedActions: Array<
    "ask_patient" | "order_test" | "submit_diagnosis"
  >;
  sessionPhase: SessionPhase;
}

export interface PublicSessionProjection {
  sessionId: string;
  caseVersion: string;
  initialPresentation: string;
  disclosedFacts: Array<{
    factId: string;
    displayText: string;
    disclosedAtTurn: number;
  }>;
  completedTests: PublicTestResult[];
  turnCount: number;
  turnLimit: number;
  sessionPhase: SessionPhase;
}

export interface TurnCompleted {
  sessionId: string;
  turnId: string;
  reply: string;
  disclosedFactIds: string[];
  turnNumber: number;
  sessionPhase: "active";
}

export type EvaluationCompleted = MedicalEvaluation & {
  sessionId: string;
  caseVersion: string;
  sessionPhase: "completed";
  completedAt: string;
};

interface DisclosedFact {
  factId: string;
  displayText: string;
  disclosedAtTurn: number;
}

interface SessionRecord {
  sessionId: string;
  patientNpcId: string;
  casePackage: CasePackage;
  sessionPhase: SessionPhase;
  turnCount: number;
  turnIds: string[];
  disclosedFacts: Map<string, DisclosedFact>;
  completedTests: Map<string, PublicTestResult>;
  turnRequests: Map<string, TurnCompleted>;
  testRequests: Map<string, PublicTestResult>;
  diagnosisRequests: Map<string, EvaluationCompleted>;
  eventSequence: number;
}

export interface IdGenerator {
  next(prefix: string): string;
}

class UuidGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

function publicTestResult(
  testId: string,
  definition: MedicalTestDefinition,
): PublicTestResult {
  return {
    testId,
    status: definition.status,
    ...(definition.report === undefined ? {} : { report: definition.report }),
    ...(definition.assetId === undefined ? {} : { assetId: definition.assetId }),
    ...(definition.reasonCode === undefined
      ? {}
      : { reasonCode: definition.reasonCode }),
  };
}

function normalizeTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export class ModelService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly createRequests = new Map<
    string,
    { session: PublicSessionView; projection: PublicSessionProjection }
  >();

  constructor(
    private readonly cases: CaseRepository,
    private readonly provider: ModelProvider,
    private readonly eventSink: EventSink,
    private readonly ids: IdGenerator = new UuidGenerator(),
  ) {}

  async createSession(input: {
    clientRequestId: string;
    publicCaseId: string;
    patientNpcId: string;
  }): Promise<{
    session: PublicSessionView;
    projection: PublicSessionProjection;
  }> {
    const repeated = this.createRequests.get(input.clientRequestId);
    if (repeated) {
      return structuredClone(repeated);
    }

    const casePackage = this.cases.findByPublicId(input.publicCaseId);
    if (!casePackage) {
      throw new ModelServiceError("CASE_NOT_FOUND", "Case was not found.");
    }

    const sessionId = this.ids.next("session");
    const record: SessionRecord = {
      sessionId,
      patientNpcId: input.patientNpcId,
      casePackage,
      sessionPhase: "active",
      turnCount: 0,
      turnIds: [],
      disclosedFacts: new Map(),
      completedTests: new Map(),
      turnRequests: new Map(),
      testRequests: new Map(),
      diagnosisRequests: new Map(),
      eventSequence: 0,
    };
    this.sessions.set(sessionId, record);
    this.emit(record, "session.created", {
      caseId: casePackage.publicCaseId,
      caseVersion: casePackage.caseVersion,
    });

    const response = {
      session: this.sessionView(record),
      projection: this.projection(record),
    };
    this.createRequests.set(input.clientRequestId, structuredClone(response));
    return response;
  }

  getSession(sessionId: string): PublicSessionProjection {
    return this.projection(this.requireSession(sessionId));
  }

  async askPatient(input: {
    sessionId: string;
    clientTurnId: string;
    text: string;
  }): Promise<TurnCompleted> {
    const session = this.requireSession(input.sessionId);
    const repeated = session.turnRequests.get(input.clientTurnId);
    if (repeated) {
      return structuredClone(repeated);
    }
    this.assertActive(session);

    const askableFacts = Object.entries(session.casePackage.patientFacts).filter(
      ([, fact]) =>
        fact.disclosure === "if_asked" || fact.disclosure === "spontaneous",
    );
    const decision = await this.provider.classifyTurn({
      text: input.text,
      locale: session.casePackage.locale,
      factIndex: askableFacts.map(([factId, fact]) => ({
        factId,
        questionMatchers: [...fact.questionMatchers],
      })),
    });

    if (decision.action === "unsafe") {
      this.emit(session, "safety.interrupted", { code: decision.safetyCode });
      throw new ModelServiceError(
        decision.safetyCode,
        "The request crossed the model safety boundary.",
      );
    }

    const allowedFactIds = new Set(askableFacts.map(([factId]) => factId));
    if (
      decision.requestedFactIds.some((factId) => !allowedFactIds.has(factId))
    ) {
      this.rejectProviderOutput(session, "Controller requested a hidden fact.");
    }

    const allowedFacts = decision.requestedFactIds.map((factId) => {
      const fact = session.casePackage.patientFacts[factId];
      if (!fact) {
        this.rejectProviderOutput(session, "Controller requested an unknown fact.");
      }
      return { factId, status: fact.status, value: fact.value };
    });
    const patientReply = await this.provider.generatePatientReply({
      locale: session.casePackage.locale,
      languageStyle: session.casePackage.patientPersona.languageStyle,
      allowedFacts,
    });
    const allowedForReply = new Set(allowedFacts.map(({ factId }) => factId));
    const hiddenDiagnosisTerms = [
      session.casePackage.answerKey.targetDiagnosis,
      ...session.casePackage.answerKey.acceptedSynonyms,
    ]
      .map(normalizeTerm)
      .filter((term) => term.length > 0);
    const normalizedReply = normalizeTerm(patientReply.reply);

    if (
      patientReply.diagnosisLeak ||
      patientReply.newFactsClaimed.length > 0 ||
      patientReply.factsUsed.some((factId) => !allowedForReply.has(factId)) ||
      hiddenDiagnosisTerms.some((term) => normalizedReply.includes(term))
    ) {
      this.rejectProviderOutput(session, "Patient reply failed the fact gate.");
    }

    session.turnCount += 1;
    const turnId = this.ids.next("turn");
    session.turnIds.push(turnId);
    for (const factId of patientReply.factsUsed) {
      const fact = session.casePackage.patientFacts[factId];
      if (fact && !session.disclosedFacts.has(factId)) {
        session.disclosedFacts.set(factId, {
          factId,
          displayText: fact.value,
          disclosedAtTurn: session.turnCount,
        });
      }
    }

    const response: TurnCompleted = {
      sessionId: session.sessionId,
      turnId,
      reply: patientReply.reply,
      disclosedFactIds: [...patientReply.factsUsed],
      turnNumber: session.turnCount,
      sessionPhase: "active",
    };
    session.turnRequests.set(input.clientTurnId, structuredClone(response));
    this.emit(session, "patient.reply.completed", {
      clientTurnId: input.clientTurnId,
      turnId,
      disclosedFactIds: [...patientReply.factsUsed],
    });
    return response;
  }

  async orderTest(input: {
    sessionId: string;
    clientRequestId: string;
    testId: string;
  }): Promise<PublicTestResult> {
    const session = this.requireSession(input.sessionId);
    const repeated = session.testRequests.get(input.clientRequestId);
    if (repeated) {
      return structuredClone(repeated);
    }
    this.assertActive(session);

    const definition = session.casePackage.medicalTests[input.testId];
    if (!definition) {
      throw new ModelServiceError(
        "TEST_NOT_AVAILABLE",
        "The requested test is not available for this case.",
      );
    }

    const result = publicTestResult(input.testId, definition);
    session.testRequests.set(input.clientRequestId, structuredClone(result));
    if (result.status === "completed") {
      session.completedTests.set(input.testId, structuredClone(result));
    }
    this.emit(session, "test.completed", {
      testId: input.testId,
      status: result.status,
    });
    return result;
  }

  async submitDiagnosis(input: {
    sessionId: string;
    clientRequestId: string;
    primaryDiagnosis: string;
    differentials: string[];
  }): Promise<EvaluationCompleted> {
    const session = this.requireSession(input.sessionId);
    const repeated = session.diagnosisRequests.get(input.clientRequestId);
    if (repeated) {
      return structuredClone(repeated);
    }
    if (session.sessionPhase !== "active") {
      throw new ModelServiceError(
        "INVALID_SESSION_STATE",
        "Diagnosis cannot be submitted in the current session state.",
      );
    }

    const evaluation = await this.provider.evaluate({
      casePackage: structuredClone(session.casePackage),
      primaryDiagnosis: input.primaryDiagnosis,
      differentials: [...input.differentials],
      disclosedFactIds: [...session.disclosedFacts.keys()],
      completedTestIds: [...session.completedTests.keys()],
      turnIds: [...session.turnIds],
    });
    session.sessionPhase = "completed";
    const result: EvaluationCompleted = {
      ...evaluation,
      sessionId: session.sessionId,
      caseVersion: session.casePackage.caseVersion,
      sessionPhase: "completed",
      completedAt: new Date().toISOString(),
    };
    session.diagnosisRequests.set(input.clientRequestId, structuredClone(result));
    this.emit(session, "evaluation.completed", {
      diagnosisCorrect: result.diagnosis.correct,
      scoreTotal: result.scores.total,
      evaluationVersion: result.evaluationVersion,
    });
    return result;
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ModelServiceError(
        "SESSION_NOT_FOUND",
        "Session was not found.",
      );
    }
    return session;
  }

  private assertActive(session: SessionRecord): void {
    if (session.sessionPhase !== "active") {
      throw new ModelServiceError(
        "INVALID_SESSION_STATE",
        "The session does not accept this action.",
      );
    }
  }

  private rejectProviderOutput(session: SessionRecord, message: string): never {
    session.sessionPhase = "failed";
    this.emit(session, "model.output_rejected", {});
    throw new ModelServiceError("MODEL_OUTPUT_REJECTED", message);
  }

  private sessionView(session: SessionRecord): PublicSessionView {
    const visible = session.casePackage.playerVisible;
    return {
      contractVersion: "1",
      sessionId: session.sessionId,
      caseId: session.casePackage.publicCaseId,
      caseVersion: session.casePackage.caseVersion,
      patientNpcId: session.patientNpcId,
      chiefComplaint: visible.chiefComplaint,
      patientDisplay: {
        displayName: visible.patientDisplayName,
        ...(visible.ageBand === undefined ? {} : { ageBand: visible.ageBand }),
        ...(visible.genderDisplay === undefined
          ? {}
          : { genderDisplay: visible.genderDisplay }),
      },
      allowedActions: ["ask_patient", "order_test", "submit_diagnosis"],
      sessionPhase: session.sessionPhase,
    };
  }

  private projection(session: SessionRecord): PublicSessionProjection {
    return {
      sessionId: session.sessionId,
      caseVersion: session.casePackage.caseVersion,
      initialPresentation: session.casePackage.playerVisible.chiefComplaint,
      disclosedFacts: [...session.disclosedFacts.values()].map((fact) => ({
        ...fact,
      })),
      completedTests: [...session.completedTests.values()].map((test) => ({
        ...test,
      })),
      turnCount: session.turnCount,
      turnLimit: session.casePackage.rubric.recommendedTurnLimit,
      sessionPhase: session.sessionPhase,
    };
  }

  private emit(
    session: SessionRecord,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    session.eventSequence += 1;
    this.eventSink.append({
      eventId: this.ids.next("event"),
      eventType,
      sessionId: session.sessionId,
      sequence: session.eventSequence,
      emittedAt: new Date().toISOString(),
      payload,
    });
  }
}
