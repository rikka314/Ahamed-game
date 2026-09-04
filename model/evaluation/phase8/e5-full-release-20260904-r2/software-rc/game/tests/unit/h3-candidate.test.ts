import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveClinicAssetConfig } from "@/src/game/config/h3Candidate";

describe("H3 clinic candidate configuration", () => {
  it("keeps the existing graybox as the default path", () => {
    expect(resolveClinicAssetConfig("")).toEqual({
      contentBuildId: "dev",
      h3Candidate: null,
      tileSize: 16,
      logicalWidth: 320,
      logicalHeight: 180,
      mapUrl: "/game-assets/dev/maps/clinic-graybox.tmj",
      tilesetUrl: null,
      usesTilemap: false,
    });
  });

  it.each([
    ["16", 16, 320, 180],
    ["32", 32, 640, 360],
  ] as const)("resolves the %spx comparison package", (candidate, tileSize, width, height) => {
    expect(resolveClinicAssetConfig(`?h3Candidate=${candidate}`)).toEqual({
      contentBuildId: "dev",
      h3Candidate: candidate,
      tileSize,
      logicalWidth: width,
      logicalHeight: height,
      mapUrl: `/game-assets/dev/h3-${candidate}/maps/clinic-community.tmj`,
      tilesetUrl: `/game-assets/dev/h3-${candidate}/tilesets/clinic-community.png`,
      usesTilemap: true,
    });
  });

  it("does not activate an unknown density", () => {
    expect(resolveClinicAssetConfig("?h3Candidate=24").h3Candidate).toBeNull();
  });

  it.each(["16", "32"] as const)(
    "publishes an isolated DRAFT manifest and complete provenance for H3 %s",
    async (candidate) => {
      const manifestPath = fileURLToPath(
        new URL(
          `../../public/game-assets/dev/h3-${candidate}/manifest.json`,
          import.meta.url,
        ),
      );
      const provenancePath = fileURLToPath(
        new URL(
          `../../assets/source/tilesets/clinic-community-h3-${candidate}.provenance.json`,
          import.meta.url,
        ),
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        contentBuildId: string;
        candidateId: string;
        status: string;
        assets: Array<{ assetId: string; status: string; tileSize: number }>;
      };
      const provenance = JSON.parse(await readFile(provenancePath, "utf8")) as {
        assetId: string;
        sourceType: string;
        generator: string;
        prompt: string;
        humanEdits: string[];
        generationSteps: string[];
        status: string;
      };

      expect(manifest).toMatchObject({
        contentBuildId: "dev",
        candidateId: `h3-${candidate}`,
        status: "DRAFT",
      });
      expect(manifest.assets).toHaveLength(2);
      expect(manifest.assets.every(({ status }) => status === "DRAFT")).toBe(true);
      expect(manifest.assets.map(({ assetId }) => assetId)).toEqual([
        "map.clinic.graybox-01",
        "tileset.clinic.community-01",
      ]);
      expect(manifest.assets.every(({ tileSize }) => tileSize === Number(candidate))).toBe(true);
      expect(provenance).toMatchObject({
        assetId: "tileset.clinic.community-01",
        sourceType: "ai-assisted",
        status: "DRAFT",
      });
      expect(provenance.generator).toContain("LibreSprite");
      expect(provenance.prompt).not.toBe("");
      expect(provenance.humanEdits).toEqual([]);
      expect(provenance.generationSteps.length).toBeGreaterThan(0);
    },
  );
});
