"use client";

import type { Game } from "phaser";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  gameCommands,
  worldEvents,
  type InteractionDetails,
} from "@/src/game/bridge/gameBridge";
import {
  combineMovementInputs,
  type MovementVector,
} from "@/src/game/domain/player/movement";
import styles from "./GameCanvas.module.css";

type LoadState = "loading" | "ready" | "error";

export function GameCanvas() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef(new Map<number, MovementVector>());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nearbyInteraction, setNearbyInteraction] = useState<InteractionDetails | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<InteractionDetails | null>(null);

  useEffect(() => {
    const canvasHost = canvasHostRef.current;

    if (!canvasHost) {
      return;
    }

    const activePointers = activePointersRef.current;
    let disposed = false;
    let game: Game | null = null;

    const unsubscribe = [
      worldEvents.on("world.ready", () => setLoadState("ready")),
      worldEvents.on("interaction.available", setNearbyInteraction),
      worldEvents.on("interaction.opened", setActiveInteraction),
      worldEvents.on("interaction.closed", () => setActiveInteraction(null)),
      worldEvents.on("world.error", ({ message }) => {
        setErrorMessage(message);
        setLoadState("error");
      }),
    ];

    void import("@/src/game/bootstrap")
      .then(({ createGame }) => {
        if (disposed) {
          return;
        }

        game = createGame(canvasHost);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        const message = error instanceof Error ? error.message : "游戏运行时加载失败";
        setErrorMessage(message);
        setLoadState("error");
      });

    return () => {
      disposed = true;
      activePointers.clear();
      gameCommands.emit("movement.set", { x: 0, y: 0 });
      unsubscribe.forEach((stopListening) => stopListening());
      game?.destroy(true);
      canvasHost.replaceChildren();
    };
  }, []);

  const emitActiveMovement = () => {
    gameCommands.emit(
      "movement.set",
      combineMovementInputs(activePointersRef.current.values()),
    );
  };

  const startMovement = (
    event: ReactPointerEvent<HTMLButtonElement>,
    movement: MovementVector,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, movement);
    emitActiveMovement();
  };

  const stopMovement = (event: ReactPointerEvent<HTMLButtonElement>) => {
    activePointersRef.current.delete(event.pointerId);
    emitActiveMovement();
  };

  return (
    <section className={styles.gameFrame} aria-label="诊所游戏演示">
      <div className={styles.stage}>
        <div
          ref={canvasHostRef}
          className={styles.canvasHost}
          data-testid="game-canvas"
          aria-label="可移动的二维诊所场景"
        />

        {loadState === "loading" && (
          <div className={styles.statusCard} role="status">
            正在启动诊所…
          </div>
        )}

        {loadState === "error" && (
          <div className={styles.errorCard} role="alert">
            <strong>无法启动游戏运行时</strong>
            <span>{errorMessage}</span>
          </div>
        )}

        {nearbyInteraction && !activeInteraction && (
          <button
            className={styles.interactionPrompt}
            type="button"
            onClick={() => gameCommands.emit("interaction.confirm", undefined)}
          >
            交互：{nearbyInteraction.label}
          </button>
        )}

        {activeInteraction && (
          <div className={styles.dialogue} role="dialog" aria-modal="true" aria-labelledby="patient-title">
            <p className={styles.dialogueLabel}>患者 NPC · mock interaction</p>
            <h2 id="patient-title">{activeInteraction.label}</h2>
            <p>
              您好，医生。我最近总觉得不太舒服。正式问诊会在 `share` contract v1 与 mock adapter
              就绪后接入。
            </p>
            <button type="button" onClick={() => gameCommands.emit("interaction.close", undefined)}>
              返回诊所
            </button>
          </div>
        )}
      </div>

      <div className={styles.controls} aria-label="移动控制">
        <button
          type="button"
          aria-label="向上移动"
          onPointerDown={(event) => startMovement(event, { x: 0, y: -1 })}
          onPointerUp={stopMovement}
          onPointerCancel={stopMovement}
          onLostPointerCapture={stopMovement}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="向左移动"
          onPointerDown={(event) => startMovement(event, { x: -1, y: 0 })}
          onPointerUp={stopMovement}
          onPointerCancel={stopMovement}
          onLostPointerCapture={stopMovement}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="向下移动"
          onPointerDown={(event) => startMovement(event, { x: 0, y: 1 })}
          onPointerUp={stopMovement}
          onPointerCancel={stopMovement}
          onLostPointerCapture={stopMovement}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label="向右移动"
          onPointerDown={(event) => startMovement(event, { x: 1, y: 0 })}
          onPointerUp={stopMovement}
          onPointerCancel={stopMovement}
          onLostPointerCapture={stopMovement}
        >
          →
        </button>
      </div>

      <p className={styles.srStatus} aria-live="polite">
        {loadState === "ready" ? "诊所已加载" : errorMessage ?? "诊所正在加载"}
      </p>
    </section>
  );
}
