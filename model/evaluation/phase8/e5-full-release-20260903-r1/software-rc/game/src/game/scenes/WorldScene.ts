import Phaser from "phaser";
import type { CaseSummaryV1 } from "@ahamed/doctor-game-share";
import {
  gameCommands,
  worldEvents,
  type ClinicFlowSnapshot,
  type InteractionDetails,
} from "@/src/game/bridge/gameBridge";
import {
  createClinicFlowState,
  transitionClinicFlow,
  type ClinicFlowCommand,
  type ClinicFlowState,
  type PatientQueueEntry,
} from "@/src/game/domain/clinic-flow/clinicFlow";
import {
  GRAYBOX_PATIENTS,
  GRAYBOX_PATIENT_SLOTS,
  GRAYBOX_SHIFT_ID,
} from "@/src/game/domain/clinic-flow/grayboxClinicContent";
import {
  assertPublicPatientIdentityAssets,
  resolvePublicPatientIdentity,
  type PublicPatientIdentity,
} from "@/src/game/domain/patients/publicPatientIdentityCatalog";
import { createPatientQueueEntriesFromCaseSummaries } from "@/src/game/domain/patients/patientSessionBinding";
import {
  normalizeMovementInput,
  type MovementVector,
} from "@/src/game/domain/player/movement";
import {
  CLINIC_ASSET_CONFIG_KEY,
  type ClinicAssetConfig,
} from "@/src/game/config/h3Candidate";
import {
  CLINIC_MAP_CACHE_KEY,
  CLINIC_MAP_LOAD_ERROR_KEY,
  CLINIC_TILESET_CACHE_KEY,
} from "@/src/game/scenes/PreloadScene";
import { createFallbackClinicMap } from "@/src/game/systems/maps/fallbackClinicMap";
import {
  parseTiledClinicMap,
  type ClinicMapObject,
  type ClinicVisualRect,
  type ParsedClinicMap,
} from "@/src/game/systems/maps/tiledClinicMap";

const PLAYER_SPEED = 72;
const INTERACTION_DISTANCE = 34;
const DOCTOR_NPC_ID = "npc.doctor.player-01";
const RENDER_DEPTHS = {
  player: 60,
  abovePlayer: 100,
} as const;
const COMPOSITION_OBJECTS = [
  "anchor.queue.01",
  "anchor.entrance",
  "anchor.patient-seat",
  "locked-zone.future-upper",
  "locked-zone.future-lower",
] as const;

const COMPUTER_INTERACTION: InteractionDetails = {
  interactionId: "interaction.computer.01",
  kind: "computer",
  label: "诊所电脑",
};

const CALL_INTERACTION: InteractionDetails = {
  interactionId: "interaction.call-next.01",
  kind: "call-button",
  label: "叫下一位",
};

type MovementKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

export class WorldScene extends Phaser.Scene {
  private clinicMap!: ParsedClinicMap;
  private player!: Phaser.Physics.Arcade.Image;
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private movementKeys!: MovementKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private virtualMovement: MovementVector = { x: 0, y: 0 };
  private availableInteraction: InteractionDetails | null = null;
  private activeInteraction: InteractionDetails | null = null;
  private externallySuspended = false;
  private clinicFlow: ClinicFlowState = createClinicFlowState();
  private readonly patientSprites = new Map<string, Phaser.Physics.Arcade.Image>();
  private readonly collisionObjects: Phaser.GameObjects.Rectangle[] = [];
  private stopListening: Array<() => void> = [];
  private lastAnchorUpdate = 0;
  private lastReportedPlayerPosition = { x: Number.NaN, y: Number.NaN };
  private mapWarning: string | null = null;
  private localCommandSequence = 0;
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;

  constructor() {
    super("world");
  }

  create(): void {
    try {
      this.clinicMap = this.readClinicMap();
      this.renderClinicMap();
      this.createActors();
      this.configureInput();
      this.configureBridge();
      this.configureCamera();

      this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
      this.emitClinicFlow();
      worldEvents.emit("world.ready", {
        locationId: "location.clinic.consultation-01",
        mapId: this.clinicMap.mapId,
        contentBuildId: this.clinicMap.contentBuildId,
        h3Candidate: this.clinicMap.h3Candidate,
        compositionCoverage: this.readCompositionCoverage(),
        renderContract: {
          abovePlayerDepth: RENDER_DEPTHS.abovePlayer,
          playerDepth: RENDER_DEPTHS.player,
          collisionCount: this.collisionObjects.length,
        },
        renderer: this.game.renderer.type === Phaser.WEBGL ? "webgl" : "fallback",
      });

      if (this.mapWarning) {
        worldEvents.emit("world.warning", { message: this.mapWarning });
      }
      if (this.game.renderer.type !== Phaser.WEBGL) {
        worldEvents.emit("world.warning", {
          message: "当前浏览器未启用 WebGL；已进入有限兼容模式，完整体验需要 WebGL。",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "诊所场景初始化失败";
      worldEvents.emit("world.error", { message });
      throw error;
    }
  }

  update(time: number): void {
    this.updateScreenAnchors(time);
    this.updateInteractionAvailability();

    if (this.isMovementLocked()) {
      this.player.setVelocity(0, 0);
      return;
    }

    const movement = normalizeMovementInput({
      x: this.readHorizontalKeyboardInput() + this.virtualMovement.x,
      y: this.readVerticalKeyboardInput() + this.virtualMovement.y,
    });
    const densityScale = this.clinicMap.tileWidth / 16;
    this.player.setVelocity(
      movement.x * PLAYER_SPEED * densityScale,
      movement.y * PLAYER_SPEED * densityScale,
    );

    if (
      this.availableInteraction &&
      (Phaser.Input.Keyboard.JustDown(this.interactKey) ||
        Phaser.Input.Keyboard.JustDown(this.enterKey))
    ) {
      this.activateInteraction(this.availableInteraction.interactionId);
    }
  }

  private readClinicMap(): ParsedClinicMap {
    const assetConfig = this.requireAssetConfig();
    const loaderError = this.registry.get(CLINIC_MAP_LOAD_ERROR_KEY) as string | undefined;
    const input = assetConfig.usesTilemap
      ? (this.cache.tilemap.get(CLINIC_MAP_CACHE_KEY)?.data as unknown)
      : (this.cache.json.get(CLINIC_MAP_CACHE_KEY) as unknown);

    if (!input || loaderError) {
      this.mapWarning = loaderError ?? "Tiled 地图缓存为空，已切换到开发回退场景。";
      return createFallbackClinicMap(assetConfig.tileSize, assetConfig.h3Candidate);
    }

    try {
      const parsed = parseTiledClinicMap(input);
      if (
        parsed.contentBuildId !== assetConfig.contentBuildId ||
        parsed.h3Candidate !== assetConfig.h3Candidate ||
        parsed.tileWidth !== assetConfig.tileSize ||
        parsed.tileHeight !== assetConfig.tileSize ||
        (parsed.visualMode === "tilemap") !== assetConfig.usesTilemap
      ) {
        throw new Error("Loaded clinic map does not match the requested candidate density");
      }
      return parsed;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "未知格式错误";
      this.mapWarning = `Tiled 地图不符合合同（${detail}），已切换到开发回退场景。`;
      return createFallbackClinicMap(assetConfig.tileSize, assetConfig.h3Candidate);
    }
  }

  private renderClinicMap(): void {
    if (this.clinicMap.visualMode === "tilemap") {
      this.renderTilemapLayers();
    } else {
      this.clinicMap.ground.forEach((rect) => this.renderVisualRect(rect));
      this.clinicMap.decoration.forEach((rect) => this.renderVisualRect(rect));
    }

    this.clinicMap.collision.forEach((rect) => {
      const collision = this.add
        .rectangle(rect.x, rect.y, rect.width, rect.height, 0x000000, 0)
        .setOrigin(0);
      this.physics.add.existing(collision, true);
      this.collisionObjects.push(collision);
    });

    if (this.clinicMap.visualMode === "rectangles") {
      this.clinicMap.abovePlayer.forEach((rect) => this.renderVisualRect(rect));
    }
    this.createPointerInteractionZone("interaction.computer.01", COMPUTER_INTERACTION);
    this.createPointerInteractionZone("interaction.call-next.01", CALL_INTERACTION);
  }

  private renderTilemapLayers(): void {
    if (!this.clinicMap.tilesetName) {
      throw new Error("H3 tilemap is missing its embedded tileset name");
    }
    this.tilemap = this.make.tilemap({ key: CLINIC_MAP_CACHE_KEY });
    const tileset = this.tilemap.addTilesetImage(
      this.clinicMap.tilesetName,
      CLINIC_TILESET_CACHE_KEY,
    );
    if (!tileset) {
      throw new Error(`H3 tileset could not be bound: ${this.clinicMap.tilesetName}`);
    }
    this.tilemap.createLayer("Ground", tileset).setDepth(0);
    this.tilemap.createLayer("Decoration", tileset).setDepth(20);
    this.tilemap.createLayer("AbovePlayer", tileset).setDepth(RENDER_DEPTHS.abovePlayer);
  }

  private renderVisualRect(rect: ClinicVisualRect): void {
    const gameObject = this.add
      .rectangle(rect.x, rect.y, rect.width, rect.height, colorNumber(rect.fillColor))
      .setOrigin(0)
      .setDepth(rect.depth);

    if (rect.strokeColor) {
      gameObject.setStrokeStyle(1, colorNumber(rect.strokeColor), 1);
    }
    if (rect.label && rect.stableId.includes("locked")) {
      this.add
        .text(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.label, {
          align: "center",
          backgroundColor: "rgba(29, 41, 35, 0.72)",
          color: "#e8efe5",
          fontFamily: '"Microsoft YaHei", sans-serif',
          fontSize: "7px",
          padding: { x: 5, y: 3 },
          wordWrap: { width: Math.max(40, rect.width - 16) },
        })
        .setOrigin(0.5)
        .setDepth(rect.depth + 1);
    }
  }

  private createPointerInteractionZone(
    stableId: string,
    details: InteractionDetails,
  ): void {
    const object = this.requireMapObject(stableId);
    this.add
      .zone(object.x, object.y, object.width, object.height)
      .setOrigin(0)
      .setDepth(120)
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.POINTER_DOWN, () => this.activateInteraction(details.interactionId));
  }

  private createActors(): void {
    const densityScale = this.clinicMap.tileWidth / 16;
    const doctorSpawn = this.requireMapObject("spawn.doctor.01");
    this.player = this.physics.add.image(
      doctorSpawn.x,
      doctorSpawn.y,
      "player-seated-placeholder",
    );
    this.player.setOrigin(0.5, 1);
    this.player.setScale(densityScale);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(RENDER_DEPTHS.player);
    this.player.setBodySize(8, 6).setOffset(2, 5);

    this.collisionObjects.forEach((collision) => {
      this.physics.add.collider(this.player, collision);
    });

    GRAYBOX_PATIENT_SLOTS.forEach((slot) => {
      const queueAnchor = this.requireMapObject(slot.queueAnchorId);
      const sprite = this.physics.add.image(
        queueAnchor.x,
        queueAnchor.y,
        "patient-placeholder-01",
      );
      sprite.setOrigin(0.5, 1);
      sprite.setScale(densityScale);
      sprite.setDepth(58);
      sprite.setImmovable(true);
      sprite.setBodySize(8, 6).setOffset(1, 8);
      sprite.disableBody(true, true);
      this.physics.add.collider(this.player, sprite);
      this.patientSprites.set(slot.npcId, sprite);
    });

    this.physics.world.setBounds(0, 0, this.clinicMap.pixelWidth, this.clinicMap.pixelHeight);
  }

  private configureInput(): void {
    if (!this.input.keyboard) {
      throw new Error("当前浏览器无法初始化键盘输入");
    }
    this.cursorKeys = this.input.keyboard.createCursorKeys();
    this.movementKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as MovementKeys;
    this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  }

  private configureBridge(): void {
    this.stopListening = [
      gameCommands.on("movement.set", (movement) => {
        this.virtualMovement = normalizeMovementInput(movement);
      }),
      gameCommands.on("interaction.confirm", () => {
        if (this.availableInteraction) {
          this.activateInteraction(this.availableInteraction.interactionId);
        }
      }),
      gameCommands.on("interaction.activate", ({ interactionId }) => {
        this.activateInteraction(interactionId);
      }),
      gameCommands.on("interaction.close", () => this.closeInteraction()),
      gameCommands.on("clinic.intro-complete", ({ commandId }) => {
        this.applyClinicCommand({ type: "intro.complete", commandId }, () => {
          this.player.setTexture("player-placeholder");
          worldEvents.emit("speech.show", {
            messageId: "speech.intro.day-start",
            speakerId: DOCTOR_NPC_ID,
            speakerRole: "doctor",
            text: "又是开始接诊的一天",
          });
        });
      }),
      gameCommands.on("clinic.start-shift", ({ commandId, shiftId, caseSummaries }) => {
        this.startShift(commandId, shiftId, caseSummaries);
      }),
      gameCommands.on("clinic.dismiss-current", ({ commandId, sessionId }) => {
        this.dismissCurrentPatient(commandId, sessionId);
      }),
      gameCommands.on("world.set-suspended", ({ suspended }) => {
        this.setWorldSuspended(suspended);
      }),
    ];
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    const mobileLike = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
    const cameraCenter = this.requireMapObject(
      mobileLike ? "anchor.camera-mobile-center" : "anchor.camera-center",
    );
    camera.setBounds(0, 0, this.clinicMap.pixelWidth, this.clinicMap.pixelHeight);
    camera.setZoom(mobileLike ? 1 : 0.82);
    camera.centerOn(cameraCenter.x, cameraCenter.y);
    camera.roundPixels = true;
  }

  private startShift(
    commandId: string,
    shiftId: string,
    caseSummaries?: readonly CaseSummaryV1[],
  ): void {
    const patients = caseSummaries === undefined
      ? GRAYBOX_PATIENTS
      : createPatientQueueEntriesFromCaseSummaries(
          caseSummaries,
          GRAYBOX_PATIENT_SLOTS,
        );
    const applied = this.applyClinicCommand({
      type: "shift.start",
      commandId,
      shiftId: shiftId || GRAYBOX_SHIFT_ID,
      patients,
    });
    if (!applied) {
      return;
    }

    this.closeInteraction(false);
    this.applyClinicCommand({
      type: "queue.form",
      commandId: `queue-form.${this.clinicFlow.shiftId}`,
    });
    this.showWaitingQueue();
    this.time.delayedCall(420, () => {
      this.applyClinicCommand({
        type: "queue.formed",
        commandId: `queue-formed.${this.clinicFlow.shiftId}`,
      });
    });
  }

  private showWaitingQueue(): void {
    this.clinicFlow.queue.forEach((patient) => {
      const anchor = this.requireMapObject(patient.queueAnchorId);
      const sprite = this.requirePatientSprite(patient.npcId);
      const identity = this.resolvePatientIdentity(patient.patientRoleId);
      sprite.setTexture(identity.sprite.standingTextureKey);
      sprite.setTint(identity.sprite.tint);
      sprite.enableBody(true, anchor.x, anchor.y, true, true);
      this.emitPatientVisual(patient, "standing", true);
    });
  }

  private callNextPatient(): void {
    const nextPatient = this.clinicFlow.queue[0];
    if (!nextPatient) {
      return;
    }
    const applied = this.applyClinicCommand({
      type: "patient.call",
      commandId: `call-command.${nextPatient.queueEntryId}`,
      callId: `call.${nextPatient.queueEntryId}`,
    });
    if (applied) {
      this.animatePatientEntry(nextPatient);
    }
  }

  private animatePatientEntry(patient: PatientQueueEntry): void {
    const sprite = this.requirePatientSprite(patient.npcId);
    this.moveAlongAnchors(
      sprite,
      ["anchor.entrance", "anchor.entry-path.01", "anchor.entry-path.02", "anchor.patient-seat"],
      () => {
        const seated = this.applyClinicCommand({
          type: "patient.seated",
          commandId: `seat.${patient.arrivalId}`,
          arrivalId: patient.arrivalId,
        });
        if (seated) {
          const identity = this.resolvePatientIdentity(patient.patientRoleId);
          sprite.setTexture(identity.sprite.seatedTextureKey);
          sprite.setTint(identity.sprite.tint);
          sprite.setBodySize(8, 4).setOffset(2, 7);
          this.emitPatientVisual(patient, "seated", true);
          worldEvents.emit("speech.show", {
            messageId: `speech.greeting.${patient.npcId}`,
            speakerId: patient.npcId,
            speakerRole: "patient",
            text: "您好，医生。我已经准备好开始今天的问诊了。",
          });
        }
      },
    );
  }

  private dismissCurrentPatient(
    commandId: string,
    sessionId: CaseSummaryV1["sessionId"],
  ): void {
    const patient = this.clinicFlow.currentPatient;
    if (!patient) {
      return;
    }
    const started = this.applyClinicCommand({
      type: "patient.departure.start",
      commandId,
      npcId: patient.npcId,
      sessionId,
    });
    if (!started) {
      return;
    }

    const sprite = this.requirePatientSprite(patient.npcId);
    const identity = this.resolvePatientIdentity(patient.patientRoleId);
    sprite.setTexture(identity.sprite.standingTextureKey);
    sprite.setTint(identity.sprite.tint);
    sprite.setBodySize(8, 6).setOffset(1, 8);
    this.emitPatientVisual(patient, "standing", true);

    worldEvents.emit("speech.show", {
      messageId: `speech.goodbye.${patient.sessionId}`,
      speakerId: patient.npcId,
      speakerRole: "patient",
      text: "谢谢医生，我先离开了。",
    });
    this.moveAlongAnchors(
      sprite,
      ["anchor.entry-path.02", "anchor.entry-path.01", "anchor.exit"],
      () => {
        sprite.disableBody(true, true);
        this.emitPatientVisual(patient, "standing", false);
        this.applyClinicCommand({
          type: "patient.departure.complete",
          commandId: `departure-complete.${patient.sessionId}`,
          npcId: patient.npcId,
          sessionId: patient.sessionId,
        });
        this.repositionWaitingQueue();
      },
    );
  }

  private repositionWaitingQueue(): void {
    this.clinicFlow.queue.forEach((patient, index) => {
      const sprite = this.requirePatientSprite(patient.npcId);
      const target = this.requireMapObject(`anchor.queue.0${index + 1}`);
      if (sprite.visible) {
        this.tweens.add({ targets: sprite, x: target.x, y: target.y, duration: 280 });
      }
    });
  }

  private moveAlongAnchors(
    sprite: Phaser.Physics.Arcade.Image,
    anchorIds: string[],
    onComplete: () => void,
  ): void {
    const [nextAnchorId, ...remaining] = anchorIds;
    if (!nextAnchorId) {
      onComplete();
      return;
    }
    const target = this.requireMapObject(nextAnchorId);
    const distance = Phaser.Math.Distance.Between(sprite.x, sprite.y, target.x, target.y);
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      duration: Math.max(
        180,
        Math.round((distance / (64 * (this.clinicMap.tileWidth / 16))) * 1_000),
      ),
      ease: "Linear",
      onComplete: () => this.moveAlongAnchors(sprite, remaining, onComplete),
    });
  }

  private updateInteractionAvailability(): void {
    if (this.activeInteraction || this.externallySuspended) {
      this.setAvailableInteraction(null);
      return;
    }
    const candidates = [
      { details: COMPUTER_INTERACTION, object: this.requireMapObject("interaction.computer.01") },
      { details: CALL_INTERACTION, object: this.requireMapObject("interaction.call-next.01") },
    ].filter(({ details }) => this.isInteractionEnabled(details));
    const nearest = candidates
      .map((candidate) => ({
        ...candidate,
        distance: Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          candidate.object.x + candidate.object.width / 2,
          candidate.object.y + candidate.object.height / 2,
        ),
      }))
      .filter(
        ({ distance }) => distance <= INTERACTION_DISTANCE * (this.clinicMap.tileWidth / 16),
      )
      .sort((left, right) => left.distance - right.distance)[0];
    this.setAvailableInteraction(nearest?.details ?? null);
  }

  private activateInteraction(interactionId: string): void {
    if (this.externallySuspended) {
      return;
    }
    if (interactionId === COMPUTER_INTERACTION.interactionId) {
      if (!this.isInteractionEnabled(COMPUTER_INTERACTION)) {
        return;
      }
      if (this.clinicFlow.phase === "clinic_ready") {
        const opened = this.applyClinicCommand({
          type: "computer.open",
          commandId: this.nextLocalCommandId("computer-open"),
        });
        if (!opened) {
          return;
        }
      }
      this.activeInteraction = COMPUTER_INTERACTION;
      this.setAvailableInteraction(null);
      this.player.setVelocity(0, 0);
      worldEvents.emit("interaction.opened", COMPUTER_INTERACTION);
      return;
    }
    if (interactionId === CALL_INTERACTION.interactionId && this.isInteractionEnabled(CALL_INTERACTION)) {
      this.callNextPatient();
    }
  }

  private closeInteraction(updateFlow = true): void {
    if (!this.activeInteraction) {
      return;
    }
    this.activeInteraction = null;
    if (updateFlow && this.clinicFlow.phase === "computer_opened") {
      this.applyClinicCommand({
        type: "computer.close",
        commandId: this.nextLocalCommandId("computer-close"),
      });
    }
    worldEvents.emit("interaction.closed", undefined);
  }

  private isInteractionEnabled(details: InteractionDetails): boolean {
    if (details.kind === "computer") {
      return ["clinic_ready", "ready_to_call", "shift_completed"].includes(this.clinicFlow.phase);
    }
    return details.kind === "call-button" && this.clinicFlow.phase === "ready_to_call";
  }

  private nextLocalCommandId(prefix: string): string {
    this.localCommandSequence += 1;
    return `${prefix}.${this.localCommandSequence}`;
  }

  private setWorldSuspended(suspended: boolean): void {
    if (this.externallySuspended === suspended) {
      return;
    }
    this.externallySuspended = suspended;
    this.virtualMovement = { x: 0, y: 0 };
    this.player.setVelocity(0, 0);
    if (suspended) {
      this.scene.pause();
    } else {
      this.scene.resume();
    }
  }

  private applyClinicCommand(command: ClinicFlowCommand, onApplied?: () => void): boolean {
    const result = transitionClinicFlow(this.clinicFlow, command);
    if (result.status !== "applied") {
      return false;
    }
    this.clinicFlow = result.state;
    this.emitClinicFlow();
    onApplied?.();
    return true;
  }

  private emitClinicFlow(): void {
    const snapshot: ClinicFlowSnapshot = {
      phase: this.clinicFlow.phase,
      shiftId: this.clinicFlow.shiftId,
      waitingCount: this.clinicFlow.queue.length,
      currentPatientNpcId: this.clinicFlow.currentPatient?.npcId ?? null,
      currentPatientRoleId: this.clinicFlow.currentPatient?.patientRoleId ?? null,
      currentSessionId: this.clinicFlow.currentPatient?.sessionId ?? null,
      currentPatientLabel: this.clinicFlow.currentPatient?.label ?? null,
      completedCount: this.clinicFlow.completedSessionIds.length,
    };
    worldEvents.emit("clinic.flow.updated", snapshot);
  }

  private setAvailableInteraction(interaction: InteractionDetails | null): void {
    if (interaction?.interactionId === this.availableInteraction?.interactionId) {
      return;
    }
    this.availableInteraction = interaction;
    worldEvents.emit("interaction.available", interaction);
  }

  private updateScreenAnchors(time: number): void {
    if (time - this.lastAnchorUpdate < 80) {
      return;
    }
    this.lastAnchorUpdate = time;
    const roundedPosition = {
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
    };
    if (
      roundedPosition.x !== this.lastReportedPlayerPosition.x ||
      roundedPosition.y !== this.lastReportedPlayerPosition.y
    ) {
      this.lastReportedPlayerPosition = roundedPosition;
      worldEvents.emit("player.position", roundedPosition);
    }
    this.emitScreenAnchor(DOCTOR_NPC_ID, this.player.x, this.player.y - 10, true);
    this.patientSprites.forEach((sprite, npcId) => {
      this.emitScreenAnchor(npcId, sprite.x, sprite.y - 10, sprite.visible);
    });
  }

  private emitScreenAnchor(anchorId: string, worldX: number, worldY: number, visible: boolean): void {
    const camera = this.cameras.main;
    const insideCamera = camera.worldView.contains(worldX, worldY);
    const xRatio = Phaser.Math.Clamp(
      ((worldX - camera.worldView.x) * camera.zoom) / camera.width,
      0.03,
      0.97,
    );
    const yRatio = Phaser.Math.Clamp(
      ((worldY - camera.worldView.y) * camera.zoom) / camera.height,
      0.08,
      0.92,
    );
    worldEvents.emit("world.anchor.updated", {
      anchorId,
      xRatio,
      yRatio,
      visible: visible && insideCamera,
    });
  }

  private emitPatientVisual(
    patient: PatientQueueEntry,
    pose: "standing" | "seated",
    spriteVisible: boolean,
  ): void {
    const sprite = this.requirePatientSprite(patient.npcId);
    const visible = spriteVisible && this.cameras.main.worldView.contains(sprite.x, sprite.y);
    worldEvents.emit("patient.visual.updated", {
      npcId: patient.npcId,
      patientRoleId: patient.patientRoleId,
      pose,
      visible,
    });
  }

  private resolvePatientIdentity(patientRoleId: string): PublicPatientIdentity {
    const identity = resolvePublicPatientIdentity(patientRoleId);
    assertPublicPatientIdentityAssets(identity, (assetId) => this.textures.exists(assetId));
    return identity;
  }

  private requirePatientSprite(npcId: string): Phaser.Physics.Arcade.Image {
    const sprite = this.patientSprites.get(npcId);
    if (!sprite) {
      throw new Error(`Patient actor slot has no sprite: ${npcId}`);
    }
    return sprite;
  }

  private isMovementLocked(): boolean {
    return (
      this.externallySuspended ||
      this.activeInteraction !== null ||
      this.clinicFlow.phase === "doctor_seated_intro"
    );
  }

  private requireMapObject(stableId: string): ClinicMapObject {
    const object = this.clinicMap.objects.get(stableId);
    if (!object) {
      throw new Error(`Clinic map object is missing: ${stableId}`);
    }
    return object;
  }

  private requireAssetConfig(): ClinicAssetConfig {
    const config = this.registry.get(CLINIC_ASSET_CONFIG_KEY) as
      | ClinicAssetConfig
      | undefined;
    if (!config) {
      throw new Error("Clinic asset configuration is missing");
    }
    return config;
  }

  private readCompositionCoverage(): string[] {
    const camera = this.cameras.main;
    const mobileLike = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
    const center = this.requireMapObject(
      mobileLike ? "anchor.camera-mobile-center" : "anchor.camera-center",
    );
    const viewWidth = camera.width / camera.zoom;
    const viewHeight = camera.height / camera.zoom;
    const view = new Phaser.Geom.Rectangle(
      Phaser.Math.Clamp(center.x - viewWidth / 2, 0, Math.max(0, this.clinicMap.pixelWidth - viewWidth)),
      Phaser.Math.Clamp(center.y - viewHeight / 2, 0, Math.max(0, this.clinicMap.pixelHeight - viewHeight)),
      viewWidth,
      viewHeight,
    );
    return COMPOSITION_OBJECTS.filter((stableId) => {
      const object = this.clinicMap.objects.get(stableId);
      if (!object) return false;
      if (object.width === 0 && object.height === 0) {
        return view.contains(object.x, object.y);
      }
      return Phaser.Geom.Intersects.RectangleToRectangle(
        view,
        new Phaser.Geom.Rectangle(object.x, object.y, object.width, object.height),
      );
    });
  }

  private readHorizontalKeyboardInput(): number {
    const leftPressed = this.cursorKeys.left.isDown || this.movementKeys.left.isDown;
    const rightPressed = this.cursorKeys.right.isDown || this.movementKeys.right.isDown;
    return Number(rightPressed) - Number(leftPressed);
  }

  private readVerticalKeyboardInput(): number {
    const upPressed = this.cursorKeys.up.isDown || this.movementKeys.up.isDown;
    const downPressed = this.cursorKeys.down.isDown || this.movementKeys.down.isDown;
    return Number(downPressed) - Number(upPressed);
  }

  private dispose(): void {
    this.stopListening.forEach((stop) => stop());
    this.stopListening = [];
    this.virtualMovement = { x: 0, y: 0 };
    this.availableInteraction = null;
    this.activeInteraction = null;
    this.patientSprites.clear();
    this.collisionObjects.length = 0;
    this.tilemap = null;
    worldEvents.emit("interaction.available", null);
    worldEvents.emit("interaction.closed", undefined);
  }
}

function colorNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
