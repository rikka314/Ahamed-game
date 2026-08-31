---
name: produce-s1-game-assets
description: Produce, convert, integrate, and validate the AhaMed S1 first-batch clinic map, pixel characters and props, React DOM UI, SFX, and BGM. Use when the user names an S1 assetId, asks to make first-batch game content, or asks to continue the next unfinished S1 asset; do not use for medical cases or model-layer content.
metadata:
  short-description: Produce and validate AhaMed S1 game assets
---

# Produce AhaMed S1 Game Assets

Turn a short request such as “继续做第一批素材” or “做医生 sprite” into a scoped, traceable production pass without making the user reopen the task card.

## Bootstrap and authority

1. Invoke `$load-game-context` before project work.
2. Treat `docx/plan/game/S1-第一批素材任务卡.md` as the upstream source of truth. Ordinary production should use this skill's references; reopen the task card only when refreshing this skill, resolving a conflict, or checking whether H3/status changed.
3. The project owner supplies or approves formal art and audio. AI may specify, generate drafts, convert, integrate, and validate; it must not mark its own output `APPROVED`, `IN_GAME`, or `ACCEPTED`.
4. H2 direction A is approved, but H3 technical specifications are not frozen. Until a newer project record freezes H3, create comparison candidates or integration-safe DRAFTs only. Do not silently freeze tile size, frame size, padding, FPS, audio budget, or `contentBuildId`.

## Resolve the production lane

Load only the reference for the requested asset:

| Lane | Asset IDs | Read |
|---|---|---|
| World and props | `map.clinic.graybox-01`, `tileset.clinic.community-01`, `device.local.bp-01`, `device.local.thermometer-01`, `interaction.drawer.thermometer-01`, `unlock.clinic.starter-set-01` | [references/world-and-props.md](references/world-and-props.md) |
| Characters | `sprite.doctor.player-01`, `sprite.patient.starter-set-01` | [references/characters.md](references/characters.md) |
| UI | `ui.clinic.core-01` | [references/ui.md](references/ui.md) |
| Audio | `audio.clinic.core-sfx-01`, `audio.clinic.bgm-day-01` | [references/audio.md](references/audio.md) |

Always read [references/production-contract.md](references/production-contract.md) for status, provenance, paths, naming, integration, and approval rules.

If the user says only “继续” or “下一项”:

1. Inspect source assets, runtime assets, manifest entries, tests, and any review evidence.
2. Continue a partially completed asset before opening another one.
3. If none is in progress, choose the earliest prerequisite-safe item: H3 comparison package → map/tileset → doctor → patients → devices → unlock props → UI → SFX → BGM.
4. State the chosen assetId in the first progress update. Do not make the user select a lane unless two choices would materially change cost, rights, or the final visual contract.

## Production responsibilities

Choose the smallest tool chain that can deliver the requested slice:

- Direction/specification: this skill plus project references; use image generation only when a visual candidate is actually needed.
- Concept candidates: PixelLab when authenticated and appropriate for pixel art; otherwise built-in `imagegen`. Canva is suitable for moodboards or comparison sheets, not the authoritative runtime source.
- Pixel cleanup and spritesheets: Aseprite MCP when a licensed `Aseprite.exe` is available. LibreSprite may be used manually for simple edits, but do not assume full Aseprite CLI/MCP compatibility.
- Map assembly: Tiled 1.12.2 and the repository's map publication/validation path.
- UI: `$frontend-design`, `$accessibility`, and `$browser-qa`; keep medical and management text in React DOM.
- Audio: owner-supplied or clearly licensed source, optional fal.ai generation when authenticated and commercially usable, then Audacity MCP for editing, normalization, fades, and format preparation.
- Integration and verification: repository scripts/tests plus browser inspection. Generated previews are not evidence of in-game acceptance.

## Per-request workflow

1. Name the target assetId, requested deliverable, current status, and unresolved H3 fields.
2. Inspect existing files first and reuse valid work. Never replace user-created source art or audio merely to make a new candidate.
3. If H3 blocks a final artifact, produce the narrow decision package needed to freeze it; label every output DRAFT.
4. Generate or edit one reviewable slice unless the user explicitly requests a batch. Avoid paid/API generation loops without a concrete comparison purpose.
5. Save editable sources separately from runtime outputs and record provenance before integration.
6. Validate the lane-specific acceptance criteria, then run the narrowest relevant repository check.
7. Report created files, tool/model/source provenance, validations, unresolved H3 decisions, and the exact approval state. Never infer approval from a successful build or screenshot.

## Safety and scope

- Do not place diagnoses, hidden case facts, scoring rules, model prompts, API keys, real patient information, or real-patient recordings in game assets or `public/`.
- Do not upload private reference material to an external generator without explicit authorization.
- Reject unknown-rights assets, NC terms, no-derivatives terms, brand replicas, watermarks, and sources whose commercial modification rights cannot be evidenced.
- Preserve the game/model/share ownership boundary. This skill produces game presentation assets; it does not define medical truth or public `testId` contracts.
