import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    this.createPlaceholderTexture("player-placeholder", 10, 14, 0xf3c969);
    this.createPlaceholderTexture("patient-placeholder", 10, 14, 0xe88e85);
    this.createPlaceholderTexture("wall-placeholder", 2, 2, 0x335b4d);
    this.scene.start("world");
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
