import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseTiledClinicMap,
  REQUIRED_CLINIC_LAYERS,
} from "@/src/game/systems/maps/tiledClinicMap";

async function readGrayboxMap(): Promise<unknown> {
  const path = fileURLToPath(
    new URL("../../assets/source/maps/clinic-graybox.tmj", import.meta.url),
  );
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readH3Map(candidate: "16" | "32"): Promise<unknown> {
  const path = fileURLToPath(
    new URL(
      `../../public/game-assets/dev/h3-${candidate}/maps/clinic-community.tmj`,
      import.meta.url,
    ),
  );
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("Tiled clinic map contract", () => {
  it("parses the real graybox map and exposes stable interaction anchors", async () => {
    const parsed = parseTiledClinicMap(await readGrayboxMap());

    expect(parsed.mapId).toBe("map.clinic.graybox-01");
    expect(parsed.contentBuildId).toBe("dev");
    expect(parsed.tileWidth).toBe(16);
    expect(parsed.objects.get("interaction.computer.01")).toMatchObject({
      kind: "interaction",
      interactionId: "interaction.computer.01",
    });
    expect(parsed.objects.get("anchor.queue.02")).toMatchObject({ kind: "anchor" });
    expect(parsed.objects.get("spawn.doctor.01")).toMatchObject({ kind: "spawn" });
    expect(parsed.objects.get("anchor.camera-mobile-center")).toMatchObject({
      kind: "anchor",
      x: 188,
    });
    expect(parsed.objects.get("anchor.patient-seat")).toMatchObject({ kind: "anchor" });
    expect(parsed.objects.get("anchor.exam.local-01")).toMatchObject({
      kind: "anchor",
      deviceId: "device.local.vitals-01",
    });
    expect(parsed.collision.length).toBeGreaterThan(0);
    expect(parsed.abovePlayer.length).toBeGreaterThan(0);
  });

  it("rejects a missing required layer", async () => {
    const input = (await readGrayboxMap()) as { layers: Array<{ name: string }> };
    input.layers = input.layers.filter(({ name }) => name !== REQUIRED_CLINIC_LAYERS[0]);

    expect(() => parseTiledClinicMap(input)).toThrow("Missing required Tiled layer: Ground");
  });

  it("rejects duplicate stable ids even when they occur in different layers", async () => {
    const input = (await readGrayboxMap()) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const groundStableId = input.layers
      .find(({ name }) => name === "Ground")!
      .objects[0].properties.find(({ name }) => name === "stableId")!.value;
    input.layers
      .find(({ name }) => name === "Decoration")!
      .objects[0].properties.find(({ name }) => name === "stableId")!.value = groundStableId;

    expect(() => parseTiledClinicMap(input)).toThrow("Duplicate stableId in Tiled map");
  });

  it.each(["16", "32"] as const)(
    "parses the native H3 %spx tilemap and its production anchors",
    async (candidate) => {
      const parsed = parseTiledClinicMap(await readH3Map(candidate));
      const tileSize = Number(candidate);

      expect(parsed).toMatchObject({
        mapId: "map.clinic.graybox-01",
        contentBuildId: "dev",
        h3Candidate: candidate,
        visualMode: "tilemap",
        tileWidth: tileSize,
        tileHeight: tileSize,
        width: 26,
        height: 16,
        pixelWidth: 26 * tileSize,
        pixelHeight: 16 * tileSize,
      });
      expect(parsed.tilesetName).toBe("clinic-community");
      expect(parsed.ground).toHaveLength(0);
      expect(parsed.abovePlayer).toHaveLength(0);
      expect(parsed.collision.length).toBeGreaterThan(0);
      expect(parsed.collision.find(({ stableId }) => stableId === "collision.locked-upper")).toMatchObject({
        x: 0,
        width: 26 * tileSize,
      });
      expect(parsed.collision.find(({ stableId }) => stableId === "collision.locked-lower")).toMatchObject({
        x: 0,
        width: 26 * tileSize,
      });
      expect(parsed.objects.get("anchor.exam.bp-01")).toMatchObject({
        kind: "anchor",
        deviceId: "device.local.bp-01",
      });
      expect(parsed.objects.get("interaction.drawer.thermometer-01")).toMatchObject({
        kind: "interaction",
        deviceId: "device.local.thermometer-01",
      });
      expect(parsed.objects.get("npc.doctor.player-01")).toMatchObject({
        kind: "npc",
        npcId: "npc.doctor.player-01",
      });
    },
  );

  it("keeps 16px and 32px candidates aligned on the same tile coordinates", async () => {
    const map16 = parseTiledClinicMap(await readH3Map("16"));
    const map32 = parseTiledClinicMap(await readH3Map("32"));

    [
      "anchor.camera-center",
      "spawn.doctor.01",
      "anchor.queue.01",
      "anchor.exam.bp-01",
      "interaction.drawer.thermometer-01",
    ].forEach((stableId) => {
      const object16 = map16.objects.get(stableId)!;
      const object32 = map32.objects.get(stableId)!;
      expect(object32.x).toBe(object16.x * 2);
      expect(object32.y).toBe(object16.y * 2);
      expect(object32.width).toBe(object16.width * 2);
      expect(object32.height).toBe(object16.height * 2);
    });
  });

  it("rejects a candidate that mixes 16px map density with a 32px label", async () => {
    const input = (await readH3Map("16")) as {
      tilewidth: number;
      tileheight: number;
      properties: Array<{ name: string; value: unknown }>;
    };
    input.properties.find(({ name }) => name === "h3Candidate")!.value = "32";

    expect(() => parseTiledClinicMap(input)).toThrow(
      "H3 32 candidate must use 32x32 tiles",
    );
  });

  it("rejects an H3 NPC without a matching npcId", async () => {
    const input = (await readH3Map("16")) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const npc = input.layers
      .find(({ name }) => name === "Objects")!
      .objects.find((object) =>
        object.properties.some(
          ({ name, value }) => name === "stableId" && value === "npc.doctor.player-01",
        ),
      )!;
    npc.properties.find(({ name }) => name === "npcId")!.value = "npc.doctor.wrong";

    expect(() => parseTiledClinicMap(input)).toThrow(
      "npc.doctor.player-01.npcId must match its stableId",
    );
  });

  it("rejects an H3 device without a deviceId", async () => {
    const input = (await readH3Map("32")) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const device = input.layers
      .find(({ name }) => name === "Objects")!
      .objects.find((object) =>
        object.properties.some(
          ({ name, value }) => name === "stableId" && value === "device.local.bp-01",
        ),
      )!;
    device.properties = device.properties.filter(({ name }) => name !== "deviceId");

    expect(() => parseTiledClinicMap(input)).toThrow(
      "device.local.bp-01.deviceId must be a non-empty string",
    );
  });

  it("rejects an interaction stable id disguised as an anchor", async () => {
    const input = (await readH3Map("16")) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const computer = input.layers
      .find(({ name }) => name === "Objects")!
      .objects.find((object) =>
        object.properties.some(
          ({ name, value }) => name === "stableId" && value === "interaction.computer.01",
        ),
      )!;
    computer.properties.find(({ name }) => name === "kind")!.value = "anchor";

    expect(() => parseTiledClinicMap(input)).toThrow(
      "interaction.computer.01.kind must be interaction",
    );
  });

  it("requires the thermometer drawer to target the thermometer device", async () => {
    const input = (await readH3Map("16")) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const drawer = input.layers
      .find(({ name }) => name === "Objects")!
      .objects.find((object) =>
        object.properties.some(
          ({ name, value }) =>
            name === "stableId" && value === "interaction.drawer.thermometer-01",
        ),
      )!;
    drawer.properties = drawer.properties.filter(({ name }) => name !== "deviceId");

    expect(() => parseTiledClinicMap(input)).toThrow(
      "interaction.drawer.thermometer-01.deviceId must be device.local.thermometer-01",
    );
  });

  it("requires handoff points to remain anchors", async () => {
    const input = (await readH3Map("32")) as {
      layers: Array<{
        name: string;
        objects: Array<{ properties: Array<{ name: string; value: unknown }> }>;
      }>;
    };
    const handoff = input.layers
      .find(({ name }) => name === "Objects")!
      .objects.find((object) =>
        object.properties.some(
          ({ name, value }) =>
            name === "stableId" && value === "anchor.thermometer.doctor-handoff",
        ),
      )!;
    handoff.properties.find(({ name }) => name === "kind")!.value = "spawn";

    expect(() => parseTiledClinicMap(input)).toThrow(
      "anchor.thermometer.doctor-handoff.kind must be anchor",
    );
  });

  it("rejects an empty foreground tile layer", async () => {
    const input = (await readH3Map("16")) as {
      layers: Array<{ name: string; data: number[] }>;
    };
    input.layers.find(({ name }) => name === "AbovePlayer")!.data.fill(0);

    expect(() => parseTiledClinicMap(input)).toThrow(
      "AbovePlayer must contain at least one foreground tile",
    );
  });

  it("rejects a gid outside the continuous tileset", async () => {
    const input = (await readH3Map("32")) as {
      layers: Array<{ name: string; data: number[] }>;
    };
    input.layers.find(({ name }) => name === "Decoration")!.data[0] = 33;

    expect(() => parseTiledClinicMap(input)).toThrow(
      "Decoration.data[0] must be an integer gid between 0 and 32",
    );
  });
});
