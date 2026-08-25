import "client-only";
import Phaser from "phaser";
import { BootScene } from "@/src/game/scenes/BootScene";
import { WorldScene } from "@/src/game/scenes/WorldScene";

const LOGICAL_WIDTH = 320;
const LOGICAL_HEIGHT = 180;

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    backgroundColor: "#12251f",
    pixelArt: true,
    render: {
      antialias: false,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: LOGICAL_WIDTH,
      height: LOGICAL_HEIGHT,
    },
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
      },
    },
    scene: [BootScene, WorldScene],
  });
}
