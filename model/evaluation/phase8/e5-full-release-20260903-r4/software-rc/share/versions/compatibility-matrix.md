# v1-rc2 compatibility matrix

| Consumer / producer | Declared range | Current status | Required gate |
|---|---|---|---|
| `@ahamed/doctor-game-share` | `1.0.0-rc.2` | implemented | package typecheck + all share tests |
| `model/` | contract `1` / `v1-rc2` | adapter emits required `patientRoleId` and `TurnCompletedV1.effects` | keep `model → share` dependency and pass current `test:contract` |
| `game/` | contract `1` / `v1-rc2` identity slice | patient identity adapter and 30-role catalog implemented; full medical gameplay adapter remains pending | pass `game` typecheck, patient identity contract test, and current share contract tests |
| Future non-TypeScript client | JSON Schema draft 2020-12 subset | supported representation | must validate the same fixture manifest without adding private fields |

Compatibility rules:

- Adding an optional field may be backward compatible after fixture and consumer review.
- Removing a field, changing meaning/unit, tightening an accepted value, or changing an enum is breaking.
- Events are deduplicated by `eventId` and ordered per session by `sequence`; unknown event types must not mutate authoritative state.
- `contractVersion`, `schemaVersion`, and `eventVersion` are independent of case, prompt, model, evaluation, content-build, save-schema, and reward-rule versions.
- In-progress sessions remain pinned to the versions selected at creation.
- Approved C5 exception: required `TurnCompletedV1.effects` keeps the `1` / `v1-rc1` label but is breaking in place. Historical database records are migrated to `effects: []`; wire producers and consumers are not auto-compatible. All pre-C5 RC artifacts and evidence are superseded pending C7 revalidation.
- E4 publishes `v1-rc2` / package `1.0.0-rc.2` instead of mutating the `v1-rc1` release record again. `CaseSummaryV1.patientRoleId` is required in rc2. Strict rc1 consumers are not wire-compatible with rc2 and must upgrade deliberately; the shared major discriminator remains `contractVersion: "1"` during the release-candidate period.
- `patientRoleId` is an opaque public identity/appearance key. It cannot encode diagnosis, Persona template, behavior instructions, rubric, or hidden case facts. `npcId` remains a reusable game-owned actor slot and `sessionId` remains the medical-session binding.

The RC is not declared frozen v1 until the complete model and game adapters pass the shared contract gate. E4 covers identity binding only; it does not claim the full game medical loop is complete.
