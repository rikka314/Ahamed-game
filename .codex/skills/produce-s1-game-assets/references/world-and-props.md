# World and Props Lane

Use this lane for the clinic map/tileset, examination devices, and starter unlock props.

## Tool ownership

- PixelLab or built-in image generation: orthographic direction candidates only.
- Aseprite or LibreSprite: pixel cleanup, tilesheet/state-sheet authoring, palette discipline.
- Tiled 1.12.2: map layers, collision, object anchors, properties, and source `.tmj`.
- Repository scripts/tests: flattened runtime JSON, manifest integration, Phaser loading and collision verification.

## Clinic map and tileset

Asset IDs: `map.clinic.graybox-01`, `tileset.clinic.community-01`.

Required experience: a compact, credible, warm community clinic whose critical route is immediately readable.

Preserve:

- orthographic top-down view;
- left queue/entrance, central consultation, right curtained blood-pressure area, thermometer drawer near the doctor, and upper/lower locked zones;
- the exact five Tiled layers: `Ground`, `Decoration`, `Collision`, `AbovePlayer`, `Objects`;
- stable object IDs for computer, call/queue, seats, examination, drawer, NPC and transfer anchors;
- one continuous tileset PNG, never a Collection of Images tileset;
- walls, furniture, curtain, bed and devices represented in collision or object contracts as appropriate.

May vary: furniture detail, wall/floor material, number of windows/decorations, and locked-area silhouette.

Forbidden: isometric perspective, mixed pixel densities, baked Chinese, logos/brands, diagnosis clues, compressed tile data, unvalidated external tileset sources.

H3 candidates: 16×16 or 32×32 tiles; never mix them in one build. Current graybox is 416×256 at 16px. Furniture uses Tiled top-left coordinates. Validate both mobile and desktop composition before freezing.

Editable/runtime deliverables:

- source `.tmj` plus source `.tsx/.tsj` or embedded tileset and editable PNG/Aseprite source;
- runtime uncompressed `.tmj` JSON with Phaser-compatible embedded/flattened tileset plus one PNG;
- manifest/provenance entries.

Prompt seed for a direction candidate:

```text
Orthographic top-down pixel-art tileset and compact floor plan for a warm morning community clinic. Clear left entrance and patient queue, central doctor consultation desk, right curtained blood-pressure examination area, nearby clinical drawer, and readable upper/lower locked zones. Seamless grid-aligned tiles, hard pixel edges, consistent scale, no people, no text, no logo, no watermark, no isometric perspective, no diagnosis information.
```

Acceptance: layout function survives reskinning; mobile/desktop framing works; props are identifiable; locked areas read without leaking hidden content; layers/objects/collision load in Phaser.

## Blood-pressure device and thermometer drawer

Asset IDs: `device.local.bp-01`, `device.local.thermometer-01`, `interaction.drawer.thermometer-01`.

Preserve:

- an unbranded blood-pressure device fixed in the right examination zone;
- a thermometer stored in the consultation-desk drawer or adjacent cabinet;
- distinct stable `deviceId` and public `testId` responsibilities;
- blood-pressure states: `available`, `pending`, `completed`, `unavailable`, `error`;
- thermometer sequence: `closed`, `doctor-retrieving`, `doctor-giving`, `patient-measuring`, `patient-returning`, `doctor-storing`, `returned`;
- separate drawer, doctor handoff, patient handoff/exam, and device anchors;
- world input paused during the automatic sequence and restored after completion/failure;
- explicit recovery that never duplicates the thermometer or submits the test twice.

The player chooses the examination; this is not a timing, dragging, rhythm, or movement minigame. Do not draw normal/abnormal answers, brands, or exaggerated alarm lights on the device.

H3 candidates: blood-pressure device footprint 2×2 to 3×3 tiles; drawer/cabinet 1×1 to 2×2; thermometer may use a clear silhouette or close-up DOM presentation. Use a few readable state frames, not a fake live waveform.

Prompt seeds: `generic unbranded blood pressure monitor, orthographic top-down pixel art`; `digital clinical thermometer, orthographic top-down pixel art`; `small clinic drawer cabinet, orthographic top-down pixel art`. Add `no text, no logo, no result display, no watermark`.

Acceptance: right-side device location and the retrieve → give → measure → return → store causal chain are readable; no extra player input is required; recovery is idempotent; no diagnosis leakage.

## Starter unlock props

Asset ID: `unlock.clinic.starter-set-01`.

Deliver:

- a potted plant with three visibly different upgrade levels;
- a waiting chair/seat set with three visibly different upgrade levels;
- clinic level-2 presentation where requested by the UI/world integration;
- states `locked`, `available`, `purchased`, `unlocked` with stable transaction and asset IDs.

The design must communicate that coins improve the space while reputation unlocks capability. Each visible level must correlate with the versioned 25% reputation-bonus transaction flow, but the asset itself must not decide economy rules.

Allowed: price/name details and restrained visual changes. MVP max level remains 3. Forbidden: loot-box framing, countdown pressure, real-money suggestion, or any implication that medical competence is purchased.

H3 candidates: 1×1 to 2×2 tiles; static or a restrained two-frame feedback. Placement before/after purchase must preserve the critical movement path.

Prompt seeds: `small community clinic potted plant upgrade levels, top-down pixel art`; `community clinic waiting chair upgrade levels, top-down pixel art`. Add `three restrained tiers, same footprint and perspective, no text, no logo, no luxury exaggeration`.

Acceptance: coin/reputation concepts remain distinct in UI context; lock reason is readable; three levels are distinguishable but not extravagant; world placement does not block routes.
