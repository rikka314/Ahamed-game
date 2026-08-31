# S1 Production Contract

Read this reference for every S1 asset production request.

## Current approval register

| Asset ID | Initial status | Static approval | In-game approval | Build |
|---|---|---|---|---|
| `map.clinic.graybox-01` | DRAFT placeholder, technically loaded | direction approved; H3 pending | pending | `dev` |
| `tileset.clinic.community-01` | DRAFT | direction approved; H3 pending | pending | TBD |
| `sprite.doctor.player-01` | DRAFT | direction approved; H3 pending | pending | TBD |
| `sprite.patient.starter-set-01` | DRAFT | concrete characters/H3 pending | pending | TBD |
| `device.local.bp-01`, `device.local.thermometer-01` | DRAFT | direction approved; H3 pending | pending | TBD |
| `unlock.clinic.starter-set-01` | DRAFT | gameplay/direction approved; H3 pending | pending | TBD |
| `ui.clinic.core-01` | REVIEW DOM placeholder | direction approved; H3 pending | pending | `dev` |
| `audio.clinic.core-sfx-01` | DRAFT | direction approved; H3 pending | pending | TBD |
| `audio.clinic.bgm-day-01` | DRAFT | direction and one-track scope approved; H3 pending | pending | TBD |

A technically loaded placeholder remains a placeholder. A passing build does not change approval.

## H3 gate

Before producing a final runtime set, find a newer approved record that freezes the relevant fields. If none exists, expose the unresolved fields and produce DRAFT candidates only.

- World: 16px versus 32px tile, logical resolution, tileset padding/extrusion, map bounds, final palette.
- Characters: 16×24 versus 32×48 frame, grid, direction order, animation reuse, offsets, frame count, FPS.
- Devices/unlocks: final tile footprint, state-frame layout, interaction anchors.
- UI: final token values, typography, responsive breakpoints, touch target and safe-area results on devices.
- Audio: final sample/bit depth, loudness targets, codec set, per-file and total budgets, loop/fade rules.
- All lanes: immutable non-`dev` `contentBuildId` and manifest schema/version.

When asked to help freeze H3, create a comparison package with the smallest number of alternatives that tests mobile readability, desktop composition, runtime memory, and production cost. Do not choose based only on a zoomed editor preview.

## Source/runtime separation

Use existing project conventions and create a subdirectory only when it contains a real artifact:

```text
game/assets/source/
  maps/        editable Tiled sources
  tilesets/    editable or lossless source tiles
  sprites/     Aseprite/LibreSprite sources and metadata
  ui/          editable SVG or design source when needed
  audio/       project files, stems, and WAV masters

game/public/game-assets/<contentBuildId>/
  maps/        flattened, uncompressed Tiled JSON
  tilesets/    runtime PNG
  sprites/     runtime PNG plus metadata
  audio/       browser codecs
  manifest.json
```

Do not publish editor binaries, licensed reference packs, raw private references, DAW caches, or unnecessary working files. Build-ID paths are immutable once formally released. Keep DRAFT work under `dev` or a clearly draft build until approval.

## Naming and manifest

- Preserve the exact stable assetIds in this document.
- Use kebab-case filenames and deterministic state names.
- Do not use Tiled GIDs, array indexes, Phaser object IDs, or filesystem order as durable IDs.
- Merge manifest entries; do not overwrite unrelated entries.
- Each runtime entry should retain at least `assetId`, `kind`, `path`, `status`, and the enclosing `contentBuildId` convention already used by the repository.
- Keep map JSON uncompressed. Source may use an external `.tsx/.tsj`, but the Phaser runtime copy must be validated and flattened/embedded when the parser requires it.

## Provenance and rights

Priority: project-original or user-owned → CC0 → individually recorded CC BY. Reject unknown rights, NC, ND/no-modification, or material that cannot retain license evidence.

For every external or AI-assisted source, use the repository's existing ledger if one exists. Otherwise place an adjacent `<asset-name>.provenance.json` with fields equivalent to:

```json
{
  "assetId": "sprite.doctor.player-01",
  "sourceType": "original | user-owned | cc0 | cc-by | ai-assisted",
  "author": null,
  "sourceUrl": null,
  "license": null,
  "downloadedAt": null,
  "commercialUse": true,
  "modificationAllowed": true,
  "redistributionNotes": null,
  "attributionText": null,
  "generator": null,
  "modelVersion": null,
  "generatedAt": null,
  "prompt": null,
  "humanEdits": [],
  "status": "DRAFT"
}
```

Do not claim AI output is automatically copyright-safe. Record the provider/model/version and terms applicable on the generation date, and avoid imitation of living artists or recognizable brands.

## Shared visual and safety invariants

- Orthographic top-down pixel world; one frozen pixel density per build.
- sRGB, hard pixel edges, alpha where required, no accidental anti-aliasing.
- No baked Chinese long text, logos, watermarks, diagnosis-revealing props, hidden medical facts, or branded medical-device replicas.
- Public patient appearances must be respectful and cannot disclose illness or diagnosis.
- UI state is not expressed by color alone; long medical text remains semantic DOM.
- Audio contains no real patient voice/name, protected music fragment, brand sound, or startling alarm.

## Completion report

End each production pass with:

- assetId and current status;
- editable source and runtime files created or changed;
- provenance/licensing record;
- tool/model/version and prompts when generation was used;
- targeted verification performed and its result;
- unresolved H3 fields;
- static approval and in-game approval still required.
