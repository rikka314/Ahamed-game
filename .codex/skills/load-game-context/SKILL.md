---
name: load-game-context
description: Load compact AhaMed Doctor Game context before any task under this project. Read AI_CONTEXT.md and docx/baseknowledge/压缩上下文.md first, then read only the full baseknowledge documents relevant to the task. Use only for D:\Learn\20_Projects\MedicalAI\apps\game and its descendants.
metadata:
  short-description: Load compact AhaMed game context
---

# Load AhaMed Doctor Game Context

Use this skill as the mandatory context bootstrap for every task whose working directory or target files are inside `D:\Learn\20_Projects\MedicalAI\apps\game`.

The skill loads context only. It does not authorize edits, dependency installation, network calls, migrations, or other side effects beyond the user's current request.

## Mandatory compact load sequence

Before substantive task work:

1. Resolve the active project root as `D:\Learn\20_Projects\MedicalAI\apps\game`.
2. Read `AI_CONTEXT.md` completely.
3. Read `docx/baseknowledge/压缩上下文.md` completely.
4. Classify the task as game layer, model layer, shared layer, or cross-layer work.
5. Read only the task-relevant full documents selected by the routing table below.
6. Begin task-specific inspection, planning, editing, or commands after the required context is loaded.

`AI_CONTEXT.md` always remains first. The compact summary is the default knowledge index; it is not a reason to read every long document.

## Full-document routing

Read `docx/baseknowledge/技术栈.md` completely for work involving:

- `game/`, Phaser, React game UI, scenes, movement, collision, Tiled maps, NPC presentation;
- art, audio, responsive rendering, IndexedDB saves, simulation management, rewards;
- game-layer dependencies, runtime behavior, testing, performance, packaging, or release.

Read `docx/baseknowledge/开源资源与技术方案.md` completely for work involving:

- `model/`, cases, case production, prompts, providers, LLM orchestration;
- Controller, Patient, Test/Measurement, Evaluator, diagnosis, scoring, model evaluation;
- medical/model safety, open-source model references, case data, terminology, or licensing.

Read `docx/baseknowledge/共享层基本内容.md` completely for work involving:

- `share/`, DTOs, JSON Schema, APIs, events, stable IDs, session state, errors, idempotency;
- fixtures, mocks, contract tests, client projections, versions, compatibility, recovery;
- any integration between `game/` and `model/`, or any MVP merge decision.

For cross-layer work, read the shared document first and then each affected layer document. Read all three long documents only for a full architecture review, three-layer repartition, whole-project consistency/security audit, an explicit user request for full review, or a real conflict that the compact summary cannot resolve.

When editing a long baseknowledge document, read that document completely first. If the edit changes a cross-layer contract or ownership boundary, also read the shared document completely.

Do not read unrelated long documents for an ordinary scoped task.

## Knowledge inventory

The compact summary indexes the current long documents:

1. `技术栈.md` — game layer;
2. `开源资源与技术方案.md` — model layer;
3. `共享层基本内容.md` — shared layer;
4. `压缩上下文.md` — mandatory compact index, not a long-document route target.

If files are added under `docx/baseknowledge/`, enumerate names with `rg --files` without reading every file. Use the new file's name and short introduction to decide whether it is relevant. If its scope is not indexed, update `压缩上下文.md` as part of documentation maintenance.

## Efficient loading

- Load the two mandatory compact sources once per logical turn.
- Once routing selects a long document, read that selected document completely rather than relying on isolated headings or search snippets.
- Do not scan `.next/`, `node_modules/`, generated assets, or the rest of the repository as part of this bootstrap.
- Do not repeat context loading within the same logical turn unless a loaded context file changes or the user explicitly requests a refresh.
- Keep the user update concise; there is no need to reproduce the documents after reading them.

## Unsupported or missing content

- If `AI_CONTEXT.md` or `压缩上下文.md` is missing, report the exact path and do not invent the missing project state.
- If a selected long document cannot be read, report its exact path and continue only when the task remains safe with partial context.
- If a relevant route target is binary or tool-specific, use the appropriate read-only document tool when available; otherwise report that it could not be interpreted.

## Context interpretation

After loading, preserve these ownership boundaries unless a newer project document explicitly changes them:

- `game/` owns the playable 2D world, simulation management, presentation, input, local save, art, and audio.
- `model/` owns cases, controlled patient simulation, medical tests, diagnosis evaluation, model safety, and model observability.
- `share/` owns versioned contracts, schemas, stable IDs, events, fixtures, mocks, compatibility, and integration gates.

When documents conflict, distinguish current implemented state from target design. Prefer the newest explicit durable decision, flag unresolved contradictions, and never silently treat a proposal as completed implementation.

## Refresh rule

If the task modifies `AI_CONTEXT.md` or `压缩上下文.md`, reread both mandatory compact sources before finalizing. If it modifies a routed long document, reread that changed document and update the compact summary when its high-frequency decisions or routing meaning changed.
