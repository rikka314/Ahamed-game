"use client";

import type { Game } from "phaser";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  gameCommands,
  worldEvents,
  type ClinicFlowSnapshot,
  type InteractionDetails,
  type PatientVisualState,
  type ScreenAnchor,
  type SpeechBubbleMessage,
} from "@/src/game/bridge/gameBridge";
import { GRAYBOX_SHIFT_ID } from "@/src/game/domain/clinic-flow/grayboxClinicContent";
import {
  combineMovementInputs,
  type MovementVector,
} from "@/src/game/domain/player/movement";
import styles from "./GameCanvas.module.css";

type LoadState = "loading" | "ready" | "error";
type IntroState = "black" | "fading" | "complete";

type RuntimeDetails = {
  mapId: string;
  contentBuildId: string;
  h3Candidate: "16" | "32" | null;
  compositionCoverage: string[];
  renderContract: {
    abovePlayerDepth: number;
    playerDepth: number;
    collisionCount: number;
  };
  renderer: "webgl" | "fallback";
};

const PHASE_LABELS: Record<ClinicFlowSnapshot["phase"], string> = {
  doctor_seated_intro: "开场准备",
  clinic_ready: "诊所待开诊",
  computer_opened: "电脑已打开",
  business_opened: "正在开诊",
  queue_forming: "患者正在排队",
  ready_to_call: "可以叫号",
  patient_entering: "患者正在进门",
  patient_seated: "患者已落座",
  patient_leaving: "患者正在离场",
  shift_completed: "本日队列完成",
};

export function GameCanvas() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef(new Map<number, MovementVector>());
  const anchorsRef = useRef(new Map<string, ScreenAnchor>());
  const activeSpeakerRef = useRef<string | null>(null);
  const commandSequenceRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [introState, setIntroState] = useState<IntroState>("black");
  const [runtimeDetails, setRuntimeDetails] = useState<RuntimeDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [nearbyInteraction, setNearbyInteraction] = useState<InteractionDetails | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<InteractionDetails | null>(null);
  const [clinicFlow, setClinicFlow] = useState<ClinicFlowSnapshot | null>(null);
  const [speech, setSpeech] = useState<SpeechBubbleMessage | null>(null);
  const [speechAnchor, setSpeechAnchor] = useState<ScreenAnchor | null>(null);
  const [playerPosition, setPlayerPosition] = useState({ x: 0, y: 0 });
  const [patientVisuals, setPatientVisuals] = useState<Record<string, PatientVisualState>>({});
  const [orientationBlocked, setOrientationBlocked] = useState(false);

  useEffect(() => {
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) {
      return;
    }

    const activePointers = activePointersRef.current;
    const anchors = anchorsRef.current;
    let disposed = false;
    let game: Game | null = null;
    let introTimer: number | undefined;
    let speechTimer: number | undefined;

    const unsubscribe = [
      worldEvents.on("world.ready", (details) => {
        setRuntimeDetails(details);
        setLoadState("ready");
        setIntroState("fading");
        introTimer = window.setTimeout(() => {
          gameCommands.emit("clinic.intro-complete", { commandId: "intro.graybox.day-01" });
          setIntroState("complete");
        }, 1_200);
      }),
      worldEvents.on("clinic.flow.updated", setClinicFlow),
      worldEvents.on("interaction.available", setNearbyInteraction),
      worldEvents.on("interaction.opened", setActiveInteraction),
      worldEvents.on("interaction.closed", () => setActiveInteraction(null)),
      worldEvents.on("world.warning", ({ message }) => setWarningMessage(message)),
      worldEvents.on("player.position", setPlayerPosition),
      worldEvents.on("patient.visual.updated", (visual) => {
        setPatientVisuals((current) => {
          const previous = current[visual.npcId];
          if (
            previous?.patientRoleId === visual.patientRoleId &&
            previous.pose === visual.pose &&
            previous.visible === visual.visible
          ) {
            return current;
          }
          return { ...current, [visual.npcId]: visual };
        });
      }),
      worldEvents.on("world.anchor.updated", (anchor) => {
        anchors.set(anchor.anchorId, anchor);
        if (activeSpeakerRef.current === anchor.anchorId) {
          setSpeechAnchor(anchor);
        }
      }),
      worldEvents.on("speech.show", (message) => {
        if (speechTimer) {
          window.clearTimeout(speechTimer);
        }
        activeSpeakerRef.current = message.speakerId;
        setSpeech(message);
        setSpeechAnchor(anchors.get(message.speakerId) ?? null);
        speechTimer = window.setTimeout(() => {
          activeSpeakerRef.current = null;
          setSpeech(null);
          setSpeechAnchor(null);
        }, 4_200);
      }),
      worldEvents.on("world.error", ({ message }) => {
        setErrorMessage(message);
        setLoadState("error");
      }),
    ];

    void import("@/src/game/bootstrap")
      .then(({ createGame }) => {
        if (!disposed) {
          game = createGame(canvasHost);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          const message = error instanceof Error ? error.message : "游戏运行时加载失败";
          setErrorMessage(message);
          setLoadState("error");
        }
      });

    return () => {
      disposed = true;
      if (introTimer) {
        window.clearTimeout(introTimer);
      }
      if (speechTimer) {
        window.clearTimeout(speechTimer);
      }
      activePointers.clear();
      anchors.clear();
      activeSpeakerRef.current = null;
      gameCommands.emit("movement.set", { x: 0, y: 0 });
      unsubscribe.forEach((stopListening) => stopListening());
      game?.destroy(true);
      canvasHost.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const updateOrientationGate = () => {
      const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
      setOrientationBlocked(coarsePointer && window.innerHeight > window.innerWidth);
    };

    updateOrientationGate();
    window.addEventListener("resize", updateOrientationGate);
    window.addEventListener("orientationchange", updateOrientationGate);
    return () => {
      window.removeEventListener("resize", updateOrientationGate);
      window.removeEventListener("orientationchange", updateOrientationGate);
    };
  }, []);

  useEffect(() => {
    if (loadState === "ready") {
      const suspended = orientationBlocked || activeInteraction !== null;
      if (suspended) {
        activePointersRef.current.clear();
        gameCommands.emit("movement.set", { x: 0, y: 0 });
      }
      gameCommands.emit("world.set-suspended", { suspended });
    }
  }, [activeInteraction, loadState, orientationBlocked]);

  const emitActiveMovement = () => {
    if (!orientationBlocked) {
      gameCommands.emit(
        "movement.set",
        combineMovementInputs(activePointersRef.current.values()),
      );
    }
  };

  const startMovement = (
    event: ReactPointerEvent<HTMLButtonElement>,
    movement: MovementVector,
  ) => {
    if (orientationBlocked) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, movement);
    emitActiveMovement();
  };

  const stopMovement = (event: ReactPointerEvent<HTMLButtonElement>) => {
    activePointersRef.current.delete(event.pointerId);
    emitActiveMovement();
  };

  const activateInteraction = (interactionId: string) => {
    if (!orientationBlocked) {
      gameCommands.emit("interaction.activate", { interactionId });
    }
  };

  const phase = clinicFlow?.phase;
  const visiblePatientCount = Object.values(patientVisuals).filter(({ visible }) => visible).length;
  const currentPatientPose = clinicFlow?.currentPatientNpcId
    ? patientVisuals[clinicFlow.currentPatientNpcId]?.pose ?? "unknown"
    : "none";

  return (
    <section className={styles.gameFrame} aria-label="AhaMed 诊所灰盒">
      <div className={styles.runtimeBar} aria-label="灰盒运行状态">
        <div>
          <span className={styles.statusDot} aria-hidden="true" />
          <strong>{clinicFlow ? PHASE_LABELS[clinicFlow.phase] : "诊所启动中"}</strong>
        </div>
        <div className={styles.runtimeMeta}>
          <span>候诊 {clinicFlow?.waitingCount ?? 0}</span>
          <span>已完成 {clinicFlow?.completedCount ?? 0}</span>
          <span>{runtimeDetails?.renderer === "webgl" ? "WebGL" : "兼容模式"}</span>
        </div>
      </div>

      <div className={styles.stage}>
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="game-canvas"
          aria-label="可移动的二维诊所场景"
        />

        {loadState === "loading" && (
          <div className={styles.statusCard} role="status">
            <span className={styles.loadingGlyph} aria-hidden="true">✚</span>
            正在准备今天的诊所…
          </div>
        )}

        {loadState === "error" && (
          <div className={styles.errorCard} role="alert">
            <strong>无法启动游戏运行时</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {warningMessage && loadState !== "error" && (
          <div className={styles.warningCard} role="status">
            {warningMessage}
          </div>
        )}

        {introState !== "complete" && loadState !== "error" && (
          <div
            className={`${styles.fadeOverlay} ${introState === "fading" ? styles.fadeOut : ""}`}
            aria-hidden="true"
          />
        )}

        {speech && speechAnchor?.visible && (
          <div
            className={`${styles.speechBubble} ${speech.speakerRole === "doctor" ? styles.doctorBubble : styles.patientBubble}`}
            style={{
              left: `${speechAnchor.xRatio * 100}%`,
              top: `${speechAnchor.yRatio * 100}%`,
            }}
            role="status"
            aria-live="polite"
          >
            <span>{speech.speakerRole === "doctor" ? "医生" : "患者"}</span>
            {speech.text}
          </div>
        )}

        {nearbyInteraction && !activeInteraction && (
          <button
            className={styles.interactionPrompt}
            type="button"
            disabled={orientationBlocked}
            onClick={() => gameCommands.emit("interaction.confirm", undefined)}
          >
            E · {nearbyInteraction.label}
          </button>
        )}

        {activeInteraction?.kind === "computer" && (
          <div
            className={styles.computerPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="computer-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <p>AHAMED / CLINIC OS · 灰盒</p>
                <h2 id="computer-title">诊所电脑</h2>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => gameCommands.emit("interaction.close", undefined)}
                aria-label="关闭诊所电脑"
              >
                ×
              </button>
            </div>
            <div className={styles.computerMenu}>
              <button
                type="button"
                className={styles.primaryComputerAction}
                disabled={phase !== "computer_opened" || orientationBlocked}
                onClick={() => {
                  commandSequenceRef.current += 1;
                  gameCommands.emit("clinic.start-shift", {
                    commandId: `start.${GRAYBOX_SHIFT_ID}.${commandSequenceRef.current}`,
                    shiftId: GRAYBOX_SHIFT_ID,
                  });
                }}
              >
                <span>01</span>
                <strong>开始接诊</strong>
                <small>{phase === "computer_opened" ? "生成今日两人灰盒队列" : "本日已开诊"}</small>
              </button>
              <button type="button" disabled>
                <span>02</span>
                <strong>商店</strong>
                <small>S7 开放购买纵切</small>
              </button>
              <button type="button" disabled>
                <span>03</span>
                <strong>升级</strong>
                <small>S7 开放声望纵切</small>
              </button>
            </div>
          </div>
        )}

        {orientationBlocked && (
          <div className={styles.orientationGate} role="dialog" aria-modal="true" aria-labelledby="rotate-title">
            <div className={styles.phoneGlyph} aria-hidden="true" />
            <p>诊所暂停</p>
            <h2 id="rotate-title">请将设备旋转为横屏</h2>
            <span>恢复横屏后会停留在当前队列与患者状态，不会重复提交操作。</span>
          </div>
        )}

        <div className={styles.actionRail} aria-label="诊所操作">
        {phase === "clinic_ready" && (
          <button
            type="button"
            onClick={() => activateInteraction("interaction.computer.01")}
            disabled={orientationBlocked}
          >
            <span>电脑</span>
            打开诊所系统
          </button>
        )}
        {phase === "ready_to_call" && (
          <>
            <button
              type="button"
              onClick={() => activateInteraction("interaction.call-next.01")}
              disabled={orientationBlocked}
            >
              <span>叫号</span>
              叫下一位患者
            </button>
            <button
              type="button"
              onClick={() => activateInteraction("interaction.computer.01")}
              disabled={orientationBlocked}
            >
              <span>电脑</span>
              查看商店 / 升级
            </button>
          </>
        )}
        {phase === "patient_entering" && <p>患者正从左侧门进入，请稍候落座。</p>}
        {phase === "patient_seated" && (
          <button
            type="button"
            className={styles.grayboxAction}
            onClick={() => {
              const sessionId = clinicFlow?.currentSessionId;
              if (!sessionId) {
                return;
              }
              gameCommands.emit("clinic.dismiss-current", {
                commandId: `dismiss.${sessionId}`,
                sessionId,
              });
            }}
            disabled={orientationBlocked || !clinicFlow?.currentSessionId}
          >
            <span>灰盒验证</span>
            完成本例并测试患者离场
          </button>
        )}
        {phase === "patient_leaving" && <p>当前患者正在离场，座位释放后才能再次叫号。</p>}
        {phase === "shift_completed" && <p>今日两名灰盒患者已完成，循环接诊路径验证结束。</p>}
        </div>

        <div className={styles.controls} aria-label="移动控制">
        {[
          ["向上移动", "↑", { x: 0, y: -1 }],
          ["向左移动", "←", { x: -1, y: 0 }],
          ["向下移动", "↓", { x: 0, y: 1 }],
          ["向右移动", "→", { x: 1, y: 0 }],
        ].map(([label, glyph, movement]) => (
          <button
            key={label as string}
            type="button"
            aria-label={label as string}
            disabled={orientationBlocked}
            onPointerDown={(event) => startMovement(event, movement as MovementVector)}
            onPointerUp={stopMovement}
            onPointerCancel={stopMovement}
            onLostPointerCapture={stopMovement}
          >
            {glyph as string}
          </button>
        ))}
        </div>
      </div>

      <div className={styles.legend}>
        <span><i className={styles.doctorKey} />医生</span>
        <span><i className={styles.patientOneKey} />患者 1</span>
        <span><i className={styles.patientTwoKey} />患者 2</span>
        <span>地图：{runtimeDetails?.mapId ?? "loading"}</span>
        <span data-testid="h3-candidate">H3 候选：{runtimeDetails?.h3Candidate ?? "default"}</span>
        <span data-testid="player-position">位置：{playerPosition.x}, {playerPosition.y}</span>
        <span data-testid="visible-patient-count">可见患者：{visiblePatientCount}/2</span>
        <span data-testid="current-patient-pose">当前患者姿态：{currentPatientPose}</span>
        <span>contentBuildId：{runtimeDetails?.contentBuildId ?? "loading"}</span>
        <span className={styles.srStatus} data-testid="composition-coverage">
          构图：{runtimeDetails?.compositionCoverage.join(",") ?? "loading"}
        </span>
        <span className={styles.srStatus} data-testid="render-contract">
          前景={runtimeDetails?.renderContract.abovePlayerDepth ?? 0};
          玩家={runtimeDetails?.renderContract.playerDepth ?? 0};
          碰撞={runtimeDetails?.renderContract.collisionCount ?? 0}
        </span>
      </div>

      <p className={styles.srStatus} aria-live="polite">
        {loadState === "ready" ? "诊所已加载" : errorMessage ?? "诊所正在加载"}
      </p>
    </section>
  );
}
