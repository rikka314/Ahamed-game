# Changelog

## v1-rc1 — 2026-08-26

- 建立独立 `@ahamed/doctor-game-share` TypeScript package，不依赖 `game`、`model` 或第三方运行时库。
- 发布 ID、病例公共投影、会话、问诊、检查、诊断、评分、错误与事件的 v1 公共类型。
- 冻结会话阶段、安全决策、错误码、事件类型、`scoring-policy-v1`、0–100 分数范围、权重和整数 half-up 舍入声明。
- 冻结 allowlist 客户端投影；完整病例、未披露事实、答案、rubric、Prompt 与模型推理不属于本契约。
- 固定 `canonical-json-v1+sha256` 幂等 fingerprint material 和相同 key/不同 payload 的冲突语义。
- 发布语言中立 JSON Schema、每项公共 DTO/event 的正反 fixture，以及 serialization、schema、hidden-field 与 contract tests。
- 模型 package 已通过本地单向依赖消费共享类型与 Schema 测试工具；application DTO 映射按计划留到 Phase 3。

兼容性：这是第一个 release candidate，无可迁移的早期公共版本。RC 期间允许基于双方集成反馈调整；任何删除字段、改变含义、枚举或单位的变更都必须记录并重新发布 RC。
