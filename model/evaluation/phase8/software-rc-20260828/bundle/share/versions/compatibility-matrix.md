# v1-rc1 compatibility matrix

| Consumer / producer | Declared range | Current status | Required gate |
|---|---|---|---|
| `@ahamed/doctor-game-share` | `1.0.0-rc.1` | implemented | package typecheck + all share tests |
| `model/` | contract `1` / `v1-rc1` | Phase 1 package/schema gate passing; application adapter deferred | keep `model → share` dependency and pass `test:contract`; finish DTO mapping in Phase 3 |
| `game/` | contract `1` / `v1-rc1` | adapter pending | must consume allowlist projections and pass `test:contract` before model integration |
| Future non-TypeScript client | JSON Schema draft 2020-12 subset | supported representation | must validate the same fixture manifest without adding private fields |

Compatibility rules:

- Adding an optional field may be backward compatible after fixture and consumer review.
- Removing a field, changing meaning/unit, tightening an accepted value, or changing an enum is breaking.
- Events are deduplicated by `eventId` and ordered per session by `sequence`; unknown event types must not mutate authoritative state.
- `contractVersion`, `schemaVersion`, and `eventVersion` are independent of case, prompt, model, evaluation, content-build, save-schema, and reward-rule versions.
- In-progress sessions remain pinned to the versions selected at creation.

The RC is not declared frozen v1 until both `model/` and `game/` adapters pass the shared contract gate.
