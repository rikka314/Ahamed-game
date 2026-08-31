# 共享连接层

## 定位

`share/` 是游戏层与模型层之间唯一允许的直接连接面。它不实现游戏玩法，也不实现模型推理；它负责确保两个独立项目对相同业务概念、状态、消息、错误和版本有一致理解。

## 当前版本

`@ahamed/doctor-game-share@1.0.0-rc.1` 是无第三方运行时依赖的独立 TypeScript package。它提供公共类型、语言中立 JSON Schema、合成 fixture、版本清单和契约测试；`share` 不依赖 `game` 或 `model`。

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
├─ contracts/v1/     公共 TypeScript DTO、枚举、状态机与 fingerprint material
├─ schemas/v1/       JSON Schema 2020-12 公共合同和 manifest
├─ fixtures/v1/      每个公共 DTO/event 的合成正反例
├─ testing/           仅供测试使用的无依赖 JSON Schema subset validator
├─ tests/             serialization、schema、hidden-field 与 contract tests
├─ versions/          v1-rc1 manifest、changelog 与兼容矩阵
└─ README.md
```

事件类型位于 `contracts/v1/events.ts`，与 DTO 共用同一个公开入口。mock server 和 headless client 不属于本次 Phase 1 的共享契约交付，后续在消费者接入阶段按同一 Schema 实现。

## v1-rc1 固定规则

- 客户端病例数据只能通过 `projectClientCaseV1` 这类 allowlist 构造；不得对完整病例做 denylist 删除。
- `test_pending` 保留给未来游戏时间机制；当前 CLI 的确定性检查无需进入该阶段。
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
