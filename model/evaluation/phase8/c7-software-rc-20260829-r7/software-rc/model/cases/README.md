# 病例目录

> C7 状态：旧 `manifest.v1-rc1.json` 及其 published/AI-validation 绑定只读保留并已 `superseded`。新对话候选来自 `manifest.dialogue-candidate.v1-rc1.json`，5 个病例已通过临床安全/诊断质量双 AI 复核，并物化到 `published/dialogue-rc-20260828-r1/`；当前发布绑定见 `manifest.dialogue-rc.v1-rc1.json`。

病例包是模型层的服务端事实源，不得复制到 `game/`、`public/`、浏览器存档或客户端 bundle。

`CasePackage v1-rc1` 已冻结。`schemas/case-package-v1-rc1.schema.json` 是可移植 JSON Schema，`src/domain/case-package.ts` 是运行时结构与交叉引用校验器。AI 交叉验证、来源记录和 red-flag exclusion matrix 分别由同目录的 `ai-case-cross-validation-v1`、`provenance-record-v1` 与 `red-flag-exclusion-matrix-v1` Schema 固定；共同的正反 fixture 会同时经过 JSON Schema 和运行时校验。上述内容均为服务端私有规范，不能复制到 `share/` 或客户端产物。旧版人工审核记录 Schema 继续保留为可选内容反馈格式，不再构成发布门。

目录约定：

```text
draft/       作者工作区；允许 pending review 和显式离线开发/测试，不可直接进入玩家运行时或发布评测病例池
ai-validation/ 两个独立 AI 验证角色的逐例交叉验证记录
review/      可选人工内容反馈；不得包含真实患者资料，也不阻塞发布
published/   只放 AI 交叉验证 approved、带 sha256 内容 hash 的不可变病例版本
provenance/  来源、许可、引用和内容 hash 记录
regression/  每例 success、failure、safety、unknown 四类固定回归轨迹
fixtures/    完全合成的测试数据，永不视作已发布病例
schemas/     私有 CasePackage 与 rubric JSON Schema
manifest.v1-rc1.json  冻结版本和发布目录索引
```

生命周期为 `draft → AI cross-validation → approved/published → withdrawn`。进入 `published/` 前必须记录来源、病例版本、两个独立 AI 验证角色及其模型/提示版本/验证时间、与 `caseId/caseVersion/contentHash` 绑定的批准记录、逐条 red-flag 排除证据、答案键、rubric 和许可证/授权。两个角色必须分别覆盖临床安全与诊断质量，六项检查全部通过；人工审核意见和签字不是发布前置条件。已发布版本不得原地覆盖；修改后创建新的 `caseVersion` 并重新交叉验证。

`answerKey`、`diagnosisConcepts`、隐藏事实和 `rubric` 是私有真相。公开病例列表与客户端投影必须由 allowlist adapter 单独生成，禁止对完整 CasePackage 做删字段式序列化。

C1 对话候选工程门使用 `npm run cases:validate:dialogue`，校验 JSON Schema、运行时交叉引用、人格/社交元数据、检查中文名与别名以及 `case-content-hash-v1`。旧 Phase 6 发布门 `npm run cases:validate` 仍保留用于证明历史 AI sidecar 已因病例内容变化而失效，当前预期返回 `AI_CROSS_VALIDATION_INVALID`。内容 hash 对病例医学内容、事实、检查、answer key、rubric、来源和红旗证据做 canonical SHA-256；发布状态、AI 验证记录与可选 review decision 不进入内容 hash。

开发门与发布门分离：fixture 或结构就绪 draft 可以被显式的离线开发、单元测试和 deterministic/mock 回归加载；加载方必须保留 draft 状态并将输出标记为开发证据。玩家可访问运行时、完整候选 benchmark、live release gate、Software RC、公开试玩、Beta 和生产发布只允许加载已通过 AI 交叉验证的 published 病例。

历史 C01–C05 published 病例、双 AI sidecar 与 `manifest.v1-rc1.json` 已按 C0 只读保留并标记为 `superseded`。当前 `1.0.0-draft.1` 对话候选的 5 个新 hash 同时绑定候选 manifest、5 份 V2 双 AI 记录、新 published 病例与 `manifest.dialogue-rc.v1-rc1.json`；发布门会重新解析所有语义证据，而不只信任可编辑索引中的文件哈希。
