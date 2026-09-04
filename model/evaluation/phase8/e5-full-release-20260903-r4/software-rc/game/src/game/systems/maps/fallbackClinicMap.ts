import type {
  ClinicMapObject,
  ParsedClinicMap,
} from "@/src/game/systems/maps/tiledClinicMap";

export function createFallbackClinicMap(
  tileSize: 16 | 32 = 16,
  h3Candidate: "16" | "32" | null = null,
): ParsedClinicMap {
  const baseMap: ParsedClinicMap = {
    mapId: "map.clinic.fallback-dev",
    contentBuildId: "dev",
    h3Candidate,
    visualMode: "rectangles",
    tilesetName: null,
    width: 20,
    height: 12,
    tileWidth: 16,
    tileHeight: 16,
    pixelWidth: 320,
    pixelHeight: 192,
    ground: [
      {
        stableId: "fallback.ground",
        x: 0,
        y: 0,
        width: 320,
        height: 192,
        fillColor: "#b9c8a7",
        depth: 0,
        label: "开发回退诊所",
      },
    ],
    decoration: [
      {
        stableId: "fallback.desk",
        x: 152,
        y: 84,
        width: 72,
        height: 32,
        fillColor: "#8d674f",
        depth: 30,
        label: "接诊桌",
      },
    ],
    collision: [
      { stableId: "fallback.top", x: 0, y: 0, width: 320, height: 8 },
      { stableId: "fallback.bottom", x: 0, y: 184, width: 320, height: 8 },
      { stableId: "fallback.left", x: 0, y: 0, width: 8, height: 192 },
      { stableId: "fallback.right", x: 312, y: 0, width: 8, height: 192 },
      { stableId: "fallback.desk-collision", x: 152, y: 84, width: 72, height: 32 },
    ],
    abovePlayer: [],
    objects: new Map<string, ClinicMapObject>([
      ["anchor.camera-center", anchor("anchor.camera-center", 160, 96)],
      ["anchor.camera-mobile-center", anchor("anchor.camera-mobile-center", 160, 96)],
      ["spawn.doctor.01", spawn("spawn.doctor.01", 236, 132)],
      ["anchor.doctor-seat", anchor("anchor.doctor-seat", 236, 132)],
      ["anchor.patient-seat", anchor("anchor.patient-seat", 140, 132)],
      ["anchor.entrance", anchor("anchor.entrance", 40, 132)],
      ["anchor.entry-path.01", anchor("anchor.entry-path.01", 80, 132)],
      ["anchor.entry-path.02", anchor("anchor.entry-path.02", 112, 132)],
      ["anchor.queue.01", anchor("anchor.queue.01", 32, 112)],
      ["anchor.queue.02", anchor("anchor.queue.02", 24, 144)],
      ["anchor.exit", anchor("anchor.exit", 24, 144)],
      [
        "anchor.exam.local-01",
        { ...anchor("anchor.exam.local-01", 280, 132), deviceId: "device.local.vitals-01" },
      ],
      [
        "interaction.computer.01",
        {
          stableId: "interaction.computer.01",
          kind: "interaction",
          x: 184,
          y: 76,
          width: 32,
          height: 24,
          interactionId: "interaction.computer.01",
          label: "诊所电脑",
        },
      ],
      [
        "interaction.call-next.01",
        {
          stableId: "interaction.call-next.01",
          kind: "interaction",
          x: 152,
          y: 76,
          width: 24,
          height: 24,
          interactionId: "interaction.call-next.01",
          label: "叫下一位",
        },
      ],
    ]),
  };

  if (tileSize === 16) {
    return baseMap;
  }

  const scale = tileSize / 16;
  return {
    ...baseMap,
    tileWidth: tileSize,
    tileHeight: tileSize,
    pixelWidth: baseMap.pixelWidth * scale,
    pixelHeight: baseMap.pixelHeight * scale,
    ground: baseMap.ground.map((rect) => scaleRect(rect, scale)),
    decoration: baseMap.decoration.map((rect) => scaleRect(rect, scale)),
    collision: baseMap.collision.map((rect) => scaleRect(rect, scale)),
    abovePlayer: baseMap.abovePlayer.map((rect) => scaleRect(rect, scale)),
    objects: new Map(
      [...baseMap.objects.entries()].map(([stableId, object]) => [
        stableId,
        scaleRect(object, scale),
      ]),
    ),
  };
}

function scaleRect<T extends { x: number; y: number; width: number; height: number }>(
  value: T,
  scale: number,
): T {
  return {
    ...value,
    x: value.x * scale,
    y: value.y * scale,
    width: value.width * scale,
    height: value.height * scale,
  };
}

function anchor(stableId: string, x: number, y: number) {
  return {
    stableId,
    kind: "anchor" as const,
    x,
    y,
    width: 0,
    height: 0,
  };
}

function spawn(stableId: string, x: number, y: number) {
  return {
    stableId,
    kind: "spawn" as const,
    x,
    y,
    width: 0,
    height: 0,
  };
}
