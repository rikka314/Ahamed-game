# 模型层独立项目边界

> 当前初始化基线：Node.js + TypeScript 独立 package。它可以嵌入 Next.js Route Handler/BFF，也可以被后续独立服务复用；当前没有绑定模型供应商、数据库或 HTTP 框架。

## 定位

`model/` 是前期并行开发阶段的模型层独立项目根目录。它负责把经过审核的结构化病例转换为可控、可追溯、可评测的虚拟患者问诊体验，并通过 `share/` 定义的契约对游戏层提供能力。

模型层必须能够在没有 Phaser 和游戏客户端的情况下，使用 headless client 独立完成以下闭环：

```text
创建病例会话
→ 接收玩家问题
→ 分类动作
→ 按权限披露病例事实
→ 返回固定检查结果
→ 接收诊断
→ 生成结构化评分与复盘
→ 保存可追溯事件
```

## 所有权

- 病例 Schema、病例生产、审核、版本化、发布、撤回和历史回放。
- Controller、Patient、Evaluator 等模型职责和提示词版本。
- 患者人格、病例事实、披露条件、检查结果、答案键和评分 rubric。
- 诊断术语归一化、同义词和疾病层级匹配。
- 医学评分、轨迹分析、复盘文本和评分证据。
- 提示注入防护、隐藏事实保护、真实病情输入处理和医疗安全边界。
- 模型调用、成本、延迟、重试、审计日志和评测数据。
- 对 `share/` 契约的模型侧 adapter、headless runner 与契约测试。

## 禁止持有

- Phaser Scene、玩家坐标、相机、动画或碰撞状态。
- 游戏货币、经验、库存、设备购买价格、声望或解锁决定。
- Tiled 地图、像素素材和客户端本地存档。
- 通过自然语言回复直接改变游戏状态。
- 把未经医学审核的实时生成病例直接发布给玩家。

## 依赖规则

- 可以依赖 `share/` 发布的公共契约。
- 不得 import、复制或读取 `game/` 的内部模块。
- 所有对外响应必须通过共享 Schema 验证并使用稳定 ID。
- 模型不可用时必须返回明确、可重试的错误，不能伪造患者回复或检查结果。

## 已初始化内容

```text
model/
├─ cases/
│  ├─ README.md                 病例生命周期与数据边界
│  └─ fixtures/                 只用于开发/测试的合成病例
├─ prompts/
│  ├─ controller/               动作分类提示词版本
│  ├─ patient/                  受控患者提示词版本
│  └─ evaluator/                结构化评分提示词版本
├─ src/
│  ├─ application/              会话、问诊、检查、诊断编排
│  ├─ domain/                   服务端病例结构与稳定错误
│  ├─ evaluation/               可替换的评估实现
│  ├─ headless/                 无游戏客户端的完整闭环 runner
│  ├─ observability/            结构化事件 sink
│  ├─ providers/                模型 provider port 与开发期确定性实现
│  ├─ repositories/             病例 repository port 与内存/文件适配
│  └─ safety/                   注入识别与输出门控策略
├─ tests/                       unit + headless integration tests
├─ package.json
└─ tsconfig.json
```

`src/application/` 承担基线文档中的 orchestration 职责。`share/` 的 contract v1 尚未实现，因此当前公共形状只是模型层内部应用接口，不是跨层契约事实源；共享 Schema 冻结后，应在 `adapters/` 中显式映射并验证，不能让游戏层直接 import 这里的内部类型。

## 开发命令

在 `model/` 内执行：

```bash
npm install
npm run typecheck
npm test
npm run test:coverage
npm run headless
```

`npm run headless` 使用纯合成 fixture 和确定性 provider 跑通：

```text
创建会话 → 问诊 → 固定检查 → 诊断 → 结构化评分 → 审计事件
```

它不调用真实 LLM，不代表医学质量已经通过审核。

## 安全约束

- `cases/`、`prompts/`、答案键和 rubric 只能部署在可信服务端。
- 创建会话和查询会话只返回 allowlist 投影；不会序列化完整病例对象。
- Controller 只能看到可问事实的 ID/匹配索引；Patient 只收到本轮 `allowedFacts`。
- Patient 输出在提交前检查事实 ID、新造事实和诊断泄露。
- 检查结果直接读取冻结病例包；确定性 provider 只用于测试与开发。
- Evaluation 只输出医学评分和证据，不输出金钱、经验、库存或解锁。

## 当前状态与待决项

- Phase 0 独立运行时已选择 TypeScript；这不决定最终部署必须是独立 Node 服务。
- MVP 仍建议由 Next Route Handlers/BFF 承载；是否拆分 FastAPI：**待项目审核**。
- 模型供应商、模型名称、推理参数、预算和部署地区：**待项目审核**。
- `share/` contract、正式病例、医学审核流程、真实 provider、持久化存储和生产级观测：**尚未实现**。
- 当前确定性 evaluator 使用基线文档建议权重，仅作为 fixture 回归工具；正式评分范围和计算必须由共享契约冻结后替换。

详细模型基线见 [`../docx/baseknowledge/开源资源与技术方案.md`](../docx/baseknowledge/开源资源与技术方案.md)，跨层规则见 [`../docx/baseknowledge/共享层基本内容.md`](../docx/baseknowledge/共享层基本内容.md)。
