import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "assets/source/maps/clinic-graybox.tmj");
const outputPath = resolve(
  projectRoot,
  "public/game-assets/dev/maps/clinic-graybox.tmj",
);
const manifestPath = resolve(projectRoot, "public/game-assets/dev/manifest.json");

const source = await readFile(sourcePath, "utf8");
const map = JSON.parse(source);

if (map?.type !== "map" || !Array.isArray(map.layers)) {
  throw new Error("clinic-graybox.tmj is not a valid Tiled map document");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      contentBuildId: "dev",
      generatedAt: null,
      assets: [
        {
          assetId: "map.clinic.graybox-01",
          kind: "tiled-map",
          path: "/game-assets/dev/maps/clinic-graybox.tmj",
          status: "placeholder",
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
