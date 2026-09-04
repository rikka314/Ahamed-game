# 共享连接层

## 定位

`share/` 是游戏层与模型层之间唯一允许的直接连接面。它不实现游戏玩法，也不实现模型推理；它负责确保两个独立项目对相同业务概念、状态、消息、错误和版本有一致理解。

## 当前版本

`@ahamed/doctor-game-share@1.0.0-rc.2` 是无第三方运行时依赖的独立 TypeScript package。它提供公共类型、语言中立 JSON Schema、合成 fixture、版本清单和契约测试；`share` 不依赖 `game` 或 `model`。E4 在新的 rc2 发布记录中为 `CaseSummaryV1` 增加必填 `patientRoleId`，不再原地修改 `v1-rc1` release manifest。严格 rc1 consumer/producer 必须显式升级后才能互操作。

E4 身份映射的工程记录位于 `versions/e4-patient-identity-quality-record.v1.json`；最终闭环记录位于 `versions/e4-patient-identity-e5-closure.20260904-r3.json`，覆盖 30 例、15 个两槽班次、30 次创建会话/问诊/离场、5 个已观察运行时表面、零敏感命中及两个相互隔离且均通过的 AI 审核。save-export 表面尚不存在，已作为证据限制记录而未伪造扫描结果。

依赖审查：运行时依赖为 0。构建期仅使用 `typescript@5.9.3`（Apache-2.0）和 `@types/node@22.20.1`（MIT；传递类型包 `undici-types@6.21.0` 为 MIT），版本与现有 `model/` 基线一致。`./schema-validation` 子路径提供无依赖的冻结 JSON Schema subset validator，供模型病例加载边界和双方 contract tests 共用。

```bash
npm run typecheck
npm test
npm run test:coverage
npm run test:contract
```

## 目录

```text
share/
├─ contracts/v1*/    rc1 冻结入口与 rc2 当前 TypeScript DTO
├─ schemas/v1*/      rc1/rc2 独立 JSON Schema 和 manifest
├─ fixtures/v1*/     rc1/rc2 独立合成正反例
├─ testing/           仅供测试使用的无依赖 JSON Schema subset validator
├─ tests/             serialization、schema、hidden-field 与 contract tests
├─ versions/          v1-rc1/v1-rc2 manifest、changelog 与兼容矩阵
└─ README.md
```

rc1 传递制品保留在 `contracts/v1/`、`schemas/v1/`、`fixtures/v1/`；当前 package 入口使用 `contracts/v1-rc2/`，rc2 Schema/fixture 位于对应 `v1-rc2/` 目录。事件等未变模块由 rc2 入口复用冻结的 v1 实现。mock server 和 headless client 不属于本次 Phase 1 的共享契约交付，后续在消费者接入阶段按同一 Schema 实现。

## v1-rc2 固定规则

- 客户端病例数据只能通过 `projectClientCaseV1` 这类 allowlist 构造；不得对完整病例做 denylist 删除。
- `CaseSummaryV1.patientRoleId` 是必填的公开身份/视觉配置键；它不得携带 Persona 模板、行为指令、诊断或隐藏病例事实。`patientNpcId` 只表示游戏侧可复用演员槽位。
- `test_pending` 保留给未来游戏时间机制；当前 CLI 的确定性检查无需进入该阶段。
- `TurnCompletedV1.effects` 按顺序承载聊天同一幂等操作内已提交的 `test_completed` / `test_unavailable` 副作用；客户端展示患者回复后再展示独立检查报告，幂等重放不得重复执行。
- 幂等 fingerprint 是 `createRequestFingerprintMaterialV1` 产生的 canonical JSON 的 UTF-8 SHA-256 小写 hex。客户端幂等 ID 不参与 payload hash；同 key 不同 hash 返回 `IDEMPOTENCY_CONFLICT`。
- 同一 session 的事件 `sequence` 单调递增，客户端按 `eventId` 去重；delta 不提交权威状态，completed event 或会话查询结果才是恢复依据。
- 分数范围是 0–100；权重声明由共享契约固定，但具体评分实现、私有 rubric 和黄金向量仍属于模型层。

## 共享层负责

- 公共 DTO、JSON Schema、稳定 ID 和枚举。
- 会话状态机及各状态允许的动作。
- HTTP API、SSE 事件、错误码、幂等和重试语义。
- 病例的客户端可见投影，不包含隐藏事实和答案。
- 患者 NPC 与病例会话的绑定。
- 游戏检查设备 ID 与医学检查 ID 的映射协议。
- 医学评分到游戏奖励的输入输出边界，不定义具体奖励数值。
- fixture、mock、contract test 和合并门槛。
- 契约版本、弃用窗口、迁移和历史回放兼容性。

## 共享层不负责

- 任何 Phaser、地图、动画、美术或模拟经营内部逻辑。
- 任何模型 prompt、Agent、病例生成或评分实现。
- 数据库、模型供应商或 UI 框架的内部类型直接外泄。
- 把一方的内部对象当作跨层协议。

完整规范见 [`../docx/baseknowledge/共享层基本内容.md`](../docx/baseknowledge/共享层基本内容.md)。
