"use client";

import type {
  CreateSessionResponseV1,
  EvaluationResultV1,
  SharedErrorV1,
} from "@ahamed/doctor-game-share";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type { ClinicTurnResponse } from "@/src/server/clinic-turn";

import styles from "./StandardizedPatientWorkspace.module.css";

interface PublicCase {
  publicCaseId: string;
  caseVersion: string;
  patientRoleId: string;
  displayName: string;
  chiefComplaint: string;
  ageBand?: string;
  genderDisplay?: string;
}

interface ChatMessage {
  id: string;
  role: "doctor" | "patient" | "system" | "test";
  text: string;
  label?: string;
}

interface PendingTurnOperation {
  sessionId: string;
  clientTurnId: string;
  text: string;
  doctorMessage: ChatMessage;
}

interface PersistedConsultation {
  version: 2;
  sessionId: string;
  messages: ChatMessage[];
  pendingTurn?: PendingTurnOperation;
}

interface PendingCreateOperation {
  clientRequestId: string;
  publicCaseId: string;
}

const QUICK_PROMPTS = [
  "这次不舒服是什么时候开始的？",
  "除了主要不适，还有别的症状吗？",
  "最近用过什么药？有药物过敏吗？",
] as const;

const SCORE_ITEMS: ReadonlyArray<{
  key: keyof EvaluationResultV1["scores"];
  label: string;
}> = [
  { key: "diagnosis", label: "诊断判断" },
  { key: "historyCoverage", label: "病史覆盖" },
  { key: "differentialReasoning", label: "鉴别思路" },
  { key: "testSelection", label: "检查选择" },
  { key: "efficiency", label: "问诊效率" },
  { key: "communication", label: "沟通质量" },
];

const ACTIVE_CONSULTATION_KEY = "ahamed.clinic.active-consultation.v2";
const LEGACY_CONSULTATION_KEY = "ahamed.clinic.active-consultation.v1";
const PENDING_CREATE_KEY = "ahamed.clinic.pending-create.v1";

class ClinicRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClinicRequestError";
  }
}

function isSharedError(value: unknown): value is SharedErrorV1 {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)["code"] === "string" &&
    typeof (value as Record<string, unknown>)["message"] === "string" &&
    typeof (value as Record<string, unknown>)["retryable"] === "boolean";
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (isSharedError(payload)) {
      throw new ClinicRequestError(
        payload.code,
        payload.message,
        payload.retryable,
        response.status,
      );
    }
    throw new ClinicRequestError(
      "INTERNAL_ERROR",
      "问诊服务暂时没有返回可用结果。",
      true,
      response.status,
    );
  }
  return payload as T;
}

function requestId(kind: string): string {
  return `web.${kind}.${crypto.randomUUID()}`;
}

function initials(name: string): string {
  const normalized = name.trim();
  return normalized.length <= 2 ? normalized : normalized.slice(-2);
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ClinicRequestError)) {
    return "问诊服务暂时不可用，请稍后重试。";
  }
  if (error.code === "EVALUATION_UNAVAILABLE" && !error.retryable) {
    return "评分服务连续失败，本局未能结算。请开始新的病例。";
  }
  const messages: Record<string, string> = {
    MODEL_UNAVAILABLE: "患者模型暂时不可用，本轮没有生成替代回答。请稍后重试。",
    MODEL_TIMEOUT: "患者正在组织回答，但本轮等待超时。你的问题已保留，可以重试。",
    MODEL_OUTPUT_REJECTED: "本轮回答未通过病例安全校验，因此没有展示。请换一种问法。",
    EVALUATION_UNAVAILABLE: "诊断已经识别，评分服务暂时不可用。请重新发送原句继续结算。",
    TURN_LIMIT_REACHED: "本例已达到问诊回合上限，请在对话中明确说出你的最终诊断。",
    SAFETY_REAL_HEALTH_INPUT: "这里仅处理虚构病例，不能评估真实个人健康情况。",
    SAFETY_PROMPT_INJECTION: "这条输入超出了虚构病例问诊边界，请继续询问患者病史。",
  };
  return messages[error.code] ?? error.message;
}

function patientMeta(patient: PublicCase): string {
  return [patient.ageBand, patient.genderDisplay].filter(Boolean).join(" · ") || "标准化患者";
}

function pickRandomCase(
  availableCases: PublicCase[],
  excludedCaseId?: string,
): PublicCase | undefined {
  const candidates = availableCases.length > 1 && excludedCaseId
    ? availableCases.filter(({ publicCaseId }) => publicCaseId !== excludedCaseId)
    : availableCases;
  if (candidates.length === 0) return undefined;
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return candidates[randomValue % candidates.length];
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const message = value as Partial<ChatMessage>;
  return typeof message.id === "string" &&
    ["doctor", "patient", "system", "test"].includes(message.role ?? "") &&
    typeof message.text === "string" &&
    (message.label === undefined || typeof message.label === "string");
}

function isPendingTurn(value: unknown): value is PendingTurnOperation | undefined {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const pending = value as Partial<PendingTurnOperation>;
  return typeof pending.sessionId === "string" &&
    typeof pending.clientTurnId === "string" &&
    typeof pending.text === "string" &&
    isChatMessage(pending.doctorMessage) &&
    pending.doctorMessage.role === "doctor";
}

function shouldPreservePendingOperation(error: unknown): boolean {
  if (!(error instanceof ClinicRequestError)) return true;
  return error.retryable &&
    (error.code === "OPERATION_IN_PROGRESS" ||
      error.code === "EVALUATION_UNAVAILABLE" ||
      error.code === "INTERNAL_ERROR" ||
      error.status === 429);
}

function isTerminalSessionError(error: unknown): boolean {
  return error instanceof ClinicRequestError &&
    ["SESSION_EXPIRED", "SESSION_NOT_FOUND", "SESSION_CANCELLED"].includes(
      error.code,
    );
}

function readPersistedConsultation(): PersistedConsultation | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_CONSULTATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedConsultation>;
    if (
      value.version !== 2 ||
      typeof value.sessionId !== "string" ||
      !Array.isArray(value.messages) ||
      !value.messages.every(isChatMessage) ||
      !isPendingTurn(value.pendingTurn)
    ) {
      return null;
    }
    return value as PersistedConsultation;
  } catch {
    return null;
  }
}

function removePersistedConsultation(): void {
  try {
    sessionStorage.removeItem(ACTIVE_CONSULTATION_KEY);
    sessionStorage.removeItem(LEGACY_CONSULTATION_KEY);
  } catch {
    // The dialogue remains usable in memory when browser storage is unavailable.
  }
}

function writePersistedConsultation(value: PersistedConsultation): void {
  try {
    sessionStorage.setItem(ACTIVE_CONSULTATION_KEY, JSON.stringify(value));
    sessionStorage.removeItem(LEGACY_CONSULTATION_KEY);
  } catch {
    // The dialogue remains usable in memory when browser storage is unavailable.
  }
}

function readPendingCreate(): PendingCreateOperation | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CREATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingCreateOperation>;
    return typeof value.clientRequestId === "string" &&
        typeof value.publicCaseId === "string"
      ? value as PendingCreateOperation
      : null;
  } catch {
    return null;
  }
}

function writePendingCreate(value: PendingCreateOperation | null): void {
  try {
    if (value) {
      sessionStorage.setItem(PENDING_CREATE_KEY, JSON.stringify(value));
    } else {
      sessionStorage.removeItem(PENDING_CREATE_KEY);
    }
  } catch {
    // The create request still remains idempotent in memory when storage is unavailable.
  }
}

export function StandardizedPatientWorkspace() {
  const [cases, setCases] = useState<PublicCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [session, setSession] = useState<CreateSessionResponseV1 | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResultV1 | null>(null);
  const [isLoadingCases, setIsLoadingCases] = useState(true);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [pendingTurnState, setPendingTurnState] =
    useState<PendingTurnOperation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const resultActionRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingTurnRef = useRef<PendingTurnOperation | null>(null);
  const pendingCreateRef = useRef<PendingCreateOperation | null>(null);
  const preservePersistedConsultationRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ cases: PublicCase[] }>("/api/clinic/cases")
      .then((result) => {
        if (cancelled) return;
        const pendingCreate = readPendingCreate();
        pendingCreateRef.current = pendingCreate;
        setCases(result.cases);
        setSelectedCaseId((current) =>
          current ||
          result.cases.find(
            ({ publicCaseId }) => publicCaseId === pendingCreate?.publicCaseId,
          )?.publicCaseId ||
          pickRandomCase(result.cases)?.publicCaseId ||
          ""
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(friendlyError(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCases(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const persisted = readPersistedConsultation();
    if (!persisted) {
      preservePersistedConsultationRef.current = false;
      removePersistedConsultation();
      queueMicrotask(() => {
        if (!cancelled) setIsRestoringSession(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void requestJson<CreateSessionResponseV1>(
      `/api/clinic/sessions/${persisted.sessionId}`,
    )
      .then(async (restored) => {
        if (cancelled) return;
        preservePersistedConsultationRef.current = false;
        pendingTurnRef.current = persisted.pendingTurn ?? null;
        setPendingTurnState(persisted.pendingTurn ?? null);
        setSession(restored);
        setSelectedCaseId(restored.session.caseId);
        setMessages(persisted.messages);
        if (persisted.pendingTurn) {
          setDraft(persisted.pendingTurn.text);
          setErrorMessage("上一条消息的结果尚未确认，请重新发送原句继续处理。");
        } else if (
          ["awaiting_model", "diagnosis_submitted", "evaluating"].includes(
            restored.session.sessionPhase,
          )
        ) {
          setErrorMessage("上一次请求仍在处理中，请稍后刷新页面确认结果。");
        }
        if (restored.session.sessionPhase === "completed") {
          pendingTurnRef.current = null;
          setPendingTurnState(null);
          const restoredEvaluation = await requestJson<EvaluationResultV1>(
            `/api/clinic/sessions/${persisted.sessionId}/diagnosis`,
          );
          if (!cancelled) setEvaluation(restoredEvaluation);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ClinicRequestError && !error.retryable) {
          preservePersistedConsultationRef.current = false;
          removePersistedConsultation();
        } else {
          preservePersistedConsultationRef.current = true;
        }
        setErrorMessage(
          error instanceof ClinicRequestError && !error.retryable
            ? "上一次问诊已经结束或过期，请开始新的病例。"
            : "暂时无法恢复上一次问诊。存档仍保留，请刷新重试或开始新病例。",
        );
      })
      .finally(() => {
        if (!cancelled) setIsRestoringSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isReplying]);

  useEffect(() => {
    if (evaluation) resultActionRef.current?.focus();
  }, [evaluation]);

  useEffect(() => {
    if (session && !evaluation && !isStarting) composerRef.current?.focus();
  }, [evaluation, isStarting, session]);

  useLayoutEffect(() => {
    if (isRestoringSession) return;
    if (!session) {
      if (!preservePersistedConsultationRef.current) {
        removePersistedConsultation();
      }
      return;
    }
    writePersistedConsultation({
      version: 2,
      sessionId: session.session.sessionId,
      messages,
      ...(pendingTurnState?.sessionId === session.session.sessionId
        ? { pendingTurn: pendingTurnState }
        : {}),
    });
  }, [isRestoringSession, messages, pendingTurnState, session]);

  const selectedCase = useMemo(
    () => cases.find(({ publicCaseId }) => publicCaseId === selectedCaseId) ?? cases[0],
    [cases, selectedCaseId],
  );
  const activePatient = session
    ? cases.find(({ publicCaseId }) => publicCaseId === session.session.caseId) ?? selectedCase
    : selectedCase;
  const hasPendingTurn = pendingTurnState?.sessionId === session?.session.sessionId;

  const clearLocalConsultation = () => {
    setSession(null);
    setMessages([]);
    setEvaluation(null);
    setDraft("");
    preservePersistedConsultationRef.current = false;
    pendingTurnRef.current = null;
    setPendingTurnState(null);
    pendingCreateRef.current = null;
    writePendingCreate(null);
    removePersistedConsultation();
  };

  const startSession = async (assignedCase: PublicCase | undefined = selectedCase) => {
    if (!assignedCase || isStarting) return;
    setIsStarting(true);
    setErrorMessage(null);
    setEvaluation(null);
    const pendingCreate = pendingCreateRef.current?.publicCaseId ===
        assignedCase.publicCaseId
      ? pendingCreateRef.current
      : {
          clientRequestId: requestId("create"),
          publicCaseId: assignedCase.publicCaseId,
        };
    pendingCreateRef.current = pendingCreate;
    writePendingCreate(pendingCreate);
    try {
      const created = await requestJson<CreateSessionResponseV1>(
        "/api/clinic/sessions",
        {
          method: "POST",
          body: JSON.stringify({
            clientRequestId: pendingCreate.clientRequestId,
            publicCaseId: assignedCase.publicCaseId,
          }),
        },
      );
      pendingCreateRef.current = null;
      writePendingCreate(null);
      preservePersistedConsultationRef.current = false;
      setSession(created);
      pendingTurnRef.current = null;
      setPendingTurnState(null);
      setMessages([
        {
          id: requestId("system"),
          role: "system",
          text: "患者已进入诊室，问诊开始",
        },
        {
          id: requestId("patient"),
          role: "patient",
          label: "主诉",
          text: created.projection.initialPresentation,
        },
      ]);
      setDraft("");
    } catch (error) {
      if (!shouldPreservePendingOperation(error)) {
        pendingCreateRef.current = null;
        writePendingCreate(null);
      }
      setErrorMessage(friendlyError(error));
    } finally {
      setIsStarting(false);
    }
  };

  const sendTurn = async (text: string) => {
    const normalized = text.trim();
    if (!session || !normalized || isReplying || evaluation) return;
    const sessionId = session.session.sessionId;
    const pending = pendingTurnRef.current;
    if (session.session.sessionPhase !== "active" && pending?.sessionId !== sessionId) {
      setErrorMessage("上一条请求仍在处理中，请稍后刷新页面确认结果。");
      return;
    }
    if (pending?.sessionId === sessionId && pending.text !== normalized) {
      setDraft(pending.text);
      setErrorMessage("请先重试上一条未确认的消息，系统会复用原请求标识避免重复处理。");
      return;
    }
    const operation = pending?.sessionId === sessionId && pending.text === normalized
      ? pending
      : {
          sessionId,
          clientTurnId: requestId("turn"),
          text: normalized,
          doctorMessage: {
            id: requestId("doctor"),
            role: "doctor" as const,
            label: "你的提问",
            text: normalized,
          },
        };
    pendingTurnRef.current = operation;
    setPendingTurnState(operation);
    setMessages((current) =>
      current.some(({ id }) => id === operation.doctorMessage.id)
        ? current
        : [...current, operation.doctorMessage]
    );
    setDraft("");
    setErrorMessage(null);
    setIsReplying(true);
    try {
      const response = await requestJson<ClinicTurnResponse>(
        `/api/clinic/sessions/${sessionId}/turns`,
        {
          method: "POST",
          body: JSON.stringify({
            clientTurnId: operation.clientTurnId,
            text: operation.text,
          }),
        },
      );
      const { turn } = response;
      if (!turn && !response.evaluation) {
        throw new ClinicRequestError(
          "INTERNAL_ERROR",
          "问诊服务暂时没有返回可用结果。",
          true,
          502,
        );
      }
      pendingTurnRef.current = null;
      setPendingTurnState(null);
      if (turn) {
        const effectMessages: ChatMessage[] = turn.effects.map((effect) =>
          effect.type === "test_completed"
            ? {
                id: requestId("test"),
                role: "test",
                label: `检查 · ${effect.result.testId}`,
                text: effect.result.report ?? "检查已完成。",
              }
            : {
                id: requestId("test"),
                role: "test",
                label: `检查 · ${effect.testId}`,
                text: "当前病例无法完成这项检查。",
              },
        );
        setMessages((current) => [
          ...current,
          {
            id: turn.turnId,
            role: "patient",
            label: "患者回答",
            text: turn.reply,
          },
          ...effectMessages,
        ]);
      }
      const settled = response.evaluation !== undefined;
      setSession((current) =>
        current
          ? {
              ...current,
              session: {
                ...current.session,
                sessionPhase: settled
                  ? "completed"
                  : turn?.sessionPhase ?? current.session.sessionPhase,
              },
              projection: {
                ...current.projection,
                turnCount: turn?.turnNumber ?? current.projection.turnCount,
                sessionPhase: settled
                  ? "completed"
                  : turn?.sessionPhase ?? current.projection.sessionPhase,
              },
            }
          : current,
      );
      if (response.evaluation) setEvaluation(response.evaluation);
    } catch (error) {
      if (isTerminalSessionError(error)) {
        clearLocalConsultation();
      } else {
        setMessages((current) =>
          current.filter(({ id }) => id !== operation.doctorMessage.id)
        );
        setDraft(operation.text);
        if (error instanceof ClinicRequestError &&
          error.code === "EVALUATION_UNAVAILABLE" && error.retryable) {
          pendingTurnRef.current = operation;
          setPendingTurnState(operation);
        } else if (
          error instanceof ClinicRequestError &&
          error.code === "EVALUATION_UNAVAILABLE"
        ) {
          clearLocalConsultation();
        } else if (!shouldPreservePendingOperation(error)) {
          pendingTurnRef.current = null;
          setPendingTurnState(null);
        }
      }
      setErrorMessage(friendlyError(error));
    } finally {
      setIsReplying(false);
    }
  };

  const onSubmitTurn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendTurn(draft);
  };

  const prepareAnotherCase = async () => {
    const nextCase = pickRandomCase(cases, activePatient?.publicCaseId);
    clearLocalConsultation();
    if (!nextCase) return;
    setSelectedCaseId(nextCase.publicCaseId);
    await startSession(nextCase);
  };

  return (
    <main className={styles.shell}>
      <h1 className={styles.srOnly}>AhaMed 标准病人随机问诊演练</h1>
      <section className={styles.consultation} aria-label="问诊对话">
        <div className={styles.transcript} ref={transcriptRef} role="log" aria-live="polite">
          {!session ? (
            <div className={styles.intakeCard}>
              <div className={styles.intakeArtwork} aria-hidden="true">
                <span className={styles.orbitOne} />
                <span className={styles.orbitTwo} />
                <span className={styles.pulseLine} />
                <strong>{selectedCase ? initials(selectedCase.displayName) : "A"}</strong>
              </div>
              <p className={styles.intakeKicker}>RANDOMIZED OUTPATIENT CONSULTATION</p>
              <h2>患者已经候诊，<br />请开始你的问诊。</h2>
              <p className={styles.intakeIntro}>
                系统已从审核通过的病例池随机安排一位虚构患者。像真实门诊一样，
                你只会看到患者主动陈述和问诊中逐步披露的信息。
              </p>
              {selectedCase ? (
                <div className={styles.selectedPreview}>
                  <span>分诊主诉</span>
                  <strong>“{selectedCase.chiefComplaint}”</strong>
                  <small>{selectedCase.displayName} · {patientMeta(selectedCase)}</small>
                </div>
              ) : null}
              <button
                type="button"
                className={styles.startButton}
                disabled={!selectedCase || isStarting || isLoadingCases || isRestoringSession}
                onClick={() => void startSession()}
                suppressHydrationWarning
              >
                <span>{isStarting ? "正在建立安全会话" : "开始问诊"}</span>
                <i aria-hidden="true">→</i>
              </button>
            </div>
          ) : (
            <div className={styles.messageStack}>
              {messages.map((message) =>
                message.role === "system" ? (
                  <div className={styles.systemMessage} key={message.id}>
                    <span>{message.text}</span>
                  </div>
                ) : message.role === "test" ? (
                  <article className={styles.testMessage} key={message.id}>
                    <span>{message.label}</span>
                    <p>{message.text}</p>
                  </article>
                ) : (
                  <article
                    key={message.id}
                    className={`${styles.message} ${message.role === "doctor" ? styles.doctorMessage : styles.patientMessage}`}
                  >
                    <div className={styles.messageLabel}>
                      <span>{message.label}</span>
                      <small>{message.role === "doctor" ? "医生" : activePatient?.displayName}</small>
                    </div>
                    <p>{message.text}</p>
                  </article>
                ),
              )}
              {isReplying ? (
                <article className={`${styles.message} ${styles.patientMessage} ${styles.thinkingMessage}`}>
                  <div className={styles.messageLabel}>
                    <span>患者正在回答</span>
                    <small>{activePatient?.displayName}</small>
                  </div>
                  <p><i /><i /><i /></p>
                </article>
              ) : null}
            </div>
          )}
        </div>

        {errorMessage ? (
          <div className={styles.errorBanner} role="alert">
            <span>!</span>
            <p>{errorMessage}</p>
            <button type="button" onClick={() => setErrorMessage(null)}>关闭</button>
          </div>
        ) : null}

        <div className={styles.composerArea}>
          {session && session.projection.turnCount === 0 && !evaluation ? (
            <div className={styles.quickPrompts} aria-label="推荐问法">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  disabled={isReplying || hasPendingTurn}
                  onClick={() => void sendTurn(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <form className={styles.composer} onSubmit={onSubmitTurn}>
            <div className={styles.composerLead} aria-hidden="true">问</div>
            <label>
              <span className={styles.srOnly}>向患者提问</span>
              <textarea
                suppressHydrationWarning
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={
                  !session || isReplying || Boolean(evaluation) ||
                  (session.session.sessionPhase !== "active" && !hasPendingTurn)
                }
                placeholder={session ? "询问病史，或直接说出你的最终诊断…" : "开始病例后即可问诊"}
                rows={2}
              />
              <small>{draft.length}/1000</small>
            </label>
            <button
              suppressHydrationWarning
              type="submit"
              disabled={!session || !draft.trim() || isReplying || Boolean(evaluation)}
              aria-label="发送消息"
            >
              <span>发送</span>
              <i aria-hidden="true">↑</i>
            </button>
          </form>
          <p className={styles.composerHint}>明确说出“最终诊断是……”后，系统会自动识别并结算</p>
          <p className={styles.disclaimer}>虚构病例 · 医学教育与沟通训练用途 · 不替代真实医疗诊断</p>
        </div>
      </section>

      {evaluation ? (
        <div className={styles.resultBackdrop}>
          <section
            className={styles.resultModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                event.preventDefault();
                resultActionRef.current?.focus();
              }
            }}
          >
            <div className={styles.resultTopline}>
              <span>CONSULTATION COMPLETE</span>
              <strong className={evaluation.diagnosis.correct ? styles.resultSuccess : styles.resultRetry}>
                {evaluation.diagnosis.correct ? "诊断命中" : "完成训练"}
              </strong>
            </div>
            <div className={styles.resultHero}>
              <div
                className={styles.scoreDial}
                style={{ "--score-progress": `${evaluation.scores.total}%` } as CSSProperties}
                aria-label={`综合评分 ${evaluation.scores.total} 分`}
              >
                <div>
                  <strong>{evaluation.scores.total}</strong>
                  <span>综合评分</span>
                </div>
              </div>
              <div className={styles.resultCopy}>
                <span>本次问诊已自动结算</span>
                <h2 id="result-title">
                  {evaluation.diagnosis.correct ? "判断准确，做得很好。" : "病例已完成，继续打磨判断。"}
                </h2>
                <p>{evaluation.summary}</p>
              </div>
            </div>
            <div className={styles.scoreGrid} aria-label="评分明细">
              {SCORE_ITEMS.map(({ key, label }) => (
                <div key={key}>
                  <span>{label}</span>
                  <strong>{evaluation.scores[key]}</strong>
                </div>
              ))}
            </div>
            <div className={styles.resultFooter}>
              <p>{evaluation.diagnosis.explanation}</p>
              <button
                ref={resultActionRef}
                type="button"
                disabled={isStarting}
                onClick={() => void prepareAnotherCase()}
              >
                <span>{isStarting ? "正在随机分诊" : "再来一局"}</span>
                <i aria-hidden="true">→</i>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
