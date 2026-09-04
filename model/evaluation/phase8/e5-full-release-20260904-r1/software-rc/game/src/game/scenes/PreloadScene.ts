import Phaser from "phaser";
import {
  CLINIC_ASSET_CONFIG_KEY,
  resolveClinicAssetConfig,
} from "@/src/game/config/h3Candidate";

export const CLINIC_MAP_CACHE_KEY = "map.clinic.graybox-01";
export const CLINIC_TILESET_CACHE_KEY = "tileset.clinic.community-01";
export const CLINIC_MAP_LOAD_ERROR_KEY = "clinic.map-load-error";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("preload");
  }

  preload(): void {
    const assetConfig = resolveClinicAssetConfig(window.location.search);
    this.registry.set(CLINIC_ASSET_CONFIG_KEY, assetConfig);
    this.registry.remove(CLINIC_MAP_LOAD_ERROR_KEY);
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      this.registry.set(
        CLINIC_MAP_LOAD_ERROR_KEY,
        "Tiled 灰盒地图加载失败，已切换到开发回退场景。",
      );
    });
    if (assetConfig.usesTilemap && assetConfig.tilesetUrl) {
      this.load.tilemapTiledJSON(CLINIC_MAP_CACHE_KEY, assetConfig.mapUrl);
      this.load.image(CLINIC_TILESET_CACHE_KEY, assetConfig.tilesetUrl);
    } else {
      this.load.json(CLINIC_MAP_CACHE_KEY, assetConfig.mapUrl);
    }
  }

  create(): void {
    this.scene.start("world");
  }
}
