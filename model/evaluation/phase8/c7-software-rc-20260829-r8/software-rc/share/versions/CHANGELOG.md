# Changelog

## v1-rc1 dialogue C5 in-place upgrade — 2026-08-28

- 为 `TurnCompletedV1` 新增必填 `effects`，支持 `test_completed` 与 `test_unavailable` 两类同回合检查副作用。
- `test_completed.result.status` 固定为 `completed`，拒绝与 effect 类型矛盾的 unavailable 结果。
- 同步 TypeScript DTO、JSON Schema、Schema manifest、正反 fixture、事件 fixture、模型侧 adapter 和契约测试。
- 历史存储记录缺少 `effects` 时由模型 SQLite v6 迁移/读取层归一化为空数组；旧 validated operation buffer 与历史幂等响应继续兼容恢复。

兼容性：按已确认的对话重构版本策略继续使用公共 `1` / `v1-rc1` 标签，但这是一次不兼容原地升级。旧 RC producer/consumer 和发布证据均视为 `superseded`；模型与游戏 adapter 必须重新构建并通过当前契约门，C7 完成前不得恢复 Software RC 资格。

## v1-rc1 — 2026-08-26

- 建立独立 `@ahamed/doctor-game-share` TypeScript package，不依赖 `game`、`model` 或第三方运行时库。
- 发布 ID、病例公共投影、会话、问诊、检查、诊断、评分、错误与事件的 v1 公共类型。
- 冻结会话阶段、安全决策、错误码、事件类型、`scoring-policy-v1`、0–100 分数范围、权重和整数 half-up 舍入声明。
- 冻结 allowlist 客户端投影；完整病例、未披露事实、答案、rubric、Prompt 与模型推理不属于本契约。
- 固定 `canonical-json-v1+sha256` 幂等 fingerprint material 和相同 key/不同 payload 的冲突语义。
- 发布语言中立 JSON Schema、每项公共 DTO/event 的正反 fixture，以及 serialization、schema、hidden-field 与 contract tests。
- 模型 package 已通过本地单向依赖消费共享类型与 Schema 测试工具；application DTO 映射按计划留到 Phase 3。

兼容性：这是第一个 release candidate，无可迁移的早期公共版本。RC 期间允许基于双方集成反馈调整；任何删除字段、改变含义、枚举或单位的变更都必须记录并重新发布 RC。
