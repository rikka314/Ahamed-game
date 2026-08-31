# Phase 8 历史证据状态

本目录中在“模型层对话架构重构计划”建立前生成的全部 Phase 8 候选、发布评测、测试证据、清单、本机 smoke、验收报告、bundle 与压缩包，现统一标记为 **superseded**。

这些文件只读保留，用于追溯旧 Controller → Patient 双阶段架构；它们不再证明当前 `v1-rc1` 原地升级候选已经通过验收，也不得与后续新 RC 证据混用。

版本字符串继续保留 `1` 与 `v1-rc1`，兼容策略为不兼容原地升级。当前在线硬指标是 Controller 路由调用占比为 0。重新取得 Software RC 资格必须完整重做病例双 AI 验证、对话/安全评测、持久化验证、runtime-release manifest、文件哈希、验收报告和发布包。

机器可读绑定见 `supersession-status.v1.json`。该 sidecar 绑定旧病例 manifest、runtime-release manifest 和最终旧 RC ZIP 的 SHA-256；历史制品本身不作修改。
