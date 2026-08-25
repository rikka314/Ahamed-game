import Phaser from "phaser";
import {
  gameCommands,
  worldEvents,
  type InteractionDetails,
} from "@/src/game/bridge/gameBridge";
import {
  normalizeMovementInput,
  type MovementVector,
} from "@/src/game/domain/player/movement";

const PLAYER_SPEED = 72;
const INTERACTION_DISTANCE = 28;

const PATIENT_INTERACTION: InteractionDetails = {
  interactionId: "interaction.patient.reception-01",
  npcId: "npc.patient.reception-01",
  label: "候诊患者",
};

type MovementKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Image;
  private patient!: Phaser.Types.Physics.Arcade.ImageWithStaticBody;
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private movementKeys!: MovementKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private virtualMovement: MovementVector = { x: 0, y: 0 };
  private availableInteraction: InteractionDetails | null = null;
  private movementLocked = false;
  private stopListening: Array<() => void> = [];

  constructor() {
    super("world");
  }

  create(): void {
    try {
      this.createClinic();
      this.configureInput();
      this.configureBridge();

      this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
      worldEvents.emit("world.ready", { locationId: "location.clinic.reception" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "诊所场景初始化失败";
      worldEvents.emit("world.error", { message });
      throw error;
    }
  }

  update(): void {
    this.updateInteractionAvailability();

    if (this.movementLocked) {
      this.player.setVelocity(0, 0);
      return;
    }

    const movement = normalizeMovementInput({
      x: this.readHorizontalKeyboardInput() + this.virtualMovement.x,
      y: this.readVerticalKeyboardInput() + this.virtualMovement.y,
    });

    this.player.setVelocity(movement.x * PLAYER_SPEED, movement.y * PLAYER_SPEED);

    if (
      this.availableInteraction &&
      (Phaser.Input.Keyboard.JustDown(this.interactKey) ||
        Phaser.Input.Keyboard.JustDown(this.enterKey))
    ) {
      this.openAvailableInteraction();
    }
  }

  private createClinic(): void {
    this.add.rectangle(160, 90, 320, 180, 0x16372d);
    this.add.rectangle(160, 96, 280, 124, 0xd2c6a4);
    this.add.rectangle(160, 96, 264, 108, 0xb9d2bd);
    this.add.text(18, 15, "AHAMED CLINIC / RECEPTION", {
      color: "#d9f4e4",
      fontFamily: "monospace",
      fontSize: "7px",
    });

    const walls = [
      this.createWall(160, 34, 284, 8),
      this.createWall(160, 158, 284, 8),
      this.createWall(18, 96, 8, 132),
      this.createWall(302, 96, 8, 132),
      this.createWall(224, 84, 64, 10),
    ];

    this.player = this.physics.add.image(72, 118, "player-placeholder");
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);

    this.patient = this.physics.add.staticImage(252, 116, "patient-placeholder");
    this.patient.setDepth(9);

    walls.forEach((wall) => this.physics.add.collider(this.player, wall));
    this.physics.add.collider(this.player, this.patient);

    this.add.text(232, 128, "PATIENT", {
      color: "#244339",
      fontFamily: "monospace",
      fontSize: "6px",
    });

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.roundPixels = true;
  }

  private createWall(x: number, y: number, width: number, height: number) {
    const wall = this.physics.add.staticImage(x, y, "wall-placeholder");
    wall.setDisplaySize(width, height);
    wall.refreshBody();
    return wall;
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
      gameCommands.on("interaction.confirm", () => this.openAvailableInteraction()),
      gameCommands.on("interaction.close", () => this.closeInteraction()),
    ];
  }

  private updateInteractionAvailability(): void {
    const inRange =
      Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        this.patient.x,
        this.patient.y,
      ) <= INTERACTION_DISTANCE;
    const nextInteraction = inRange ? PATIENT_INTERACTION : null;

    if (nextInteraction?.interactionId === this.availableInteraction?.interactionId) {
      return;
    }

    this.availableInteraction = nextInteraction;
    worldEvents.emit("interaction.available", nextInteraction);
  }

  private openAvailableInteraction(): void {
    if (!this.availableInteraction || this.movementLocked) {
      return;
    }

    this.movementLocked = true;
    this.virtualMovement = { x: 0, y: 0 };
    this.player.setVelocity(0, 0);
    worldEvents.emit("interaction.opened", this.availableInteraction);
  }

  private closeInteraction(): void {
    if (!this.movementLocked) {
      return;
    }

    this.movementLocked = false;
    worldEvents.emit("interaction.closed", undefined);
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
    worldEvents.emit("interaction.available", null);
    worldEvents.emit("interaction.closed", undefined);
  }
}
