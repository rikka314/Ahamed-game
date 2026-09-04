import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "assets/source/tilesets");

const palette = {
  transparent: "#00000000",
  deep: "#102019",
  deepSoft: "#17231f",
  outline: "#2b3932",
  lock: "#485250",
  cream: "#f4ecd8",
  creamShadow: "#d9d2bb",
  sageLight: "#b9c8a7",
  sage: "#71806a",
  amber: "#d69a4a",
  amberLight: "#f3c85f",
  coral: "#d9827b",
  lake: "#6d9aa5",
  wood: "#8d674f",
  woodDark: "#684938",
  curtain: "#9b7f82",
  curtainDark: "#7b6068",
  device: "#6f8f89",
  deviceDark: "#385b58",
  white: "#e8efe5",
};

class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  point(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b, a] = rgba(color);
    const offset = (y * this.width + x) * 4;
    this.pixels[offset] = r;
    this.pixels[offset + 1] = g;
    this.pixels[offset + 2] = b;
    this.pixels[offset + 3] = a;
  }

  fill(x, y, width, height, color) {
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) this.point(px, py, color);
    }
  }

  hline(x, y, width, color) {
    this.fill(x, y, width, 1, color);
  }

  vline(x, y, height, color) {
    this.fill(x, y, 1, height, color);
  }
}

function rgba(hex) {
  const value = hex.slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  ];
}

function tileOrigin(index, size) {
  return { x: (index % 8) * size, y: Math.floor(index / 8) * size };
}

function tileFill(raster, index, size, color) {
  const origin = tileOrigin(index, size);
  raster.fill(origin.x, origin.y, size, size, color);
  return origin;
}

function drawFloor(raster, index, size, base, accent, detailed) {
  const { x, y } = tileFill(raster, index, size, base);
  const step = detailed ? 8 : 6;
  for (let py = 2; py < size - 2; py += step) {
    for (let px = py % (step * 2) === 2 ? 3 : 6; px < size - 2; px += step) {
      raster.point(x + px, y + py, accent);
    }
  }
  if (detailed) {
    raster.hline(x, y + size - 1, size, accent);
    raster.vline(x + size - 1, y, size, accent);
  }
}

function drawLockedFog(raster, index, size, detailed) {
  const { x, y } = tileFill(raster, index, size, palette.lock);
  const stride = detailed ? 5 : 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      if ((px * 3 + py * 5) % stride === 0) raster.point(x + px, y + py, palette.deepSoft);
    }
  }
  const lockSize = detailed ? 10 : 6;
  raster.fill(x + Math.floor((size - lockSize) / 2), y + Math.floor(size * 0.5), lockSize, Math.floor(lockSize * 0.65), palette.deep);
  raster.hline(x + Math.floor(size * 0.42), y + Math.floor(size * 0.43), Math.floor(size * 0.16), palette.deep);
}

function drawWallHorizontal(raster, index, size, detailed) {
  const { x, y } = tileFill(raster, index, size, palette.sage);
  raster.fill(x, y + Math.floor(size * 0.25), size, Math.ceil(size * 0.75), palette.creamShadow);
  raster.hline(x, y + Math.floor(size * 0.25), size, palette.deep);
  raster.hline(x, y + size - 2, size, palette.outline);
  if (detailed) raster.hline(x + 3, y + Math.floor(size * 0.56), size - 6, palette.cream);
}

function drawWallVertical(raster, index, size, detailed) {
  const { x, y } = tileFill(raster, index, size, palette.sage);
  raster.fill(x + Math.floor(size * 0.25), y, Math.ceil(size * 0.75), size, palette.creamShadow);
  raster.vline(x + Math.floor(size * 0.25), y, size, palette.deep);
  raster.vline(x + size - 2, y, size, palette.outline);
  if (detailed) raster.vline(x + Math.floor(size * 0.56), y + 3, size - 6, palette.cream);
}

function drawCorner(raster, index, size, flip) {
  const { x, y } = tileFill(raster, index, size, palette.creamShadow);
  const thickness = Math.max(3, Math.floor(size * 0.25));
  raster.fill(x, y, size, thickness, palette.sage);
  raster.fill(flip ? x + size - thickness : x, y, thickness, size, palette.sage);
  raster.hline(x, y + thickness - 1, size, palette.deep);
  raster.vline(flip ? x + size - thickness : x + thickness - 1, y, size, palette.deep);
}

function drawDoor(raster, index, size, detailed) {
  const { x, y } = tileFill(raster, index, size, palette.creamShadow);
  const top = Math.floor(size * 0.55);
  raster.fill(x + 1, y + top, size - 2, Math.ceil(size * 0.35), palette.wood);
  raster.hline(x + 1, y + top, size - 2, palette.woodDark);
  if (detailed) {
    for (let px = 3; px < size - 3; px += 6) raster.vline(x + px, y + top + 2, Math.floor(size * 0.2), palette.amber);
  }
}

function drawDesk(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + 1, y + 2, size - 2, size - 5, palette.wood);
  raster.hline(x + 1, y + 2, size - 2, palette.amber);
  raster.hline(x + 1, y + size - 4, size - 2, palette.woodDark);
  if (detailed) {
    raster.hline(x + 4, y + 7, size - 8, palette.woodDark);
    raster.point(x + size - 6, y + size - 7, palette.amberLight);
  }
}

function drawChair(raster, index, size, color, detailed) {
  const { x, y } = tileOrigin(index, size);
  const inset = detailed ? 6 : 3;
  raster.fill(x + inset, y + 2, size - inset * 2, Math.floor(size * 0.45), color);
  raster.fill(x + inset + 1, y + Math.floor(size * 0.48), size - (inset + 1) * 2, Math.floor(size * 0.32), palette.woodDark);
  raster.vline(x + inset, y + Math.floor(size * 0.7), Math.floor(size * 0.22), palette.outline);
  raster.vline(x + size - inset - 1, y + Math.floor(size * 0.7), Math.floor(size * 0.22), palette.outline);
  if (detailed) raster.hline(x + inset + 2, y + 6, size - inset * 2 - 4, palette.sageLight);
}

function drawComputer(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  const inset = detailed ? 5 : 3;
  raster.fill(x + inset, y + 2, size - inset * 2, Math.floor(size * 0.55), palette.outline);
  raster.fill(x + inset + 2, y + 4, size - inset * 2 - 4, Math.floor(size * 0.35), palette.deviceDark);
  if (detailed) raster.fill(x + inset + 4, y + 6, size - inset * 2 - 8, 2, palette.lake);
  raster.fill(x + Math.floor(size * 0.45), y + Math.floor(size * 0.58), Math.max(2, Math.floor(size * 0.1)), Math.floor(size * 0.2), palette.outline);
  raster.hline(x + Math.floor(size * 0.3), y + Math.floor(size * 0.8), Math.floor(size * 0.4), palette.outline);
}

function drawButton(raster, index, size, color, detailed) {
  const { x, y } = tileOrigin(index, size);
  const inset = detailed ? 8 : 4;
  raster.fill(x + inset, y + inset, size - inset * 2, size - inset * 2, palette.outline);
  raster.fill(x + inset + 1, y + inset + 1, size - inset * 2 - 2, size - inset * 2 - 2, color);
  if (detailed) raster.point(x + inset + 3, y + inset + 3, palette.amberLight);
}

function drawCurtain(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.hline(x + 1, y + 1, size - 2, palette.outline);
  for (let px = 2; px < size - 2; px += 1) {
    const color = px % (detailed ? 5 : 4) < 2 ? palette.curtainDark : palette.curtain;
    raster.vline(x + px, y + 2, size - 3, color);
  }
}

function drawBed(raster, index, size, top, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + 3, y, size - 6, size, palette.outline);
  raster.fill(x + 4, y + 1, size - 8, size - 2, top ? palette.cream : palette.sage);
  if (top) raster.fill(x + 5, y + 2, size - 10, Math.floor(size * 0.35), palette.white);
  else if (detailed) raster.hline(x + 6, y + Math.floor(size * 0.6), size - 12, palette.sageLight);
}

function drawDevice(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  const inset = detailed ? 5 : 3;
  raster.fill(x + inset, y + 2, size - inset * 2, size - 5, palette.deviceDark);
  raster.fill(x + inset + 1, y + 3, size - inset * 2 - 2, size - 7, palette.device);
  raster.fill(x + inset + 3, y + 5, size - inset * 2 - 6, Math.max(2, Math.floor(size * 0.18)), palette.deep);
  if (detailed) {
    raster.point(x + size - inset - 4, y + 6, palette.amber);
    raster.hline(x + inset + 3, y + size - 7, size - inset * 2 - 6, palette.cream);
  }
}

function drawDrawer(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + 2, y + 1, size - 4, size - 3, palette.woodDark);
  raster.fill(x + 3, y + 2, size - 6, size - 5, palette.wood);
  const rows = detailed ? 3 : 2;
  const rowHeight = Math.floor((size - 6) / rows);
  for (let row = 1; row < rows; row += 1) raster.hline(x + 4, y + 3 + row * rowHeight, size - 8, palette.woodDark);
  for (let row = 0; row < rows; row += 1) raster.point(x + Math.floor(size / 2), y + 4 + row * rowHeight, palette.amberLight);
}

function drawMarker(raster, index, size, color, detailed) {
  const { x, y } = tileOrigin(index, size);
  const inset = detailed ? 5 : 3;
  const top = Math.floor(size * 0.45);
  raster.fill(x + inset, y + top, size - inset * 2, Math.max(3, Math.floor(size * 0.22)), color);
  if (detailed) {
    raster.point(x + inset + 2, y + top + 2, palette.cream);
    raster.point(x + size - inset - 3, y + top + 2, palette.cream);
  }
}

function drawWindow(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + 2, y + 3, size - 4, size - 6, palette.outline);
  raster.fill(x + 3, y + 4, size - 6, size - 8, palette.lake);
  raster.vline(x + Math.floor(size / 2), y + 4, size - 8, palette.cream);
  if (detailed) raster.hline(x + 4, y + Math.floor(size / 2), size - 8, palette.cream);
}

function drawPlant(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + Math.floor(size * 0.38), y + Math.floor(size * 0.62), Math.floor(size * 0.24), Math.floor(size * 0.25), palette.wood);
  for (const [rx, ry] of [[0.5, 0.22], [0.35, 0.36], [0.65, 0.36], [0.5, 0.44]]) {
    const radius = detailed ? 3 : 2;
    raster.fill(x + Math.floor(size * rx) - radius, y + Math.floor(size * ry) - radius, radius * 2 + 1, radius * 2 + 1, palette.sage);
  }
  if (detailed) raster.point(x + Math.floor(size * 0.5), y + Math.floor(size * 0.18), palette.sageLight);
}

function drawRug(raster, index, size, detailed) {
  const { x, y } = tileOrigin(index, size);
  raster.fill(x + 2, y + 3, size - 4, size - 6, palette.sage);
  raster.hline(x + 3, y + 4, size - 6, palette.amber);
  raster.hline(x + 3, y + size - 5, size - 6, palette.amber);
  if (detailed) for (let px = 6; px < size - 6; px += 6) raster.point(x + px, y + Math.floor(size / 2), palette.cream);
}

function buildTileset(size) {
  const raster = new Raster(size * 8, size * 4);
  const detailed = size === 32;
  drawFloor(raster, 0, size, palette.sageLight, palette.sage, detailed);
  drawFloor(raster, 1, size, palette.sage, palette.sageLight, detailed);
  drawLockedFog(raster, 2, size, detailed);
  drawWallHorizontal(raster, 3, size, detailed);
  drawWallVertical(raster, 4, size, detailed);
  drawCorner(raster, 5, size, false);
  drawCorner(raster, 6, size, true);
  drawDoor(raster, 7, size, detailed);
  drawDesk(raster, 8, size, detailed);
  drawChair(raster, 9, size, palette.sage, detailed);
  drawChair(raster, 10, size, palette.coral, detailed);
  drawComputer(raster, 11, size, detailed);
  drawButton(raster, 12, size, palette.amber, detailed);
  drawCurtain(raster, 13, size, detailed);
  drawBed(raster, 14, size, true, detailed);
  drawBed(raster, 15, size, false, detailed);
  drawDevice(raster, 16, size, detailed);
  drawDrawer(raster, 17, size, detailed);
  drawMarker(raster, 18, size, palette.amber, detailed);
  drawMarker(raster, 19, size, palette.coral, detailed);
  drawMarker(raster, 20, size, palette.lake, detailed);
  drawLockedFog(raster, 21, size, detailed);
  drawWindow(raster, 22, size, detailed);
  drawPlant(raster, 23, size, detailed);
  drawFloor(raster, 24, size, palette.cream, palette.creamShadow, detailed);
  drawFloor(raster, 25, size, palette.creamShadow, palette.sage, detailed);
  drawLockedFog(raster, 26, size, detailed);
  drawRug(raster, 27, size, detailed);
  drawDrawer(raster, 28, size, detailed);
  drawDevice(raster, 29, size, detailed);
  drawCurtain(raster, 30, size, detailed);
  drawDoor(raster, 31, size, detailed);
  return raster;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(raster) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(raster.width, 0);
  ihdr.writeUInt32BE(raster.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc((raster.width * 4 + 1) * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    const target = y * (raster.width * 4 + 1);
    scanlines[target] = 0;
    Buffer.from(raster.pixels.buffer, y * raster.width * 4, raster.width * 4).copy(scanlines, target + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

await mkdir(outputDirectory, { recursive: true });
const tilesets = new Map([
  [16, buildTileset(16)],
  [32, buildTileset(32)],
]);
const nativeDifferenceRatio = compareAgainstNearestNeighbor(
  tilesets.get(16),
  tilesets.get(32),
);
if (nativeDifferenceRatio < 0.05) {
  throw new Error("The 32px H3 tileset is too close to a nearest-neighbor 16px enlargement");
}
for (const [size, raster] of tilesets) {
  await writeFile(
    resolve(outputDirectory, `clinic-community-h3-${size}.png`),
    encodePng(raster),
  );
}

console.log(
  `Generated native H3 tileset PNGs at 16px and 32px (${(
    nativeDifferenceRatio * 100
  ).toFixed(1)}% pixels differ from nearest-neighbor scaling).`,
);

function compareAgainstNearestNeighbor(lowDensity, highDensity) {
  if (
    !lowDensity ||
    !highDensity ||
    highDensity.width !== lowDensity.width * 2 ||
    highDensity.height !== lowDensity.height * 2
  ) {
    throw new Error("H3 tilesets must use a strict 2:1 pixel-density relationship");
  }
  let differentPixels = 0;
  const totalPixels = highDensity.width * highDensity.height;
  for (let y = 0; y < highDensity.height; y += 1) {
    for (let x = 0; x < highDensity.width; x += 1) {
      const lowOffset = (Math.floor(y / 2) * lowDensity.width + Math.floor(x / 2)) * 4;
      const highOffset = (y * highDensity.width + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 4; channel += 1) {
        differs ||= lowDensity.pixels[lowOffset + channel] !== highDensity.pixels[highOffset + channel];
      }
      if (differs) differentPixels += 1;
    }
  }
  return differentPixels / totalPixels;
}
