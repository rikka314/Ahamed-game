# 病例目录

> C7 状态：旧 `manifest.v1-rc1.json` 及其 published/AI-validation 绑定只读保留并已 `superseded`。新对话候选来自 `manifest.dialogue-candidate.v1-rc1.json`，5 个病例已通过临床安全/诊断质量双 AI 复核，并物化到 `published/dialogue-rc-20260828-r1/`；当前发布绑定见 `manifest.dialogue-rc.v1-rc1.json`。

> E0 状态：30 例首发内容矩阵已冻结为 `policy/launch-content-policy-v1.json`，并由 `schemas/launch-content-policy-v1.schema.json`、TypeScript 语义校验器和 `policy/launch-content-policy-e0-quality-record.v1.json` 共同约束。该政策固定 9 个疾病域、24/6 难度、六人格各 5 例、30 个唯一 `patientRoleId`、来源许可规则、首发排除项和 v2 版本命名。它继续作为 E2 和后续病例生产的输入，但不代表 30 个实际病例已经生成。AI 审核当前如实记录为非阻塞 `not_run`。

> E1 状态：`CasePackage v2-rc1`、`patient-persona-templates-v2`、`provenance-record-v2`、非阻塞 `ai-case-cross-review-v3` 和结构型 `case-manifest-v2-rc1` 已实现。v2 将 `patientIdentity`、`patientPersona` 与医学事实分开；六人格及三项 modifiers 可经 OpenAI、Anthropic 与 deterministic 测试替身使用。`migrateCasePackageV1ToV2` 是显式迁移入口，E1 未改写 C01–C05，实际迁移仍属于 M0。

> E2 状态：病例生产和发布链已由 `manifest.phase6-compat.v2-rc1.json` 驱动；病例数、人格配额、疾病域、难度、最低回归轨迹、真实对话轮数、测试状态和质量阈值均来自版本化 release policy。红旗规则拆为通用集合与 9 个域策略，Phase 7 问诊语料改为 Manifest 显式绑定的域语料。病例发布、C7 acceptance、runtime manifest 与 Software RC 对质量风险采用 `reviewPolicy: non_blocking` reporter 语义；路径、Schema、hash、原子写入和不可覆盖仍是技术硬错误。

病例包是模型层的服务端事实源，不得复制到 `game/`、`public/`、浏览器存档或客户端 bundle。

`CasePackage v1-rc1` 已冻结。`schemas/case-package-v1-rc1.schema.json` 是可移植 JSON Schema，`src/domain/case-package.ts` 是运行时结构与交叉引用校验器。AI 交叉验证、来源记录和 red-flag exclusion matrix 分别由同目录的 `ai-case-cross-validation-v1`、`provenance-record-v1` 与 `red-flag-exclusion-matrix-v1` Schema 固定；共同的正反 fixture 会同时经过 JSON Schema 和运行时校验。上述内容均为服务端私有规范，不能复制到 `share/` 或客户端产物。旧版人工审核记录 Schema 继续保留为可选内容反馈格式，不再构成发布门。

`CasePackage v2-rc1` 不原地扩充 v1 枚举。`playerVisible` 只保留首轮主诉；公开身份锚点进入 `patientIdentity`，交流行为进入 `patientPersona`，医学真相继续只存在于 `patientFacts`、`medicalTests`、`answerKey` 和 `rubric`。`provenance-record-v2` 支持按 `sourceRole` 记录多来源职责、许可判断、使用方式和字段绑定。`ai-case-cross-review-v3` 的 `approved`、`revision_recommended`、`rejected`、`not_run` 仅表示风险观察，`packageStatus` 与审核结论相互独立。

目录约定：

```text
draft/       作者工作区；允许 pending review 和显式离线开发/测试，不可直接进入玩家运行时或发布评测病例池
ai-validation/ 两个独立 AI 验证角色的逐例交叉验证记录
review/      可选人工内容反馈；不得包含真实患者资料，也不阻塞发布
published/   不可变、带 sha256 内容 hash 的病例版本；v1 保留旧批准语义，v2 审核状态非阻塞
provenance/  来源、许可、引用和内容 hash 记录
regression/  每例 success、failure、safety、unknown 四类固定回归轨迹
fixtures/    完全合成的测试数据，永不视作已发布病例
schemas/     私有 CasePackage 与 rubric JSON Schema
policy/      E0 首发内容政策及其可复验质量记录
evaluation/  Manifest 明确绑定的按域 Phase 7 问诊语料
manifest.v1-rc1.json  冻结版本和发布目录索引
manifest.phase6-compat.v2-rc1.json  C01–C05 的 E2 兼容清单与 release policy
```

E0 政策门使用 `npm run cases:validate:launch-policy`。命令会重新执行 JSON Schema 与跨行语义校验，并拒绝与冻结政策不一致的质量记录。它检查病例/人格/疾病域/批次配额、ID 唯一性、高风险首发排除、来源许可判定规则、版本政策和旧证据 `superseded` 绑定；AI 审核结果继续作为非阻塞观察字段。

v1 历史 lifecycle 仍为 `draft → AI cross-validation → approved/published → withdrawn`。v2 从结构上把 `packageStatus` 与 AI 审核状态解耦：两个隔离角色及六项检查可以记录完成、失败或未运行，任何 decision 都不充当 allow/deny；来源、hash、red-flag、答案键和 rubric 等技术制品仍必须可解析并保持绑定。E2 的 v2 发布入口允许 `approved`、`revision_recommended`、`rejected`、`not_run` 和 `stale` 原样进入候选及 sidecar，并继续使用锁文件、临时文件、原子 rename 和不可覆盖写入。已发布版本不得原地覆盖，内容变化必须创建新 `caseVersion` 和 hash。

`answerKey`、`diagnosisConcepts`、隐藏事实和 `rubric` 是私有真相。公开病例列表与客户端投影必须由 allowlist adapter 单独生成，禁止对完整 CasePackage 做删字段式序列化。

C1 对话候选工程门使用 `npm run cases:validate:dialogue`。E2 清单使用 `npm run cases:validate:manifest -- [--manifest <cases/manifest.json>]` 校验结构、配额、显式文件绑定和 hash；`npm run cases:validate` 生成 Phase 6 reporter。当前五例旧 sidecar 均记为非阻塞 stale/invalid findings，命令仍成功返回；只有清单无法解析、路径越界或制品无法构造时返回技术失败。内容 hash 对病例医学内容、事实、检查、answer key、rubric、来源和红旗证据做 canonical SHA-256；发布状态、AI 验证记录与可选 review decision 不进入内容 hash。

开发门与发布证据分离：fixture 或结构就绪 draft 可以被显式的离线开发、单元测试和 deterministic/mock 回归加载；加载方必须保留状态并将输出标记为开发证据。v1 玩家运行时继续遵守旧 published/approved 绑定；v2 装载必须由 E2 Manifest 显式列出，审核结论只作为风险记录，不再作为技术发布门。

历史 C01–C05 published 病例、双 AI sidecar 与 `manifest.v1-rc1.json` 已按 C0 只读保留并标记为 `superseded`。当前 `1.0.0-draft.1` 对话候选的 5 个新 hash 同时绑定候选 manifest、5 份 V2 双 AI 记录、新 published 病例与 `manifest.dialogue-rc.v1-rc1.json`；发布门会重新解析所有语义证据，而不只信任可编辑索引中的文件哈希。
