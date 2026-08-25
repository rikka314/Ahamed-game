# 共享连接层

## 定位

`share/` 是游戏层与模型层之间唯一允许的直接连接面。它不实现游戏玩法，也不实现模型推理；它负责确保两个独立项目对相同业务概念、状态、消息、错误和版本有一致理解。

## 计划内容

```text
share/
├─ contracts/        公共 TypeScript 类型和语言无关接口说明
├─ schemas/          JSON Schema 或其他运行时校验 Schema
├─ events/           SSE/流式事件和游戏内部桥接事件定义
├─ fixtures/         双方共同使用的无敏感数据测试样例
├─ mocks/            游戏侧 mock server 与模型侧 headless client
├─ tests/            契约、兼容性和序列化测试
├─ versions/         版本清单、变更记录、弃用与迁移说明
└─ README.md
```

以上子目录按实际实现逐步创建，不提前填充无内容的空目录。

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
