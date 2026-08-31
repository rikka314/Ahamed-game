import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    this.createPlaceholderTexture("player-placeholder", 10, 14, 0xf3c969);
    this.createPlaceholderTexture("player-seated-placeholder", 12, 11, 0xf3c969);
    this.createPlaceholderTexture("patient-placeholder-01", 10, 14, 0xe88e85);
    this.createPlaceholderTexture("patient-placeholder-02", 10, 14, 0x75a9cf);
    this.createPlaceholderTexture("patient-seated-placeholder-01", 12, 11, 0xe88e85);
    this.createPlaceholderTexture("patient-seated-placeholder-02", 12, 11, 0x75a9cf);
    this.createPlaceholderTexture("wall-placeholder", 2, 2, 0x335b4d);
    this.scene.start("preload");
  }

  private createPlaceholderTexture(key: string, width: number, height: number, color: number): void {
    if (this.textures.exists(key)) {
      return;
    }

    const graphics = this.add.graphics();
    graphics.fillStyle(color, 1);
    graphics.fillRect(0, 0, width, height);
    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }
}
