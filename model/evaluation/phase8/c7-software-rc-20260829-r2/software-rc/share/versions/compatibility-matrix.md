# v1-rc1 compatibility matrix

| Consumer / producer | Declared range | Current status | Required gate |
|---|---|---|---|
| `@ahamed/doctor-game-share` | `1.0.0-rc.1` | implemented | package typecheck + all share tests |
| `model/` | contract `1` / `v1-rc1` C5 shape | adapter passing, including `TurnCompletedV1.effects` | keep `model → share` dependency and pass current `test:contract` |
| `game/` | contract `1` / `v1-rc1` pre-C5 shape | adapter pending and incompatible with required `effects` | consume allowlist projections and required turn effects, then pass current `test:contract` before model integration |
| Future non-TypeScript client | JSON Schema draft 2020-12 subset | supported representation | must validate the same fixture manifest without adding private fields |

Compatibility rules:

- Adding an optional field may be backward compatible after fixture and consumer review.
- Removing a field, changing meaning/unit, tightening an accepted value, or changing an enum is breaking.
- Events are deduplicated by `eventId` and ordered per session by `sequence`; unknown event types must not mutate authoritative state.
- `contractVersion`, `schemaVersion`, and `eventVersion` are independent of case, prompt, model, evaluation, content-build, save-schema, and reward-rule versions.
- In-progress sessions remain pinned to the versions selected at creation.
- Approved C5 exception: required `TurnCompletedV1.effects` keeps the `1` / `v1-rc1` label but is breaking in place. Historical database records are migrated to `effects: []`; wire producers and consumers are not auto-compatible. All pre-C5 RC artifacts and evidence are superseded pending C7 revalidation.

The RC is not declared frozen v1 until both `model/` and `game/` adapters pass the shared contract gate.
