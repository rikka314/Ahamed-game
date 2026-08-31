import "client-only";
import Phaser from "phaser";
import { resolveClinicAssetConfig } from "@/src/game/config/h3Candidate";
import { BootScene } from "@/src/game/scenes/BootScene";
import { PreloadScene } from "@/src/game/scenes/PreloadScene";
import { WorldScene } from "@/src/game/scenes/WorldScene";

export function createGame(parent: HTMLElement): Phaser.Game {
  const assetConfig = resolveClinicAssetConfig(window.location.search);

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: assetConfig.logicalWidth,
    height: assetConfig.logicalHeight,
    backgroundColor: "#12251f",
    pixelArt: true,
    render: {
      antialias: false,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: assetConfig.logicalWidth,
      height: assetConfig.logicalHeight,
    },
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
      },
    },
    scene: [BootScene, PreloadScene, WorldScene],
  });
}
