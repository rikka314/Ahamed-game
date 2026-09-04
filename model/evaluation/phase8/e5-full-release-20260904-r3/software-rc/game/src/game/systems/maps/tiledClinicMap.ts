export const REQUIRED_CLINIC_LAYERS = [
  "Ground",
  "Decoration",
  "Collision",
  "AbovePlayer",
  "Objects",
] as const;

export type ClinicLayerName = (typeof REQUIRED_CLINIC_LAYERS)[number];

export type ClinicVisualRect = {
  stableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor?: string;
  label?: string;
  depth: number;
};

export type ClinicCollisionRect = {
  stableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ClinicMapObjectBase = {
  stableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type ClinicMapObject = ClinicMapObjectBase &
  (
    | {
        kind: "anchor" | "spawn" | "locked-zone";
        interactionId?: string;
        deviceId?: string;
        npcId?: string;
      }
    | {
        kind: "interaction";
        interactionId: string;
        deviceId?: string;
        npcId?: string;
      }
    | { kind: "npc"; npcId: string }
    | { kind: "device"; deviceId: string }
  );

export type ParsedClinicMap = {
  mapId: string;
  contentBuildId: string;
  h3Candidate: "16" | "32" | null;
  visualMode: "rectangles" | "tilemap";
  tilesetName: string | null;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  ground: ClinicVisualRect[];
  decoration: ClinicVisualRect[];
  collision: ClinicCollisionRect[];
  abovePlayer: ClinicVisualRect[];
  objects: Map<string, ClinicMapObject>;
};

type UnknownRecord = Record<string, unknown>;

export function parseTiledClinicMap(input: unknown): ParsedClinicMap {
  const map = asRecord(input, "Tiled map");
  const width = positiveNumber(map.width, "map.width");
  const height = positiveNumber(map.height, "map.height");
  const tileWidth = positiveNumber(map.tilewidth, "map.tilewidth");
  const tileHeight = positiveNumber(map.tileheight, "map.tileheight");
  const layers = asArray(map.layers, "map.layers").map((layer, index) =>
    asRecord(layer, `map.layers[${index}]`),
  );
  const properties = readProperties(map.properties, "map.properties");
  const mapId = requiredString(properties.get("mapId"), "mapId");
  const contentBuildId = requiredString(
    properties.get("contentBuildId"),
    "contentBuildId",
  );
  const h3Candidate = readH3Candidate(properties.get("h3Candidate"));
  if (h3Candidate && (tileWidth !== Number(h3Candidate) || tileHeight !== Number(h3Candidate))) {
    throw new Error(`H3 ${h3Candidate} candidate must use ${h3Candidate}x${h3Candidate} tiles`);
  }

  const layersByName = new Map<string, UnknownRecord>();
  layers.forEach((layer) => {
    const name = requiredString(layer.name, "layer.name");
    if (layersByName.has(name)) {
      throw new Error(`Duplicate Tiled layer: ${name}`);
    }
    layersByName.set(name, layer);
  });

  REQUIRED_CLINIC_LAYERS.forEach((name) => {
    if (!layersByName.has(name)) {
      throw new Error(`Missing required Tiled layer: ${name}`);
    }
  });

  const visualLayerNames = ["Ground", "Decoration", "AbovePlayer"] as const;
  const visualLayerTypes = visualLayerNames.map((name) => layersByName.get(name)?.type);
  const usesRectangleLayers = visualLayerTypes.every((type) => type === "objectgroup");
  const usesTileLayers = visualLayerTypes.every((type) => type === "tilelayer");
  if (!usesRectangleLayers && !usesTileLayers) {
    throw new Error("Ground, Decoration and AbovePlayer must use one consistent layer mode");
  }
  const tilesetContract = usesTileLayers
    ? readTilesetContract(map.tilesets, tileWidth, tileHeight)
    : null;

  const stableIds = new Set<string>();
  const ground = usesRectangleLayers
    ? readVisualLayer(layersByName.get("Ground"), "Ground", stableIds, 0)
    : [];
  const decoration = usesRectangleLayers
    ? readVisualLayer(layersByName.get("Decoration"), "Decoration", stableIds, 20)
    : [];
  const collision = readCollisionLayer(
    layersByName.get("Collision"),
    stableIds,
  );
  const abovePlayer = usesRectangleLayers
    ? readVisualLayer(layersByName.get("AbovePlayer"), "AbovePlayer", stableIds, 100)
    : [];
  if (usesTileLayers) {
    visualLayerNames.forEach((name) =>
      validateTileLayer(
        layersByName.get(name),
        name,
        width,
        height,
        tilesetContract!.tileCount,
      ),
    );
  }
  const objects = readObjectLayer(layersByName.get("Objects"), stableIds);

  [
    ["spawn.doctor.01", "spawn"],
    ["anchor.doctor-seat", "anchor"],
    ["anchor.patient-seat", "anchor"],
    ["anchor.entrance", "anchor"],
    ["anchor.queue.01", "anchor"],
    ["anchor.queue.02", "anchor"],
    ["anchor.camera-center", "anchor"],
    ["anchor.camera-mobile-center", "anchor"],
    ["interaction.computer.01", "interaction", "interactionId", "interaction.computer.01"],
    ["interaction.call-next.01", "interaction", "interactionId", "interaction.call-next.01"],
  ].forEach(([stableId, kind, field, value]) => {
    validateClinicObjectContract(objects, stableId, kind, field, value);
  });
  if (!objects.has("anchor.exam.bp-01") && !objects.has("anchor.exam.local-01")) {
    throw new Error("Missing required clinic object: anchor.exam.bp-01");
  }
  validateClinicObjectContract(
    objects,
    objects.has("anchor.exam.bp-01") ? "anchor.exam.bp-01" : "anchor.exam.local-01",
    "anchor",
  );

  if (h3Candidate) {
    [
      [
        "interaction.drawer.thermometer-01",
        "interaction",
        "interactionId",
        "interaction.drawer.thermometer-01",
      ],
      ["anchor.thermometer.doctor-handoff", "anchor"],
      ["anchor.thermometer.patient-handoff", "anchor"],
      ["device.local.bp-01", "device", "deviceId", "device.local.bp-01"],
      [
        "device.local.thermometer-01",
        "device",
        "deviceId",
        "device.local.thermometer-01",
      ],
      ["npc.doctor.player-01", "npc", "npcId", "npc.doctor.player-01"],
      ["npc.patient.graybox-01", "npc", "npcId", "npc.patient.graybox-01"],
      ["npc.patient.graybox-02", "npc", "npcId", "npc.patient.graybox-02"],
    ].forEach(([stableId, kind, field, value]) => {
      validateClinicObjectContract(objects, stableId, kind, field, value, true);
    });
    validateClinicObjectContract(
      objects,
      "interaction.drawer.thermometer-01",
      "interaction",
      "deviceId",
      "device.local.thermometer-01",
      true,
    );
    validateClinicObjectContract(
      objects,
      "anchor.exam.bp-01",
      "anchor",
      "deviceId",
      "device.local.bp-01",
      true,
    );
  }

  return {
    mapId,
    contentBuildId,
    h3Candidate,
    visualMode: usesTileLayers ? "tilemap" : "rectangles",
    tilesetName: tilesetContract?.name ?? null,
    width,
    height,
    tileWidth,
    tileHeight,
    pixelWidth: width * tileWidth,
    pixelHeight: height * tileHeight,
    ground,
    decoration,
    collision,
    abovePlayer,
    objects,
  };
}

function readVisualLayer(
  layer: UnknownRecord | undefined,
  layerName: ClinicLayerName,
  stableIds: Set<string>,
  defaultDepth: number,
): ClinicVisualRect[] {
  return readLayerObjects(layer, layerName).map((object, index) => {
    const properties = readProperties(
      object.properties,
      `${layerName}.objects[${index}].properties`,
    );
    const stableId = registerStableId(properties, stableIds, layerName, index);

    return {
      stableId,
      x: finiteNumber(object.x, `${stableId}.x`),
      y: finiteNumber(object.y, `${stableId}.y`),
      width: positiveNumber(object.width, `${stableId}.width`),
      height: positiveNumber(object.height, `${stableId}.height`),
      fillColor: colorString(properties.get("fillColor"), `${stableId}.fillColor`),
      strokeColor: optionalColor(properties.get("strokeColor"), `${stableId}.strokeColor`),
      label: optionalString(properties.get("label"), `${stableId}.label`),
      depth: optionalFiniteNumber(properties.get("depth")) ?? defaultDepth,
    };
  });
}

function readCollisionLayer(
  layer: UnknownRecord | undefined,
  stableIds: Set<string>,
): ClinicCollisionRect[] {
  return readLayerObjects(layer, "Collision").map((object, index) => {
    const properties = readProperties(
      object.properties,
      `Collision.objects[${index}].properties`,
    );
    const stableId = registerStableId(properties, stableIds, "Collision", index);

    return {
      stableId,
      x: finiteNumber(object.x, `${stableId}.x`),
      y: finiteNumber(object.y, `${stableId}.y`),
      width: positiveNumber(object.width, `${stableId}.width`),
      height: positiveNumber(object.height, `${stableId}.height`),
    };
  });
}

function readObjectLayer(
  layer: UnknownRecord | undefined,
  stableIds: Set<string>,
): Map<string, ClinicMapObject> {
  const result = new Map<string, ClinicMapObject>();

  readLayerObjects(layer, "Objects").forEach((object, index) => {
    const properties = readProperties(
      object.properties,
      `Objects.objects[${index}].properties`,
    );
    const stableId = registerStableId(properties, stableIds, "Objects", index);
    const kind = requiredString(properties.get("kind"), `${stableId}.kind`);

    if (
      kind !== "anchor" &&
      kind !== "spawn" &&
      kind !== "interaction" &&
      kind !== "locked-zone" &&
      kind !== "npc" &&
      kind !== "device"
    ) {
      throw new Error(`Unsupported clinic object kind for ${stableId}: ${kind}`);
    }

    const base = {
      stableId,
      x: finiteNumber(object.x, `${stableId}.x`),
      y: finiteNumber(object.y, `${stableId}.y`),
      width: optionalFiniteNumber(object.width) ?? 0,
      height: optionalFiniteNumber(object.height) ?? 0,
      label: optionalString(properties.get("label"), `${stableId}.label`),
    };
    if (kind === "npc") {
      const npcId = requiredString(properties.get("npcId"), `${stableId}.npcId`);
      if (npcId !== stableId) {
        throw new Error(`${stableId}.npcId must match its stableId`);
      }
      result.set(stableId, { ...base, kind, npcId });
      return;
    }
    if (kind === "device") {
      const deviceId = requiredString(properties.get("deviceId"), `${stableId}.deviceId`);
      if (deviceId !== stableId) {
        throw new Error(`${stableId}.deviceId must match its stableId`);
      }
      result.set(stableId, { ...base, kind, deviceId });
      return;
    }
    const deviceId = optionalString(properties.get("deviceId"), `${stableId}.deviceId`);
    const npcId = optionalString(properties.get("npcId"), `${stableId}.npcId`);
    if (kind === "interaction") {
      result.set(stableId, {
        ...base,
        kind,
        interactionId: requiredString(
          properties.get("interactionId"),
          `${stableId}.interactionId`,
        ),
        deviceId,
        npcId,
      });
      return;
    }
    result.set(stableId, {
      ...base,
      kind,
      interactionId: optionalString(
        properties.get("interactionId"),
        `${stableId}.interactionId`,
      ),
      deviceId,
      npcId,
    });
  });

  return result;
}

function validateTileLayer(
  layer: UnknownRecord | undefined,
  layerName: "Ground" | "Decoration" | "AbovePlayer",
  mapWidth: number,
  mapHeight: number,
  tileCount: number,
): void {
  if (!layer || layer.type !== "tilelayer") {
    throw new Error(`${layerName} must be a Tiled tile layer`);
  }
  if (layer.encoding !== undefined || layer.compression !== undefined) {
    throw new Error(`${layerName} must use uncompressed tile data`);
  }
  if (positiveNumber(layer.width, `${layerName}.width`) !== mapWidth) {
    throw new Error(`${layerName}.width must match map.width`);
  }
  if (positiveNumber(layer.height, `${layerName}.height`) !== mapHeight) {
    throw new Error(`${layerName}.height must match map.height`);
  }
  const data = asArray(layer.data, `${layerName}.data`);
  if (data.length !== mapWidth * mapHeight) {
    throw new Error(`${layerName}.data must contain exactly ${mapWidth * mapHeight} gids`);
  }
  data.forEach((gid, index) => {
    if (typeof gid !== "number" || !Number.isInteger(gid) || gid < 0 || gid > tileCount) {
      throw new Error(
        `${layerName}.data[${index}] must be an integer gid between 0 and ${tileCount}`,
      );
    }
  });
  if (layerName === "AbovePlayer" && !data.some((gid) => typeof gid === "number" && gid > 0)) {
    throw new Error("AbovePlayer must contain at least one foreground tile");
  }
}

function readTilesetContract(
  input: unknown,
  mapTileWidth: number,
  mapTileHeight: number,
): { name: string; tileCount: number } {
  const tilesets = asArray(input, "map.tilesets");
  if (tilesets.length !== 1) {
    throw new Error("H3 clinic maps must use exactly one continuous tileset");
  }
  const tileset = asRecord(tilesets[0], "map.tilesets[0]");
  if (tileset.source !== undefined) {
    throw new Error("Runtime H3 clinic tileset must be embedded");
  }
  const name = requiredString(tileset.name, "map.tilesets[0].name");
  const image = requiredString(tileset.image, "map.tilesets[0].image");
  const tileCount = positiveNumber(tileset.tilecount, "map.tilesets[0].tilecount");
  if (!Number.isInteger(tileCount)) {
    throw new Error("map.tilesets[0].tilecount must be an integer");
  }
  if (
    tileset.firstgid !== 1 ||
    tileset.tilewidth !== mapTileWidth ||
    tileset.tileheight !== mapTileHeight ||
    tileset.imagewidth !== mapTileWidth * 8 ||
    tileset.imageheight !== mapTileHeight * 4 ||
    tileset.margin !== 0 ||
    tileset.spacing !== 0 ||
    image !== "../tilesets/clinic-community.png"
  ) {
    throw new Error("Runtime H3 clinic tileset must use the published continuous PNG");
  }
  return { name, tileCount };
}

function validateClinicObjectContract(
  objects: Map<string, ClinicMapObject>,
  stableId: string,
  expectedKind: string,
  field?: string,
  expectedValue?: string,
  h3Only = false,
): void {
  const object = objects.get(stableId);
  if (!object) {
    throw new Error(
      `Missing required ${h3Only ? "H3 " : ""}clinic object: ${stableId}`,
    );
  }
  if (object.kind !== expectedKind) {
    throw new Error(`${stableId}.kind must be ${expectedKind}`);
  }
  if (field && object[field as keyof ClinicMapObject] !== expectedValue) {
    throw new Error(`${stableId}.${field} must be ${expectedValue}`);
  }
}

function readH3Candidate(input: unknown): "16" | "32" | null {
  if (input === undefined || input === null || input === "") {
    return null;
  }
  if (input === "16" || input === "32") {
    return input;
  }
  throw new Error("h3Candidate must be 16 or 32");
}

function readLayerObjects(
  layer: UnknownRecord | undefined,
  layerName: ClinicLayerName,
): UnknownRecord[] {
  if (!layer) {
    throw new Error(`Missing required Tiled layer: ${layerName}`);
  }
  if (layer.type !== "objectgroup") {
    throw new Error(`${layerName} must be a Tiled object layer`);
  }

  return asArray(layer.objects, `${layerName}.objects`).map((object, index) =>
    asRecord(object, `${layerName}.objects[${index}]`),
  );
}

function registerStableId(
  properties: Map<string, unknown>,
  stableIds: Set<string>,
  layerName: ClinicLayerName,
  index: number,
): string {
  const stableId = requiredString(
    properties.get("stableId"),
    `${layerName}.objects[${index}].stableId`,
  );

  if (stableIds.has(stableId)) {
    throw new Error(`Duplicate stableId in Tiled map: ${stableId}`);
  }
  stableIds.add(stableId);
  return stableId;
}

function readProperties(input: unknown, path: string): Map<string, unknown> {
  const properties = new Map<string, unknown>();
  asArray(input ?? [], path).forEach((item, index) => {
    const property = asRecord(item, `${path}[${index}]`);
    const name = requiredString(property.name, `${path}[${index}].name`);
    if (properties.has(name)) {
      throw new Error(`Duplicate Tiled property at ${path}: ${name}`);
    }
    properties.set(name, property.value);
  });
  return properties;
}

function asRecord(input: unknown, path: string): UnknownRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${path} must be an object`);
  }
  return input as UnknownRecord;
}

function asArray(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) {
    throw new Error(`${path} must be an array`);
  }
  return input;
}

function requiredString(input: unknown, path: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return input;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  return requiredString(input, path);
}

function finiteNumber(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`${path} must be a finite number`);
  }
  return input;
}

function positiveNumber(input: unknown, path: string): number {
  const value = finiteNumber(input, path);
  if (value <= 0) {
    throw new Error(`${path} must be greater than zero`);
  }
  return value;
}

function optionalFiniteNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function colorString(input: unknown, path: string): string {
  const value = requiredString(input, path);
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${path} must use #RRGGBB`);
  }
  return value;
}

function optionalColor(input: unknown, path: string): string | undefined {
  return input === undefined || input === null || input === ""
    ? undefined
    : colorString(input, path);
}
