# Draft cases

仅存放符合 `case-package-v1-rc1` 的病例草稿。草稿必须使用 `packageStatus: "draft"` 和 `review.status: "pending"`。它们可以被显式的离线开发、单元测试、deterministic/mock 回归和 Phase 7 E7-01–E7-06 harness 加载，但不得被玩家可访问运行时、完整候选 benchmark、live release gate、Software RC 或任何对外发布病例仓库加载。

`c01-reference-draft.json` 是 Phase 3 deterministic CLI 的受控工程纵切数据。CLI 仅在内部开发环境显式加载它；它本身不是 published 病例，也不得作为 Phase 4–8 的发布证据。

C01–C05 的 draft 文件保留为冻结内容源；与其 `caseVersion + contentHash` 精确绑定的双 AI 验证记录位于 `../ai-validation/`，对应 published 物化文件位于 `../published/`。任何直接加载 draft 的 harness 报告仍必须保留病例状态与内容 hash，并明确标记 `development-only`。
