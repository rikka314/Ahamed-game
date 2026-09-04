import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(projectRoot, "..");
const requiredLayers = ["Ground", "Decoration", "Collision", "AbovePlayer", "Objects"];
const candidateSizes = [16, 32];
const regenerateSource = process.argv.includes("--regenerate-source");

function property(name, value, type = "string") {
  return { name, type, value };
}

function stableProperties(stableId, kind, extra = []) {
  return [property("stableId", stableId), property("kind", kind), ...extra];
}

function createObject(id, stableId, kind, x, y, width = 0, height = 0, extra = []) {
  return {
    id,
    ...(width === 0 && height === 0 ? { point: true } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    properties: stableProperties(stableId, kind, extra),
  };
}

function createCollision(id, stableId, x, y, width, height) {
  return {
    id,
    x,
    y,
    width,
    height,
    rotation: 0,
    visible: true,
    properties: [property("stableId", stableId)],
  };
}

function setTile(data, width, x, y, gid) {
  if (x < 0 || y < 0 || x >= width || y >= data.length / width) return;
  data[y * width + x] = gid;
}

function fillTiles(data, width, left, top, tileWidth, tileHeight, gid) {
  for (let y = top; y < top + tileHeight; y += 1) {
    for (let x = left; x < left + tileWidth; x += 1) setTile(data, width, x, y, gid);
  }
}

function createGroundLayer(mapWidth, mapHeight) {
  const data = Array(mapWidth * mapHeight).fill(3);
  fillTiles(data, mapWidth, 4, 3, 18, 10, 1);
  fillTiles(data, mapWidth, 0, 5, 5, 6, 2);
  return data;
}

function createDecorationLayer(mapWidth, mapHeight) {
  const data = Array(mapWidth * mapHeight).fill(0);
  for (let x = 4; x <= 21; x += 1) {
    setTile(data, mapWidth, x, 3, 4);
    setTile(data, mapWidth, x, 12, 4);
  }
  for (let y = 3; y <= 12; y += 1) {
    if (y !== 7 && y !== 8) setTile(data, mapWidth, 4, y, 5);
    setTile(data, mapWidth, 21, y, 5);
  }
  setTile(data, mapWidth, 4, 3, 6);
  setTile(data, mapWidth, 21, 3, 7);
  setTile(data, mapWidth, 4, 7, 8);
  setTile(data, mapWidth, 4, 8, 8);
  fillTiles(data, mapWidth, 11, 7, 5, 2, 9);
  setTile(data, mapWidth, 10, 9, 11);
  setTile(data, mapWidth, 16, 9, 10);
  setTile(data, mapWidth, 14, 6, 12);
  setTile(data, mapWidth, 12, 6, 13);
  for (let y = 4; y <= 10; y += 1) setTile(data, mapWidth, 18, y, 14);
  setTile(data, mapWidth, 20, 4, 15);
  for (let y = 5; y <= 7; y += 1) setTile(data, mapWidth, 20, y, 16);
  setTile(data, mapWidth, 20, 9, 17);
  setTile(data, mapWidth, 16, 7, 18);
  setTile(data, mapWidth, 2, 6, 19);
  setTile(data, mapWidth, 2, 9, 20);
  setTile(data, mapWidth, 7, 5, 24);
  setTile(data, mapWidth, 8, 3, 23);
  return data;
}

function createAboveLayer(mapWidth, mapHeight) {
  const data = Array(mapWidth * mapHeight).fill(0);
  setTile(data, mapWidth, 18, 3, 31);
  setTile(data, mapWidth, 4, 7, 32);
  return data;
}

function createTileset(tileSize) {
  return {
    columns: 8,
    image: `clinic-community-h3-${tileSize}.png`,
    imageheight: tileSize * 4,
    imagewidth: tileSize * 8,
    margin: 0,
    name: `clinic-community-h3-${tileSize}`,
    spacing: 0,
    tilecount: 32,
    tileheight: tileSize,
    tilewidth: tileSize,
    tiledversion: "1.12.2",
    type: "tileset",
    version: "1.10",
    properties: [
      property("assetId", "tileset.clinic.community-01"),
      property("contentBuildId", "dev"),
      property("h3Candidate", String(tileSize)),
      property("status", "DRAFT"),
      property("paddingStatus", "candidate-zero"),
    ],
  };
}

function createMap(tileSize, runtimeTileset) {
  const mapWidth = 26;
  const mapHeight = 16;
  const scale = tileSize / 16;
  const scaled = (value) => Math.round(value * scale);
  const collision = [
    createCollision(30, "collision.wall.top", scaled(64), scaled(48), scaled(288), scaled(16)),
    createCollision(31, "collision.wall.bottom", scaled(64), scaled(192), scaled(288), scaled(16)),
    createCollision(32, "collision.wall.left-top", scaled(64), scaled(48), scaled(16), scaled(64)),
    createCollision(33, "collision.wall.left-bottom", scaled(64), scaled(144), scaled(16), scaled(64)),
    createCollision(34, "collision.wall.right", scaled(336), scaled(48), scaled(16), scaled(160)),
    createCollision(35, "collision.consultation-desk", scaled(176), scaled(112), scaled(80), scaled(32)),
    createCollision(36, "collision.curtain-divider", scaled(288), scaled(64), scaled(16), scaled(80)),
    createCollision(37, "collision.exam-bed", scaled(320), scaled(64), scaled(16), scaled(64)),
    createCollision(38, "collision.bp-device", scaled(320), scaled(144), scaled(32), scaled(32)),
    createCollision(39, "collision.locked-upper", 0, 0, scaled(416), scaled(48)),
    createCollision(40, "collision.locked-lower", 0, scaled(208), scaled(416), scaled(48)),
  ];
  const objects = [
    createObject(50, "anchor.camera-center", "anchor", scaled(208), scaled(128)),
    createObject(51, "spawn.doctor.01", "spawn", scaled(264), scaled(148)),
    createObject(52, "anchor.camera-mobile-center", "anchor", scaled(188), scaled(128)),
    createObject(53, "anchor.doctor-seat", "anchor", scaled(264), scaled(148)),
    createObject(54, "anchor.patient-seat", "anchor", scaled(162), scaled(148)),
    createObject(55, "anchor.entrance", "anchor", scaled(76), scaled(136)),
    createObject(56, "anchor.entry-path.01", "anchor", scaled(108), scaled(136)),
    createObject(57, "anchor.entry-path.02", "anchor", scaled(136), scaled(148)),
    createObject(58, "anchor.queue.01", "anchor", scaled(48), scaled(128)),
    createObject(59, "anchor.queue.02", "anchor", scaled(32), scaled(148)),
    createObject(60, "anchor.exit", "anchor", scaled(48), scaled(148)),
    createObject(61, "anchor.exam.bp-01", "anchor", scaled(320), scaled(148), 0, 0, [property("deviceId", "device.local.bp-01")]),
    createObject(62, "interaction.computer.01", "interaction", scaled(212), scaled(92), scaled(44), scaled(36), [property("interactionId", "interaction.computer.01"), property("label", "诊所电脑")]),
    createObject(63, "interaction.call-next.01", "interaction", scaled(180), scaled(92), scaled(32), scaled(32), [property("interactionId", "interaction.call-next.01"), property("label", "叫下一位")]),
    createObject(64, "locked-zone.future-upper", "locked-zone", scaled(48), 0, scaled(320), scaled(48), [property("label", "未解锁")]),
    createObject(65, "locked-zone.future-lower", "locked-zone", scaled(48), scaled(208), scaled(320), scaled(48), [property("label", "未解锁")]),
    createObject(66, "interaction.drawer.thermometer-01", "interaction", scaled(248), scaled(112), scaled(24), scaled(32), [property("interactionId", "interaction.drawer.thermometer-01"), property("deviceId", "device.local.thermometer-01")]),
    createObject(67, "anchor.thermometer.doctor-handoff", "anchor", scaled(224), scaled(140)),
    createObject(68, "anchor.thermometer.patient-handoff", "anchor", scaled(184), scaled(140)),
    createObject(69, "device.local.bp-01", "device", scaled(320), scaled(160), 0, 0, [property("deviceId", "device.local.bp-01")]),
    createObject(70, "device.local.thermometer-01", "device", scaled(256), scaled(124), 0, 0, [property("deviceId", "device.local.thermometer-01")]),
    createObject(71, "npc.doctor.player-01", "npc", scaled(264), scaled(148), 0, 0, [property("npcId", "npc.doctor.player-01")]),
    createObject(72, "npc.patient.graybox-01", "npc", scaled(48), scaled(128), 0, 0, [property("npcId", "npc.patient.graybox-01")]),
    createObject(73, "npc.patient.graybox-02", "npc", scaled(32), scaled(148), 0, 0, [property("npcId", "npc.patient.graybox-02")]),
  ];

  const sourceTileset = {
    firstgid: 1,
    source: `../tilesets/clinic-community-h3-${tileSize}.tsj`,
  };
  const embeddedTileset = {
    firstgid: 1,
    ...runtimeTileset,
    name: "clinic-community",
    image: "../tilesets/clinic-community.png",
  };

  return {
    source: {
      compressionlevel: -1,
      height: mapHeight,
      infinite: false,
      layers: createLayers(mapWidth, mapHeight, collision, objects),
      nextlayerid: 6,
      nextobjectid: 74,
      orientation: "orthogonal",
      properties: mapProperties(tileSize),
      renderorder: "right-down",
      tiledversion: "1.12.2",
      tileheight: tileSize,
      tilesets: [sourceTileset],
      tilewidth: tileSize,
      type: "map",
      version: "1.10",
      width: mapWidth,
    },
    runtime: {
      compressionlevel: -1,
      height: mapHeight,
      infinite: false,
      layers: createLayers(mapWidth, mapHeight, collision, objects),
      nextlayerid: 6,
      nextobjectid: 74,
      orientation: "orthogonal",
      properties: mapProperties(tileSize),
      renderorder: "right-down",
      tiledversion: "1.12.2",
      tileheight: tileSize,
      tilesets: [embeddedTileset],
      tilewidth: tileSize,
      type: "map",
      version: "1.10",
      width: mapWidth,
    },
  };
}

function mapProperties(tileSize) {
  return [
    property("mapId", "map.clinic.graybox-01"),
    property("tilesetAssetId", "tileset.clinic.community-01"),
    property("contentBuildId", "dev"),
    property("h3Candidate", String(tileSize)),
    property("tileSizeStatus", "candidate-h3"),
    property("paddingStatus", "candidate-zero"),
  ];
}

function createLayers(width, height, collision, objects) {
  return [
    tileLayer(1, "Ground", width, height, createGroundLayer(width, height)),
    tileLayer(2, "Decoration", width, height, createDecorationLayer(width, height)),
    objectLayer(3, "Collision", collision),
    tileLayer(4, "AbovePlayer", width, height, createAboveLayer(width, height)),
    objectLayer(5, "Objects", objects),
  ];
}

function tileLayer(id, name, width, height, data) {
  return {
    id,
    name,
    type: "tilelayer",
    width,
    height,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data,
    startx: 0,
    starty: 0,
    offsetx: 0,
    offsety: 0,
    parallaxx: 1,
    parallaxy: 1,
    class: "",
    tintcolor: "#ffffffff",
  };
}

function objectLayer(id, name, objects) {
  return {
    id,
    name,
    type: "objectgroup",
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: "topdown",
    objects,
  };
}

function validateMap(map, tileSize, runtime) {
  if (map.type !== "map" || map.orientation !== "orthogonal" || map.tiledversion !== "1.12.2") {
    throw new Error(`Invalid ${tileSize}px map header`);
  }
  if (map.tilewidth !== tileSize || map.tileheight !== tileSize) throw new Error(`Mixed tile size in ${tileSize}px candidate`);
  if (map.layers.map(({ name }) => name).join("|") !== requiredLayers.join("|")) throw new Error(`Layer contract mismatch in ${tileSize}px candidate`);
  const expectedTypes = ["tilelayer", "tilelayer", "objectgroup", "tilelayer", "objectgroup"];
  map.layers.forEach((layer, index) => {
    if (layer.type !== expectedTypes[index]) throw new Error(`Unexpected ${layer.name} type in ${tileSize}px candidate`);
    if (layer.compression !== undefined || layer.encoding !== undefined) throw new Error(`Compressed tile data is forbidden in ${tileSize}px candidate`);
    if (layer.type === "tilelayer") {
      if (!Array.isArray(layer.data) || layer.data.length !== map.width * map.height) {
        throw new Error(`${layer.name} must contain exactly ${map.width * map.height} tile gids`);
      }
      if (
        layer.data.some(
          (gid) => typeof gid !== "number" || !Number.isInteger(gid) || gid < 0 || gid > 32,
        )
      ) {
        throw new Error(`${layer.name} contains a gid outside the continuous 32-tile sheet`);
      }
      if (layer.name === "AbovePlayer" && !layer.data.some((gid) => gid > 0)) {
        throw new Error("AbovePlayer must contain at least one foreground tile");
      }
    }
  });
  if (map.tilesets.length !== 1) throw new Error(`Exactly one tileset is required in ${tileSize}px candidate`);
  if (runtime && map.tilesets[0].source !== undefined) throw new Error(`Runtime ${tileSize}px tileset was not flattened`);
  if (!runtime && typeof map.tilesets[0].source !== "string") throw new Error(`Source ${tileSize}px map must retain its external tileset`);
  if (
    runtime &&
    (map.tilesets[0].firstgid !== 1 ||
      map.tilesets[0].image !== "../tilesets/clinic-community.png" ||
      map.tilesets[0].imagewidth !== tileSize * 8 ||
      map.tilesets[0].imageheight !== tileSize * 4)
  ) {
    throw new Error(`Runtime ${tileSize}px tileset image contract is invalid`);
  }
  const stableIds = new Set();
  const objectsByStableId = new Map();
  for (const layer of map.layers.filter(({ type }) => type === "objectgroup")) {
    for (const object of layer.objects) {
      const stableId = object.properties.find(({ name }) => name === "stableId")?.value;
      if (typeof stableId !== "string" || stableId.length === 0) throw new Error(`Missing stableId in ${tileSize}px ${layer.name}`);
      if (stableIds.has(stableId)) throw new Error(`Duplicate stableId in ${tileSize}px candidate: ${stableId}`);
      stableIds.add(stableId);
      objectsByStableId.set(stableId, object);
    }
  }
  for (const requiredId of [
    "anchor.exam.bp-01",
    "interaction.drawer.thermometer-01",
    "anchor.thermometer.doctor-handoff",
    "anchor.thermometer.patient-handoff",
    "device.local.bp-01",
    "device.local.thermometer-01",
    "npc.doctor.player-01",
  ]) {
    if (!stableIds.has(requiredId)) throw new Error(`Missing required H3 object in ${tileSize}px candidate: ${requiredId}`);
  }
  const objectContracts = [
    ["spawn.doctor.01", "spawn"],
    ["anchor.doctor-seat", "anchor"],
    ["anchor.patient-seat", "anchor"],
    ["anchor.entrance", "anchor"],
    ["anchor.queue.01", "anchor"],
    ["anchor.queue.02", "anchor"],
    ["anchor.camera-center", "anchor"],
    ["anchor.camera-mobile-center", "anchor"],
    ["anchor.exam.bp-01", "anchor", "deviceId", "device.local.bp-01"],
    ["anchor.thermometer.doctor-handoff", "anchor"],
    ["anchor.thermometer.patient-handoff", "anchor"],
    ["interaction.computer.01", "interaction", "interactionId", "interaction.computer.01"],
    ["interaction.call-next.01", "interaction", "interactionId", "interaction.call-next.01"],
    [
      "interaction.drawer.thermometer-01",
      "interaction",
      "interactionId",
      "interaction.drawer.thermometer-01",
      "deviceId",
      "device.local.thermometer-01",
    ],
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
  ];
  for (const [stableId, kind, field, expected, extraField, extraExpected] of objectContracts) {
    const object = objectsByStableId.get(stableId);
    validateObjectProperty(object, "kind", kind);
    if (field) validateObjectProperty(object, field, expected);
    if (extraField) validateObjectProperty(object, extraField, extraExpected);
  }
  const lockedUpper = objectsByStableId.get("collision.locked-upper");
  const lockedLower = objectsByStableId.get("collision.locked-lower");
  if (lockedUpper?.x !== 0 || lockedUpper?.width !== tileSize * map.width) {
    throw new Error(`Upper locked-zone collision must span the full ${tileSize}px world width`);
  }
  if (lockedLower?.x !== 0 || lockedLower?.width !== tileSize * map.width) {
    throw new Error(`Lower locked-zone collision must span the full ${tileSize}px world width`);
  }
}

function validateObjectProperty(object, name, expected) {
  const actual = object?.properties?.find((propertyEntry) => propertyEntry.name === name)?.value;
  if (actual !== expected) {
    const stableId = object?.properties?.find((propertyEntry) => propertyEntry.name === "stableId")?.value ?? "unknown";
    throw new Error(`${stableId}.${name} must equal ${expected}`);
  }
}

function validateTileset(tileset, tileSize) {
  if (
    tileset.type !== "tileset" ||
    tileset.tiledversion !== "1.12.2" ||
    tileset.tilewidth !== tileSize ||
    tileset.tileheight !== tileSize ||
    tileset.tilecount !== 32 ||
    tileset.columns !== 8 ||
    tileset.imagewidth !== tileSize * 8 ||
    tileset.imageheight !== tileSize * 4 ||
    tileset.margin !== 0 ||
    tileset.spacing !== 0 ||
    tileset.image !== `clinic-community-h3-${tileSize}.png`
  ) {
    throw new Error(`Invalid source tileset contract for H3 ${tileSize}px`);
  }
}

function createRuntimeMap(sourceMap, sourceTileset) {
  const runtimeMap = structuredClone(sourceMap);
  runtimeMap.tilesets = [
    {
      firstgid: sourceMap.tilesets[0].firstgid,
      ...sourceTileset,
      name: "clinic-community",
      image: "../tilesets/clinic-community.png",
    },
  ];
  return runtimeMap;
}

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) throw new Error("Invalid PNG signature");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read H3 JSON source: ${path}`, { cause: error });
  }
}

const metrics = {
  generatedAt: "2026-08-30",
  contentBuildId: "dev",
  status: "DRAFT",
  candidates: [],
};

for (const tileSize of candidateSizes) {
  const sourcePngPath = resolve(outputDirectory("sourceTileset"), `clinic-community-h3-${tileSize}.png`);
  const sourceTilesetJsonPath = resolve(outputDirectory("sourceTileset"), `clinic-community-h3-${tileSize}.tsj`);
  const sourceMapPath = resolve(outputDirectory("sourceMap"), `clinic-community-h3-${tileSize}.tmj`);
  const sourceTilesetBuffer = await readFile(sourcePngPath);
  const dimensions = readPngDimensions(sourceTilesetBuffer);
  if (dimensions.width !== tileSize * 8 || dimensions.height !== tileSize * 4) throw new Error(`Unexpected ${tileSize}px tileset dimensions`);

  if (regenerateSource) {
    const generatedTileset = createTileset(tileSize);
    const generatedMap = createMap(tileSize, generatedTileset).source;
    validateTileset(generatedTileset, tileSize);
    validateMap(generatedMap, tileSize, false);
    await writeJson(sourceTilesetJsonPath, generatedTileset);
    await writeJson(sourceMapPath, generatedMap);
  }

  const sourceTileset = await readJson(sourceTilesetJsonPath);
  const sourceMap = await readJson(sourceMapPath);
  validateTileset(sourceTileset, tileSize);
  validateMap(sourceMap, tileSize, false);
  const runtimeMap = createRuntimeMap(sourceMap, sourceTileset);
  validateMap(runtimeMap, tileSize, true);

  const runtimeRoot = resolve(projectRoot, `public/game-assets/dev/h3-${tileSize}`);
  const runtimeMapPath = resolve(runtimeRoot, "maps/clinic-community.tmj");
  const runtimeTilesetPath = resolve(runtimeRoot, "tilesets/clinic-community.png");
  const manifestPath = resolve(runtimeRoot, "manifest.json");

  await mkdir(dirname(runtimeTilesetPath), { recursive: true });
  await copyFile(sourcePngPath, runtimeTilesetPath);
  await writeJson(runtimeMapPath, runtimeMap);
  await writeJson(manifestPath, {
    contentBuildId: "dev",
    candidateId: `h3-${tileSize}`,
    status: "DRAFT",
    generatedAt: null,
    assets: [
      {
        assetId: "map.clinic.graybox-01",
        kind: "tiled-map",
        path: `/game-assets/dev/h3-${tileSize}/maps/clinic-community.tmj`,
        status: "DRAFT",
        tileSize,
      },
      {
        assetId: "tileset.clinic.community-01",
        kind: "tileset",
        path: `/game-assets/dev/h3-${tileSize}/tilesets/clinic-community.png`,
        status: "DRAFT",
        tileSize,
        margin: 0,
        spacing: 0,
        extrusion: 0,
      },
    ],
  });

  const mapStats = await stat(runtimeMapPath);
  metrics.candidates.push({
    candidateId: `h3-${tileSize}`,
    tileSize,
    logicalViewport: tileSize === 16 ? { width: 320, height: 180 } : { width: 640, height: 360 },
    world: { width: tileSize * 26, height: tileSize * 16 },
    tileset: {
      width: dimensions.width,
      height: dimensions.height,
      fileBytes: sourceTilesetBuffer.length,
      sha256: createHash("sha256").update(sourceTilesetBuffer).digest("hex"),
      decodedRgbaBytes: dimensions.width * dimensions.height * 4,
      tileCount: 32,
      margin: 0,
      spacing: 0,
      extrusion: 0,
    },
    runtimeMapBytes: mapStats.size,
    productionNote: tileSize === 16
      ? "Lower texture and authoring cost; fewer pixels available for prop identity."
      : "Native detail pass with four times the decoded pixel area; not a scaled 16px export.",
  });
}

await writeJson(resolve(workspaceRoot, "docx/plan/game/evidence/h3/h3-artifact-metrics.json"), metrics);
console.log("Published H3 clinic candidates and validated their DRAFT manifests.");

function outputDirectory(kind) {
  if (kind === "sourceTileset") return resolve(projectRoot, "assets/source/tilesets");
  if (kind === "sourceMap") return resolve(projectRoot, "assets/source/maps");
  throw new Error(`Unknown output directory kind: ${kind}`);
}
