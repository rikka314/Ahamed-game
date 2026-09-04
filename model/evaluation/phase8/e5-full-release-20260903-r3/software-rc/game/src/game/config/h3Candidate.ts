export type H3Candidate = "16" | "32" | null;

export type ClinicAssetConfig = {
  contentBuildId: "dev";
  h3Candidate: H3Candidate;
  tileSize: 16 | 32;
  logicalWidth: 320 | 640;
  logicalHeight: 180 | 360;
  mapUrl: string;
  tilesetUrl: string | null;
  usesTilemap: boolean;
};

export const CLINIC_ASSET_CONFIG_KEY = "clinic.asset-config";

export function resolveClinicAssetConfig(search: string): ClinicAssetConfig {
  const requested = new URLSearchParams(search).get("h3Candidate");

  if (requested === "16" || requested === "32") {
    const tileSize = Number(requested) as 16 | 32;
    return {
      contentBuildId: "dev",
      h3Candidate: requested,
      tileSize,
      logicalWidth: tileSize === 16 ? 320 : 640,
      logicalHeight: tileSize === 16 ? 180 : 360,
      mapUrl: `/game-assets/dev/h3-${requested}/maps/clinic-community.tmj`,
      tilesetUrl: `/game-assets/dev/h3-${requested}/tilesets/clinic-community.png`,
      usesTilemap: true,
    };
  }

  return {
    contentBuildId: "dev",
    h3Candidate: null,
    tileSize: 16,
    logicalWidth: 320,
    logicalHeight: 180,
    mapUrl: "/game-assets/dev/maps/clinic-graybox.tmj",
    tilesetUrl: null,
    usesTilemap: false,
  };
}
