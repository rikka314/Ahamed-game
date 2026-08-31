# AhaMed Doctor Game 模型层 MVP 实施计划

> 文档状态：实施跟踪；Phase 0–7 与 Phase 8-A 已完成，交付状态为 **Software RC ready；Formal MVP blocked by infrastructure**。P8-PRE-01–P8-PRE-05 全部通过；当前唯一批准的第三方 OpenAI-compatible Provider 固定使用 `gpt-5.6-sol`，候选评测 15/15、最终 RC 评测 25/25，Controller fact-routing 100%，60/100 条患者回复双角色 AI 审核均 approved，严重事实/安全错误 0。不可变 runtime-release manifest 已验证，share 明确保留 `v1-rc1`。Claude 未进入批准列表且不构成阻塞。Phase 8-B 仍需同一制品在已知目标服务器完成部署、SQLite、secret、时钟、备份恢复和崩溃 smoke，未完成前不得称正式 MVP
>
> 建立日期：2026-08-25
>
> Phase 2 完成日期：2026-08-27；此状态只表示本节工程退出条件已满足，不代表整体模型层 MVP 或 Software RC 完成
>
> Phase 3 完成日期：2026-08-27；此状态只表示中文 deterministic CLI 工程退出条件已满足，不代表 C01 reference draft 已通过双 AI 发布验证，也不代表真实 Provider 或整体模型层 MVP 已完成
>
> Phase 4 完成日期：2026-08-27；已完成官方 OpenAI SDK adapter、官方默认端点与显式第三方 Responses-compatible URL/Key 配置、角色端口、Prompt registry、结构化输出、operation 共享重试/观测、服务端授权事实话术生成、Controller 分类持久化评分、mock HTTP/C01 纵切和固定输入 live-eval 命令。第三方 OpenAI-compatible 真实 Provider 使用 `gpt-5.6-sol` 完成 7/7 次结构化调用、会话 `completed`、总分 88、4,830 tokens，脱敏 fingerprint 为 `fb41c0b14b25a34043ca084642a7a7bcbe72520e34d0b85bad5c4991ec070122`，满足 provider-neutral Phase 4 live gate。该结论不代表官方直连端点验证、双 AI 病例发布验证或发布验收；交互式远程模型 CLI 在 Phase 7 安全策略完成前保持关闭
>
> Phase 5 完成日期：2026-08-27；已完成官方 `@anthropic-ai/sdk@0.119.0` Messages adapter、Provider-specific output/error/usage/stop-reason 映射、共用角色端口与业务 Schema、协议身份隔离、mock HTTP/provider tests、固定 C01 mock 纵切和 `eval:live:anthropic`。同日当前第三方 OpenAI-compatible GPT 预评测复跑完成 7/7 次调用、会话 `completed`、总分 88、3,826 tokens，fingerprint 与 Phase 4 一致。项目决定暂不配置 Claude Key，Claude adapter 保持未接入的可选实现；真实 Claude C01、Claude 半边预评测与最终 Claude 型号选择延期。
>
> Phase 6 AI 发布门完成日期：2026-08-28；K6-01–K6-07 已完成，5/5 草稿 structurally ready、5/5 publishable，5 个 published package 与 validation sidecar 已写入 manifest。人工审核资格和签字不再属于该门。
>
> 适用范围：D:\Learn\20_Projects\MedicalAI\apps\game\model 与必要的 share 契约
>
> MVP 形态：中文命令行交互，不要求接入游戏 UI
>
> 运行边界：CLI 仅用于受控服务器上的内部工程与医学评测，不向学生分发；学生侧正式入口仍应通过可信服务端接入
>
> 产品边界：虚构病例的医学教育与娱乐模拟，不用于真实患者诊断、治疗、处方或急诊分流

## 1. 执行结论

模型层 MVP 的目标不是展示完整游戏，而是交付一个可在命令行中稳定运行、输出正确且可审计结果的虚拟标准化病人系统。

MVP 完成时必须同时具备：

1. 5 个成人、非急症、中文、经过临床安全与诊断质量双 AI 交叉验证的结构化病例；
2. 自然语言问诊、结构化检查申请、诊断提交、确定性评分和中文复盘；
3. GPT 与 Claude 两个 Provider adapter 均保留工程实现；当前 MVP 的运行候选范围只包含已配置的第三方 OpenAI-compatible Provider，Claude 未配置 Key、未进入 runtime-release manifest，且不构成当前 Phase 8 阻塞；
4. 模型名称配置化，不在代码中写死，先以较低级模型进行 benchmark；
5. SQLite 持久化会话、回合、检查、诊断、评分、幂等记录和审计事件；
6. 通过 share contract v1-rc1 的 DTO、JSON Schema、错误和事件契约；
7. 模型输出经过完整 Schema、事实白名单和泄露检查后才显示；
8. 能使用模拟 userId 创建、恢复和查询会话，为未来 AhaMed 账号绑定保留边界；
9. headless、CLI、契约、持久化、安全、病例和 live-provider 评测全部通过；
10. 同一个 Software RC 制品在目标服务器完成单进程、SQLite、secret、Provider 连通和崩溃恢复 smoke。

这里的 CLI 是内部验收工具，不是面向大学生的可分发客户端。病例真相、评分规则、SQLite 文件和 API Key 必须留在受控服务器；将这些资产随 CLI 发给学生会破坏隐藏答案边界，不能视为合格交付。

若仍只有确定性 Provider、内存状态和合成 fixture，则只能称为 Phase 0 技术验证，不视为模型层 MVP。

## 2. 已确认决策

| ID | 决策 | 已确认内容 |
|---|---|---|
| D01 | MVP 交付形态 | 模型层独立 MVP；命令行可交互并输出正确结果即可 |
| D02 | 是否接游戏 UI | 不需要；游戏接入不属于本 MVP |
| D03 | 目标用户 | 中国大学生 |
| D04 | 主要语言 | 简体中文 |
| D05 | 账号边界 | 正式产品绑定账号；CLI MVP 只使用模拟、不可验证身份的 userId |
| D06 | 首批规模 | 5 个双 AI 验证病例；20–50 个病例放到后续内容阶段 |
| D07 | 首批病种 | 普通感冒、流行性感冒、急性咽炎、急性支气管炎、轻症社区获得性肺炎 |
| D08 | 人群与风险 | 只做成人、非急症病例；儿童、孕产妇、急症、自伤暂不纳入 |
| D09 | 病例质量验证 | 初期使用两个独立 AI 验证角色；人工内容反馈可选且非阻塞 |
| D10 | 运行时 | 保持 Node.js + TypeScript 独立 package |
| D11 | MVP 入口 | CLI/headless；暂不依赖 Next BFF 或 HTTP 服务 |
| D12 | 持久化 | SQLite 单机试点；通过 repository port 保留 PostgreSQL 迁移能力 |
| D13 | Provider | 两个 adapter 均保留；当前 MVP 只批准已配置的第三方 OpenAI-compatible Provider 进入真实候选与 Phase 8，Claude 真实验证延期且非阻塞 |
| D14 | 模型档位 | 优先尝试较低级模型；最终模型 ID 由 benchmark 决定 |
| D15 | 成本与延迟 | MVP 不设成本阻塞门；延迟要求宽松，但必须设置有限超时，不能永久挂起 |
| D16 | 数据最小化 | 不向 Provider 发送账号 ID；只发送完成角色任务所需的匿名病例上下文和玩家输入 |
| D17 | 评分原则 | 确定性规则主导；LLM 只做有限语义辅助和复盘 |
| D18 | 输出原则 | 完整回复通过 Schema、事实和泄露校验后再显示，不直接流出未经验证的 token |
| D19 | 交互参数 | 最多 20 个问诊回合；单次输入最多 1000 个 Unicode 字符；会话 TTL 7 天；瞬时失败最多自动重试 1 次 |
| D20 | 评分权重 | 诊断 45%、病史覆盖 25%、鉴别诊断 10%、检查选择 10%、效率 5%、沟通 5%，总分 0–100 |
| D21 | CLI 发布边界 | 仅供内部工程和医学评测；不向学生分发病例文件、SQLite、Prompt、评分规则或 API Key |

### 2.1 随本计划批准生效的补充决策

独立复核发现以下五项必须在实现前显式冻结。项目负责人批准本计划，即视为同时确认：

| ID | 决策 | 建议基线 |
|---|---|---|
| D22 | 沟通评分失败 | 不设置默认分，也不生成最终总分；保留确定性分项并等待同 Provider 恢复评估（确认） |
| D23 | 病例发布批准 | 使用临床安全与诊断质量双 AI 交叉验证；人工资格与签字不作为发布门（确认） |
| D24 | 发布命名 | 服务器信息未知时最多形成 Software RC；只有同一制品通过目标服务器 smoke 后才称正式 MVP（确认） |
| D25 | 现实健康输入 | 在 Provider 调用和原文持久化前由本地 MedicalSafetyPolicy v1 fail-closed 拦截（确认） |
| D26 | 自伤危机输入 | MVP 新增独立 EXIT_SELF_HARM_CRISIS 决策码和本地固定模板；不进入病例模拟或外部 Provider（确认） |

## 3. 当前实现基线

截至本计划建立时，model 已完成 Phase 0：

- 已有独立 TypeScript package；
- 已有 ModelService 编排创建会话、问诊、固定检查、诊断和评分；
- 已有 deterministic provider；
- 已有病例三态事实和披露条件；
- 已有基础幂等、隐藏事实门控、诊断泄露检查和安全中断；
- 已有内存事件 sink；
- 已有一个完全合成的英文 fixture；
- npm run headless 可以完成确定性闭环；
- 现有测试为 23/23 通过；
- 当前覆盖率约为 line 96.24%、branch 92.34%、function 100%。

现有实现尚不满足 MVP：

- share 只有 README，没有可执行 contract、Schema、fixture 和 contract tests；
- session、幂等记录和事件均为内存数据，重启后丢失；
- 没有真实 GPT 或 Claude Provider；
- 当前只有一个未审核 fixture；
- Prompt 仍为未批准的开发模板；
- 当前状态机只有 active、completed、failed；
- Provider 输出拒绝会使整个会话进入 failed，恢复粒度过大；
- 当前 Patient 输入缺少玩家原问题、已披露摘要和必要的会话上下文；
- 内部 DTO 与共享层草案在状态、错误、事件和恢复语义上不一致；
- 没有中文交互式 CLI、live eval、病例发布流程或服务器运行说明。

## 4. MVP 范围

### 4.1 必须实现

- 通过模拟 userId 创建病例会话；
- 列出不泄露诊断的公开病例入口；
- 用中文自然语言问诊；
- 使用明确 CLI 命令申请检查；
- 使用明确 CLI 命令提交主要诊断和可选鉴别诊断；
- 输出患者回答、检查报告、结构化分数、逐项证据和中文复盘；
- 中断后从 SQLite 恢复未过期会话；
- 支持 deterministic、GPT、Claude 三种 Provider 配置；
- 同一会话固定 Provider、模型、Prompt 和病例版本；
- 支持 5 个审核病例；
- 记录延迟、token usage、重试、模型版本、Prompt 版本和安全结果；
- 通过 share v1-rc1 contract tests；
- 能在本地和单台服务器上以单进程方式运行。

### 4.2 明确不进入 MVP

- Phaser、React 或任何游戏 UI；
- 真实 AhaMed 登录、密码、OAuth、跨设备认证；
- HTTP/BFF、SSE、WebSocket 和真实 token streaming；
- 每日病例、排行榜、经营奖励和游戏存档；
- PostgreSQL、多实例、Redis、队列和自动扩缩容；
- 在线随机生成未经审核病例；
- 治疗建议、处方、剂量或真实患者诊断；
- 儿童、孕产妇、急症、自伤病例；
- 语音、医学影像理解、多科室会诊和动态病情演化；
- 自动 GPT ↔ Claude 故障切换；
- 默认启用独立 Consistency LLM；
- 20–50 个正式病例扩容。

## 5. 目标架构

依赖边界保持：

    CLI / headless client
             |
             v
        share contract
             |
             v
         ModelService
       /      |       \
      v       v        v
    Cases  Session DB  Provider ports
                        /          \
                       v            v
                     GPT          Claude

在线问诊路径：

    玩家中文问题
      → 本地输入与真实健康边界检查
      → Controller 结构化分类
      → 服务端计算本轮 allowed facts
      → Patient 只读取玩家问题、allowed facts、公开 persona 和已披露摘要
      → 完整结构化回复
      → Schema、fact-ID、unknown/absent、诊断泄露和状态校验
      → 校验通过后提交回合并显示

检查路径：

    CLI 明确 testId
      → 状态与幂等校验
      → 确定性读取冻结病例包
      → 保存检查结果
      → 显示公开报告

诊断路径：

    CLI 明确主要诊断和鉴别诊断
      → 术语归一化与审核同义词匹配
      → 确定性计算诊断、病史、鉴别、检查和效率
      → LLM 仅生成受限沟通评分建议和中文复盘
      → 服务端确定性计算总分
      → 输出证据和结果

## 6. 共享契约最小范围

MVP 不实现 HTTP，但仍先建立 share contract v1-rc1，避免 CLI 内部类型成为未来游戏接口事实源。

建议新增：

    share/
    ├─ package.json
    ├─ contracts/v1/
    │  ├─ ids.ts
    │  ├─ cases.ts
    │  ├─ sessions.ts
    │  ├─ turns.ts
    │  ├─ tests.ts
    │  ├─ diagnosis.ts
    │  ├─ evaluation.ts
    │  ├─ errors.ts
    │  └─ events.ts
    ├─ schemas/v1/
    ├─ fixtures/v1/
    ├─ tests/contract/
    └─ versions/
       ├─ contract-v1-rc1.json
       ├─ CHANGELOG.md
       └─ compatibility-matrix.md

contract v1-rc1 至少固定：

- 不透明稳定 ID；
- CaseSummary 和 ClientCaseProjection allowlist；
- 创建、查询、问诊、检查、诊断和结果 DTO；
- 模拟 userId/gameProfileId 关联字段；
- SessionPhase；
- SharedError；
- SafetyDecision：EXIT_SELF_HARM_CRISIS、EXIT_URGENT_RED_FLAG、EXIT_OUT_OF_SCOPE、EXIT_REAL_HEALTH、EXIT_FAIL_CLOSED、ALLOW_GAME；
- 结构化事件封套；
- present、absent、unknown；
- 幂等键和 request fingerprint 规则；
- 分数范围、权重、舍入方式和 evidence；
- contract、case、prompt、model、evaluation 版本。

MVP 状态集合：

- created：持久化记录已建立；
- active：允许问诊、检查和诊断；
- awaiting_model：正在执行 Controller 或 Patient；
- diagnosis_submitted：诊断已被接受；
- evaluating：正在生成评分与复盘；
- completed：结果稳定且可恢复；
- expired：超过 7 天 TTL；
- cancelled：用户主动结束；
- failed：不可恢复的会话级错误。

test_pending 保留在共享枚举中供未来游戏时间机制使用，但 CLI MVP 的确定性检查不会进入该状态。

事件最小集合：

- session.created；
- session.state_changed；
- turn.accepted；
- patient.reply.completed；
- test.completed；
- diagnosis.accepted；
- evaluation.completed；
- safety.interrupted；
- request.error。

patient.reply.delta 不在 MVP 运行路径中使用。

## 7. 领域与持久化设计

### 7.1 领域改造原则

- 保留 ModelService 作为 application façade，不整体推倒重写；
- 将 session 状态、幂等和 repository 抽成独立 port；
- 内部 domain 不直接声明公共 contractVersion；
- 只在 share adapter 边界添加和验证契约版本；
- Provider 失败只使当前 operation 失败并恢复到合法状态；
- 只有数据损坏、不可迁移版本或不可恢复一致性错误才使整个 session 进入 failed。

### 7.2 SQLite 数据

至少建立：

| 表 | 用途 |
|---|---|
| schema_migrations | 数据库迁移版本 |
| sessions | userId、case/provider/model/prompt 版本、phase、TTL |
| turns | 玩家问题、患者回答、回合序号和状态 |
| disclosed_facts | 已披露事实及披露回合 |
| completed_tests | 已完成检查及公开结果 |
| diagnosis_submissions | 主要诊断、鉴别诊断和提交状态 |
| evaluations | 分数、证据、复盘和 evaluationVersion |
| idempotency_records | 幂等键、request hash、operation 状态和结果引用 |
| audit_events | 顺序事件、traceId 和脱敏 payload |
| model_calls | Provider、模型、角色、Prompt 版本、延迟、usage、重试和结果状态 |

病例包继续使用版本化只读文件和 manifest；MVP 不把完整病例真相复制到客户端或公开数据表。

### 7.3 一致性与幂等

- 同一幂等键和相同 payload 返回首次逻辑结果；
- 同一幂等键和不同 payload 返回稳定冲突错误；
- session 状态、结果和幂等记录在同一事务中提交；
- 同一 session 同时只允许一个模型生成 operation；
- 诊断提交后阻止新问诊和新检查；
- 外部 Provider 已完成但本地事务未提交时，无法保证外部调用严格 exactly-once；
- MVP 保证医学业务状态 exactly-once，并记录 pending、completed、failed、unknown operation；
- 遇到 unknown operation 时不自动重复诊断结算，先查询或人工恢复；
- 7 天 TTL 从 session.createdAt 起固定计算，不因恢复会话或新增回合而顺延；
- 幂等记录保留 8 天，覆盖完整会话 TTL 和过期清理窗口，之后由清理任务删除。

每次外部调用必须先建立 operation journal：

    prepared
      → dispatched
      → response_validated
      → committed

failed 和 unknown 为旁路状态。每条 operation 至少保存 operationId、幂等键、request hash、session 固定的 Provider/model/prompt/case 版本、attemptCount、providerRequestId、validatedResponseRef 和错误码。

恢复不变量：

- 进程启动只做本地对账，绝不自动发起 Provider 调用；
- response_validated 表示完整响应已经通过 Schema、事实白名单和泄露检查并持久化，可直接完成本地事务；
- dispatched 后进程崩溃一律转为 unknown，不猜测远端是否成功；
- 同一逻辑 operation 最多两次 Provider 尝试，即首次加一次重试；显式恢复重试也占用该预算；
- 恢复只能使用 session 已固定的同一 Provider、model、prompt 和 caseVersion；
- 重复幂等请求本身只查询 operation，不触发 Provider 调用。

### 7.4 崩溃恢复矩阵

| SessionPhase | 重启后的确定性行为 | Provider 重调 | 同幂等键响应 |
|---|---|---|---|
| created | 校验冻结版本后转 active；数据缺失或不可迁移才转 failed | 禁止 | 相同 hash 返回原 session；不同 hash 冲突 |
| active | 保持 active，并先检查 expiresAt | 禁止 | committed 返回首次结果；failed 返回首次错误；不同 hash 冲突 |
| awaiting_model | response_validated 直接提交后回 active；prepared 等待显式恢复；dispatched 转 unknown；operation 失败后回 active | 启动时禁止；只有显式恢复且仍有预算时才可重调同一 Provider | OPERATION_IN_PROGRESS 或 OPERATION_RECOVERY_REQUIRED，不重复调用 |
| diagnosis_submitted | 保留不可变诊断，禁止二次提交；等待继续评估 | 启动时禁止；显式开始或继续 evaluation operation | 返回首次 accepted 和当前 phase |
| evaluating | response_validated 本地提交为 completed；prepared 等待恢复；dispatched 转 unknown；失败后回 diagnosis_submitted | 只有显式恢复且仍有预算时可重调同一 Provider | 返回当前评估状态或恢复错误，不重复结算 |
| completed | 保持不可变终态 | 禁止 | 返回首次稳定结果 |
| expired | 保持终态，不接收迟到结果 | 禁止 | 固定 SESSION_EXPIRED；第 8 天前只阻止重执行，不返回已清理正文 |
| cancelled | 保持终态 | 禁止 | cancel 返回首次结果；其他写请求返回 SESSION_CANCELLED |
| failed | 保持终态，只允许检查；修复后新建会话 | 禁止 | 返回首次会话级错误和 traceId |

若 validatedResponseRef 在 expiresAt 前已经持久化，可以完成纯本地提交；否则到期后直接进入 expired。普通模型调用失败只结束本次 operation，不把健康 session 置为 failed；failed 只用于数据损坏、迁移失败等会话级不可恢复错误。

内部运维入口：

    npm run ops:inspect -- --session <sessionId>
    npm run ops:recover -- --operation <operationId> --commit-buffered
    npm run ops:recover -- --operation <operationId> --retry-same-provider
    npm run ops:recover -- --operation <operationId> --fail

所有 recover 命令必须写入操作者、原因、时间和前后状态；retry-same-provider 仅在 attemptCount 未超限时可用。

### 7.5 单机限制

- SQLite MVP 只支持单进程、单主机写入；
- 可启用适合单机的事务和 WAL 配置；
- 不声称支持多实例水平扩容；
- 服务器环境明确后再决定数据库路径、文件权限、备份、进程管理和恢复操作；
- 需要多实例时先迁移 PostgreSQL，再开放多进程写入。

## 8. CLI 设计

计划新增交互入口：

    npm run eval:live -- --model <provider modelId> --output <report.json>

建议命令：

| 命令 | 作用 |
|---|---|
| /cases | 列出不泄露诊断的公开病例入口 |
| /start <caseId> | 创建新会话 |
| /resume <sessionId> | 恢复未过期且属于当前模拟 userId 的会话 |
| /status | 显示会话阶段、回合数和已完成检查 |
| 直接输入中文 | 询问虚拟患者 |
| /tests | 列出公共检查目录，不泄露当前病例答案 |
| /test <testId> | 申请结构化检查 |
| /diagnose <主要诊断> | 提交主要诊断 |
| /differentials <诊断1;诊断2> | 在最终提交前设置鉴别诊断 |
| /result | 查看已完成结果 |
| /cancel | 取消未完成会话 |
| /help | 显示命令和产品边界 |
| /exit | 退出 CLI，不删除会话 |

交互约束：

- 检查和诊断只通过明确命令，不让 Controller 从普通自然语言中隐式执行写操作；
- 普通自然语言只进入问诊分类；
- 输入超过 1000 字符立即拒绝，不进入 Provider；
- 第 20 个有效问诊回合完成后阻止继续问诊，引导提交诊断；
- 闲聊是否消耗回合由 Controller 分类结果决定：other 不增加医学回合，但写入限量审计计数；单会话 turn-attempt 成本预算为 25（20 个医学回合加 5 个滥用缓冲），每个新的 turn 幂等键在 Provider 前持久化扣减，成功、Provider 失败和输出拒绝均计入，幂等重放不重复扣减；达到上限后在发起下一次 Provider 调用前拒绝；
- 会话创建时固定 Provider 和模型，运行中不自动切换；
- CLI userId 只是未来账号边界的占位符，不构成真实身份认证；
- CLI 只能在受控开发机或服务器上运行，不得把病例包、数据库、Prompt、评分规则或 API Key 打包给学生。

## 9. Provider 计划

### 9.1 统一端口

将当前单一 ModelProvider 拆成最小角色端口：

- ControllerProvider；
- PatientProvider；
- ReviewProvider。

每个 adapter 统一返回：

- 结构化业务结果；
- providerName；
- modelId；
- promptVersion；
- request/response 时间；
- input/output token usage；
- retryCount；
- providerRequestId；
- finish/stop reason；
- 可重试错误分类。

不得在通用层暴露 OpenAI 或 Anthropic SDK 原始对象。

### 9.2 GPT

GPT 作为首个真实纵切：

- 使用官方 TypeScript SDK；
- 以 Responses API 为计划基线；
- 使用 JSON Schema Structured Outputs；
- 显式使用 store=false，不保存远端会话状态，应用自己持有经过筛选的上下文；实现时用所选 SDK 的集成测试确认该参数实际生效；
- 不发送本地 userId、账号、邮箱或其他身份字段；
- 角色使用独立 Prompt 和数据权限；
- 先用 C01 的 schema-valid reference draft 跑通工程纵切；该结果不替代双 AI 病例发布验证或真实候选发布评测；
- 完整 benchmark 只使用 Phase 6 发布的 5 个病例；
- 候选模型 ID 由配置注入，最终选型前提交 benchmark 给项目负责人确认。

### 9.3 Claude

Claude 在 GPT 纵切稳定后实现：

- 使用官方 Anthropic TypeScript SDK 和 Messages API；
- 使用 output_config.format 的 JSON Schema structured output；
- 与 GPT 使用同一内部角色端口和业务 Schema；
- 单独处理 Claude 的 content blocks、stop reason、usage 和错误；
- 不通过 OpenAI compatibility 层掩盖 Provider 差异；
- 候选模型必须实际支持所需 Structured Outputs；
- 先通过与 GPT 相同的 C01 工程纵切，再使用 Phase 6 发布病例通过完全相同的 5 病例 benchmark 和安全门。

### 9.4 模型选型门

较低级模型只有满足以下条件才可被选中：

1. 支持所需结构化输出能力；
2. Controller 事实路由达到阈值；
3. Patient 未授权事实和诊断泄露为 0；
4. unknown 不被改写成 absent/normal；
5. 通过提示注入回归；
6. 一次允许的重试后结构化成功率达到门槛；
7. 中文患者表达通过医学抽样；
8. 不需要启用默认 Consistency LLM 才能稳定通过。

benchmark 完成后必须再次询问项目负责人，确认当前批准 Provider 列表及每个 Provider 的最终 model ID。当前列表只包含第三方 OpenAI-compatible Provider；Claude 只有在独立 Key、真实纵切和同等级评测证据齐全后才能通过新的 runtime-release manifest 纳入。模型 ID 应固定到明确版本或可审计别名，并记录选择日期。

### 9.5 超时与重试

初始工程默认值：

- 单次 Provider 调用 hard timeout：120 秒；
- 单个问诊 operation 总上限：300 秒；
- 诊断复盘 operation 总上限：300 秒；
- 仅对连接失败、限流和明确可重试 5xx 自动重试 1 次；
- Schema 错误可重新生成 1 次，但计入同一个逻辑重试预算；
- 安全拒绝、非法请求和病例状态错误不重试；
- SDK 内建重试必须纳入统一预算，避免实际重试次数超限。

这些值在 live benchmark 后可以下调；不得改成无限等待。

## 10. Prompt 与数据权限

### 10.1 Controller

可见：

- 玩家当前问题；
- locale；
- askable factId；
- 经过清洗的 question matcher 或事实主题标签；
- 必要的安全分类说明。

不可见：

- 事实值；
- answer key；
- rubric；
- 隐藏事实；
- 检查结果；
- 游戏奖励。

### 10.2 Patient

可见：

- 玩家当前问题；
- 本轮 allowed facts；
- 已披露事实摘要；
- 公开患者 persona；
- 中文语言风格；
- 必要的最近对话摘要。

不可见：

- 最终诊断；
- rubric；
- 未授权事实；
- 尚未申请的检查结果；
- 账号 ID；
- 游戏奖励。

### 10.3 Review

可见：

- 确定性分数；
- 允许公开的评分证据；
- 已披露轨迹；
- 已完成检查；
- 审核后的病例解析投影。

职责：

- 生成中文复盘；
- 对沟通质量给出受限结构化标签；
- 提示可能需要人工复核的语义诊断。

禁止：

- 直接改写确定性诊断结果；
- 直接改写总分；
- 输出游戏奖励；
- 暴露服务端内部字段。

## 11. 评分实现

Phase 1 必须发布版本化 ScoringPolicy v1；病例、代码、契约和黄金向量共同引用同一个 evaluationVersion。总分使用已确认权重：

    total =
      diagnosis * 0.45
      + historyCoverage * 0.25
      + differentialReasoning * 0.10
      + testSelection * 0.10
      + efficiency * 0.05
      + communication * 0.05

### 11.1 ScoringPolicy v1 输入约束

每个可发布病例必须提供：

- 非空 targetConceptId 和经过审核的 acceptedSynonyms；
- 至少 1 个 mustAskFactId；
- 至少 2 个 acceptableDifferentialConceptId，以及 requiredDifferentialCount，MVP 固定为 2；
- 公共检查目录中的每个 testId 必须且只能标为 required、useful 或 unnecessary；
- 1–20 之间的 recommendedTurnLimit；
- communication rubric version。

缺少上述字段时病例 Schema 校验失败，不用默认分补齐。诊断和鉴别诊断先通过病例内审核词表映射为 concept ID；无法映射的自由文本不自动得分，只进入 needs_review 记录。

### 11.2 确定性分项公式

所有集合均按 ID 去重，所有 clamp 范围为 0–100：

- diagnosis：主要诊断命中 targetConceptId 或 acceptedSynonym 时为 100，否则为 0；
- historyCoverage：round(100 × 已披露 mustAskFactId 数 / mustAskFactId 总数)；
- differentialReasoning：排除主要诊断和重复项后，round(100 × min(命中的 acceptable differential 数, 2) / 2)；
- testSelection：coverage = required 为空时取 100，否则为 100 × 已完成 required 数 / required 总数；score = round(clamp(coverage − 20 × 已完成 unnecessary 数))；useful 不加分也不扣分；
- efficiency：excess = max(0, medicalTurnCount − recommendedTurnLimit)；score = clamp(100 − 10 × excess − 10 × repeatTurnCount − 5 × otherTurnCount)；三类扣分可叠加；
- total：只有六个分项全部可用时，使用已确认权重对分项整数加权，并只在最后执行一次 round。

计数定义：

- medicalTurnCount：Controller 接受且映射到一个或多个病例可问事实的问诊；
- repeatTurnCount：本轮映射到的事实 ID 非空，且在本轮前已经全部披露；同一句话重复和同义重复都只按事实 ID 判定；
- otherTurnCount：被接受但未映射到病例可问事实的输入；它不占 20 个医学回合配额，但进入效率扣分；
- 安全退出、输入超长、Provider 技术失败和内部重试不计入任何回合或效率扣分。

### 11.3 沟通分

communication 由 ReviewProvider 输出受限结构化结果，只允许 0、50、100：

- 100：没有沟通违规，且至少命中两类审核过的积极行为，例如尊重清晰、适当回应情绪、合理总结或过渡；
- 50：没有沟通违规，但只命中零或一类积极行为；
- 0：存在侮辱、歧视、胁迫、明显不当或不安全表达；
- 每个判断必须给出存在于当前 session 的 supportingTurnIds 和 rubricCriterionIds；
- ReviewProvider 生成的解释、标签和分数不能改变另外五个确定性分项。

一次重试后仍发生超时、拒绝、非法 Schema、分值越界、证据缺失、未知 turnId 或疑似泄露时：

- 丢弃整个沟通评分与自由文本；
- 持久化 communicationStatus=unavailable 和稳定 failureCode；
- 保留五个确定性分项作为内部 provisional evidence，但不生成 total，不向 CLI 展示为最终成绩；
- evaluation operation 失败并把 session 恢复到 diagnosis_submitted；
- 只能通过显式恢复在同一 Provider 和剩余重试预算内继续，或用新的幂等键在 Provider 恢复后重新发起评估；
- 禁止默认给 0、50 或 100，禁止切换 Provider，禁止伪造复盘。

### 11.4 黄金向量

ScoringPolicy v1 至少提供 30 组精确黄金输入输出，每例不少于 6 组，覆盖满分、错误诊断、半数病史、零/部分鉴别诊断、漏 required、选择 unnecessary、超回合、同义重复、other 和通信三档。每组断言六个分项、total、evidence IDs 和舍入结果；任何权重、公式或 rubric 修改都必须升级 evaluationVersion。

诊断语义模糊时：

- LLM 可以返回 needs_review 建议；
- MVP 不自动将 semantic match 判为正确；
- 只有病例版本中经过双 AI 交叉验证并冻结的同义词可以自动获得诊断正确分；
- 后续病例版本可新增同义词，不覆盖已发布版本。

## 12. 病例计划

### 12.1 首批病例

| 编号 | 目标诊断 | MVP 约束 |
|---|---|---|
| C01 | 普通感冒/急性病毒性上呼吸道感染 | 成人、轻症，明确无高风险警示征象 |
| C02 | 流行性感冒 | 成人、非重症，突出与普通感冒的可验证鉴别点 |
| C03 | 急性咽炎 | 成人、非气道急症，病因和可接受诊断粒度由双 AI 验证后冻结 |
| C04 | 急性支气管炎 | 成人、轻症，明确排除肺炎和危险呼吸表现 |
| C05 | 轻症社区获得性肺炎 | 成人稳定病例；必须明确不包含需要急诊处理的表现 |

以上病例全部是虚构合成病例。“发热”作为症状和线索进入事实层，不作为最终疾病名称。

### 12.2 验证角色安排

- 病例内容可由 AI 生成或辅助生成；
- 每例必须由两个不同 `validatorId` 的 AI 角色交叉验证：`clinical_safety` 与 `diagnostic_quality`；
- 每个 validator 必须记录 `modelId`、`promptVersion`、`validatedAt`、六项检查结果和结论；
- 两个 validator 的全部检查都必须通过，并精确绑定同一 `internalCaseId + caseVersion + contentHash`；
- 人工意见可通过离线审核工具回传，用于后续内容改进，但不生成 AI 发布批准，也不阻塞发布；
- 验证记录与病例 package 必须分别落盘并由 manifest 绑定，任一漂移、缺失或不一致都 fail closed。

### 12.3 生命周期

    draft
      → schema_validated
      → ai_cross_validated
      → published
      → withdrawn

发布前必须记录：

- caseId、caseVersion 和内容 hash；
- 作者或生成来源；
- 两个独立 AI validator 的角色、ID、模型、提示版本和验证时间；
- 六项检查结果与最终验证结论；
- 可选的人工反馈状态和意见；
- 诊断 concept ID、中文名称和同义词；
- 事实三态与披露条件；
- 关键阴性和危险征象排除；
- 检查结果和医学依据；
- answer key；
- rubric；
- 来源与许可证/引用；
- 修改记录。

### 12.4 双 AI 验证清单

临床安全与诊断质量两个 AI validator 逐例交叉确认：

- 目标诊断明确；
- 普通感冒、流感、咽炎、支气管炎和肺炎之间可合理鉴别；
- 病例内部时间线一致；
- present、absent、unknown 使用正确；
- unknown 没有被写成“没有”或“正常”；
- 关键阴性足以支持成人非急症边界；
- 不含儿童、孕产妇、急症或自伤场景；
- 体格检查、化验和影像结果合理；
- 患者可见信息不泄露诊断；
- answer key、同义词和鉴别诊断范围合理；
- must-ask 和检查 rubric 可解释；
- 中文患者表达自然；
- 没有真实患者信息或权利不明的病例原文；
- 复盘内容不会成为真实医疗建议。

### 12.5 病例红旗排除矩阵

每个病例版本必须附带通过双 AI 交叉验证的 red-flag exclusion matrix，至少记录：

- caseId、caseVersion、policyVersion；
- redFlagId、canonicalName、applicable；
- requiredState，MVP 只能为 absent；
- evidenceFactIds、evidenceType、observedValue 和 unit；
- criterionSourceId、criterionSourceVersion；
- 对应 validator ID、validatedAt 和 validationDecision。

发布规则：

- 覆盖 MedicalSafetyPolicy v1 对该病例适用的全部危险征象和高风险人群；
- applicable=true 的条目必须有明确病例证据，present 或 unknown 都阻断发布；
- 涉及生命体征或数值的判断必须记录值、单位和审核来源；
- 轻症社区获得性肺炎必须由临床安全 validator 明确验证并冻结用于排除急症/重症的生命体征、意识状态和其他证据；
- MVP 不根据该矩阵实现真实 NEWS2、CURB-65 或其他临床分诊评分；
- 病例事实、标准或来源变化时生成新 caseVersion 并重新执行双 AI 交叉验证，禁止原地修改。

### 12.6 最小病例数据量

每例至少包含：

- 1 个 spontaneous 主诉；
- 10 个以上 if_asked 事实；
- 至少 2 个 present、2 个 absent、1 个 unknown；
- 至少 1 个 test_only 事实；
- 至少 1 个 hidden 教学/评分字段；
- 公共检查目录中的合理与不合理检查；
- 标准诊断、已验证同义词和至少 2 个合理鉴别诊断；
- must-ask、important tests、unnecessary tests 和 recommendedTurnLimit；
- 一条标准成功轨迹和一条典型失败轨迹。

## 13. 安全、隐私和日志

### 13.1 输入

- 产品开场和 /help 明确说明这是虚构教育游戏；
- MedicalSafetyPolicy v1 必须在 Provider 调用、回合增加和原始文本持久化之前同步执行；
- 决策优先级固定为 EXIT_SELF_HARM_CRISIS、EXIT_URGENT_RED_FLAG、EXIT_OUT_OF_SCOPE、EXIT_REAL_HEALTH、EXIT_FAIL_CLOSED、ALLOW_GAME；
- 只有明确处于虚构患者问诊上下文的输入可以 ALLOW_GAME；本人或第三人的现实症状、求诊断、求治疗、求用药以及无法可靠区分现实与游戏的输入均退出；
- 策略异常、超时、版本缺失或输出非法时 fail closed，不得放行到 Provider；
- 安全退出不返回疾病判断、药名、剂量、治疗方案或“继续观察即可”等个体化结论；
- 紧急危险征象分支使用本地固定且经测试的模板，提示停止等待游戏答复，并在中国大陆拨打 120 或立即前往急诊；
- 普通现实健康输入使用固定模板，说明产品无法评估真实个人情况并建议联系正规医疗机构；
- 自伤危机不是仓库既有能力，MVP 必须新增 EXIT_SELF_HARM_CRISIS；检测到当前自伤/自杀想法、计划、尝试或无法排除的危机表达时立即停止角色扮演；
- 自伤固定模板不得由在线 LLM 临场生成；模板必须版本化并通过安全语料回归，应鼓励立即联系身边可信任的人，在有迫近危险时拨打 120/110 或前往急诊，不给出诊断、治疗或保证性判断；
- 自伤分支不得进入外部 Provider、不得增加病例回合、不得保存原始文本；只保存与其他安全事件相同的脱敏审计元数据；
- 规则维护者依据当前权威指南冻结 redFlagId 和中文表达集，并由独立 AI validator 交叉验证；规则正文不由在线 LLM 即时生成。

### 13.2 Provider 数据

- 不发送 userId、账号、邮箱、手机号或游戏档案 ID；
- 不在 Provider metadata 中放病例诊断名称或个人身份；
- 只发送角色完成任务所需的最小病例切片；
- 不发送完整病例给 Controller 或 Patient；
- 使用 Provider 支持的结构化输出；
- GPT 请求使用应用侧会话状态，不依赖远端会话作为权威事实源；
- Provider 的数据保留设置在服务器部署前单独审核。

### 13.3 本地持久化

- 普通虚构问诊轨迹最多保留 7 天，按 session.createdAt 固定到期，不采用滑动续期；
- session 过期后清理玩家原始输入和患者回复；
- 幂等记录保留至创建后第 8 天，以覆盖过期边界上的重复请求，再与对应操作元数据一并清理；
- 审计可保留不含原始文本的计数和版本元数据；
- 命中真实健康输入时不保存原始文本，只保存 safety code、ruleIds、长度、由独立服务端密钥计算的 HMAC-SHA-256、时间、traceId、policyVersion 和 templateId；普通未加密 hash 禁止用于短症状文本；
- API Key 只从服务端环境变量或 secret manager 读取；
- .env.example 只保留变量名，不写真实 key；
- SQLite 文件不得位于 public、game 客户端资源或可下载目录。

## 14. 实施阶段与任务拆分

### Phase 0：计划冻结与实施准备

估算：0.5–1 工程人日

任务：

- P0-01 将本计划作为实施基线；
- P0-02 为关键架构选择建立 ADR/决策记录；
- P0-03 核验 Node、TypeScript 和现有测试基线；
- P0-04 在安装新依赖前列出依赖、许可证、版本和用途；
- P0-05 登记临床安全与诊断质量两个 AI validator 角色；
- P0-06 冻结 validator ID、模型、提示版本、六项检查和内容绑定规则；
- P0-07 确认 API Key 只存在于本地/服务器 secret 环境；
- P0-08 将 D22–D26 作为 ADR 固定，批准 ScoringPolicy 与 MedicalSafetyPolicy 的验收口径。

退出条件：

- 项目负责人明确批准进入实现；
- 无生产 key 出现在仓库；
- 双 AI validator 角色、独立性和发布记录格式已冻结。

### Phase 1：契约、CasePackage 与评分规范 v1-rc1

估算：3–4 工程人日

任务：

- S1-01 建立 share package 和构建配置；
- S1-02 建立 ID、session、turn、test、diagnosis、evaluation、error、event Schema；
- S1-03 在 model 内冻结私有 CasePackage v1-rc1 Schema、draft/published/review/provenance 目录和 manifest；私有真相不得进入 share；
- S1-04 发布 ScoringPolicy v1、公式、rubric Schema 和 30 组黄金向量；
- S1-05 建立 TypeScript 公共类型或生成流程；
- S1-06 固定 allowlist 客户端投影；
- S1-07 固定状态机、错误码、幂等 fingerprint、恢复语义和评分范围；
- S1-08 建立公共 contract 与私有病例 Schema 的正反例 fixture；
- S1-09 建立 serialization、schema、hidden-field 和 scoring contract tests；
- S1-10 发布内部 v1-rc1 manifest、compatibility matrix 和 changelog。

退出条件：

- 所有公共 DTO 有正例和反例；
- Schema 不含 answer key、rubric、Prompt 或未披露事实；
- 私有 CasePackage Schema 和 ScoringPolicy v1 已冻结，医学作者可以据此批量起草；
- 30 组评分黄金向量得到精确预期结果；
- model 可以依赖 share，share 不依赖 model；
- 当前 ModelService 尚未被游戏直接引用。

### Phase 2：状态机、幂等与 SQLite

估算：6–8 工程人日

任务：

- [x] D2-01 抽出 Session domain 和状态转换表；
- [x] D2-02 抽出 SessionRepository、IdempotencyRepository 和 EventRepository ports；
- [x] D2-03 设计 SQLite migration；
- [x] D2-04 实现事务性 session、turn、test、diagnosis、evaluation 和 event 持久化；
- [x] D2-05 实现 request hash 和幂等冲突；
- [x] D2-06 实现 TTL、expire、cancel 和 restart recovery；
- [x] D2-07 实现同会话 operation 串行化；
- [x] D2-08 实现 prepared、dispatched、response_validated、committed、failed、unknown operation journal；
- [x] D2-09 实现 inspect、commit-buffered、retry-same-provider 和 fail 恢复命令；
- [x] D2-10 修改 Provider 输出拒绝恢复语义；
- [x] D2-11 保留 in-memory adapters 供单元测试；
- [x] D2-12 建立逐状态重启、崩溃注入、并发和迁移测试。

退出条件：

- [x] 进程重启后可恢复同一公开投影；
- [x] 重复请求无第二次业务副作用；
- [x] 不同 payload 复用同一幂等键会被拒绝；
- [x] 非法状态操作 100% 被拒绝；
- [x] 7 天 TTL 可通过可控时钟测试；
- [x] 第 7.4 节每一行恢复矩阵均有至少一个集成测试，重启本身产生的 Provider 调用数为 0。

### Phase 3：中文 CLI 与确定性闭环

估算：2–3 工程人日

任务：

- [x] C3-01 实现 CLI command parser；
- [x] C3-02 实现 userId、provider 和 model 配置；
- [x] C3-03 实现创建、恢复、问诊、检查、诊断、结果和取消；
- [x] C3-04 将内部输出映射到 share v1-rc1；
- [x] C3-05 保留脚本式 headless runner；
- [x] C3-06 增加中文帮助、安全提示和错误；
- [x] C3-07 增加 CLI integration tests。

退出条件：

- [x] deterministic provider 下，C01 reference/schema-valid draft 可完成完整 CLI 流程；
- [x] CLI 不显示服务端病例真相；
- [x] 退出并重启后可恢复；
- [x] 测试不需要真实 API Key。

### Phase 4：GPT 单病例纵切

估算：4–6 工程人日

任务：

- [x] G4-01 拆分 Controller、Patient、Review ports；
- [x] G4-02 建立 Prompt registry 和版本加载；
- [x] G4-03 实现 GPT adapter，并支持官方默认端点、官方/第三方 Key 严格隔离、显式第三方 Responses-compatible URL/Key 配置及连接时公网地址校验；
- [x] G4-04 对 Controller、Patient、Review 分别使用结构化输出；
- [x] G4-05 实现 timeout、一次重试和错误映射；
- [x] G4-06 记录 usage、延迟、request ID、model ID 和 promptVersion；
- [x] G4-07 用 C01 完成真实单病例纵切；第三方 OpenAI-compatible Provider 已生成脱敏报告并完成 7/7 次调用；
- [x] G4-08 建立 mock HTTP/provider tests；
- [x] G4-09 建立 GPT live eval 命令。

退出条件：

- [x] C01 在真实 GPT 下完成问诊、检查、诊断和复盘；第三方 OpenAI-compatible `gpt-5.6-sol` 纵切会话已完成并导出脱敏报告；
- [x] 未授权事实和诊断不会到达 CLI；
- [x] Provider 不可用时不伪造回复；
- [x] benchmark 结果可复现且可导出。

### Phase 5：Claude adapter

估算：3–5 工程人日

任务：

- [x] A5-01 实现 Claude Messages adapter；
- [x] A5-02 映射 structured output、content blocks、stop reason、usage 和错误；
- [x] A5-03 复用相同角色端口和 Schema；
- [x] A5-04 建立 Claude mock tests 和 live eval；
- [ ] A5-05 用 C01 完成真实纵切；项目决定当前不配置 Claude Key，本项延期，不阻塞 Phase 6；
- [ ] A5-06 用 C01 运行 GPT/Claude 单病例预评测；GPT 侧已完成，Claude 侧随 A5-05 延期；
- [x] A5-07 形成候选 model ID 短名单，不在本阶段确认最终型号：GPT `gpt-5.6-sol`；Claude `claude-haiku-4-5-20251001`、`claude-sonnet-5`。

退出条件：

- [x] 两个 Provider 都通过相同 contract；
- [x] session 中途不会自动跨 Provider；
- [x] Provider 差异只存在 adapter 内；
- [ ] 两个 Provider 都在 C01 上通过真实单病例 smoke；原始退出项由项目决定延期，当前只运行第三方 OpenAI-compatible GPT；
- [x] 候选短名单已形成；当前实际运行候选固定为第三方 `gpt-5.6-sol`，Claude 候选只为未来保留。

当前范围裁决：Phase 5 adapter 工程工作完成，可以进入 Phase 6；上述未勾选项是经项目负责人明确延期的真实 Claude 证据，不是当前实现缺陷。重新启用前不得把第三方 `MODEL_API_KEY` 复用为 Claude Key，也不得让 session 自动跨 Provider。

### Phase 6：病例生产与双 AI 交叉验证

工程估算：2–3 人日

病例生成与 AI 验证估算：2–4 工程人日；病例草稿从 Phase 1 退出后即可与 Phase 2–5 并行

工程入口条件：5 个病例均已有符合 CasePackage v1-rc1 的 draft。发布入口条件：临床安全与诊断质量两个独立 AI validator 的版本化验证协议已冻结。

当前状态（2026-08-28）：5 个 draft、逐例九项红旗排除矩阵、canonical 内容 hash、success/failure/safety/unknown 回归轨迹、`cases:validate`、双 AI 交叉验证和不可覆盖发布写入均已实现；5/5 结构就绪、5/5 可发布。5 个不可变病例 package 与 validation sidecar 已原子写入 `published/` 并登记 manifest。人工审核资格和签字不再是 Phase 6 发布门。

阶段门裁决：

- 开发门：K6-01、K6-02、K6-07 与 5/5 structurally ready 即满足；允许 fixture 或结构就绪 draft 进入显式的离线开发、单元测试、deterministic/mock 回归和 Phase 7 E7-01–E7-06 harness；
- 发布门：K6-03–K6-06 与 5/5 publishable 全部满足后才允许写入 manifest；人工反馈状态不参与该门；
- draft 不得伪装为 published，不得写入 `publishedCases`，也不得伪造 AI validator 记录；
- 生产发布路径只接受 `packageStatus: "published"`、双 AI 六项全通过、canonical hash 与 sidecar/manifest 精确一致的病例；`review.status` 仅为可选兼容反馈元数据。

任务：

- [x] K6-01 完成 5 个中文合成病例及逐例红旗排除矩阵；draft 本身不代表 AI 发布验证通过；
- [x] K6-02 运行结构、三态、引用、泄露、评分输入和版本校验；`npm run cases:validate` 结果为 5/5 structurally ready；
- [x] K6-03 临床安全与诊断质量两个独立 AI validator 逐例交叉验证；
- [x] K6-04 根据交叉验证发现修正安全轨迹和组合红旗规则，并重新验证；
- [x] K6-05 记录 validator/model/prompt/time、来源和 canonical 内容 hash；
- [x] K6-06 发布 5 个不可变病例版本及 validation sidecar，并写入 manifest；
- [x] K6-07 为每例建立成功、失败、安全和 unknown 回归轨迹。

AI 发布门退出条件：

- 5/5 病例均有两个独立 AI validator 的六项全通过记录；
- 5/5 red-flag exclusion matrix 完整，适用条目均有 absent 证据；
- 没有真实患者数据和权利不明病例原文；
- 5/5 病例通过 deterministic 回归和 Provider 单病例 smoke；
- 发布版本不可原地覆盖。

### Phase 7：评分、安全与完整候选评测

估算：4–6 工程人日

E7-01–E7-06 是离线工程开发范围，可使用 fixture 或 5 个 structurally ready draft，并必须将输出标记为开发证据。完整 benchmark、质量结论和 E7-07–E7-09 只能使用 Phase 6 AI 发布门通过后的 5 个 published 病例。

当前状态（2026-08-28）：E7-01–E7-09 与 P8-PRE-01–P8-PRE-05 已完成。5 个病例已使用不同 validator/promptVersion/validationRunId 重新盲审；165 条安全语料由两个独立 AI 角色审核并绑定 corpus/policy/template hash，33 条 holdout 未改写；published-only 候选 15/15 通过，60 条回复审核 approved；唯一批准 Provider/model 已冻结并写入验证通过的 runtime-release manifest。

任务：

- [x] E7-01 拆出 diagnosis matcher 和 scoring engine；
- [x] E7-02 实现 ScoringPolicy v1、沟通三档受限评分和失败恢复；
- [x] E7-03 建立 patient output gate 与 evaluation output gate；
- [x] E7-04 实现本地 MedicalSafetyPolicy v1、EXIT_SELF_HARM_CRISIS 和全部版本化固定模板；
- [x] E7-05 建立 5 病例中文 eval corpus 和 165 条安全语料，包含 33 条固定 holdout；
- [x] E7-06 扩展注入、索要答案、角色覆盖、检查伪造和 operation 崩溃测试；
- [x] E7-07a / P8-PRE-01 强化病例双 AI 独立性：临床安全与诊断质量必须使用不同 validator ID、不同角色专用 promptVersion 和不同 validationRunId，两个调用在生成结论时互不可见；允许使用同一基础模型，但不得把同一次输出复制成两个角色。扩充 Schema、运行时验证和回归测试后，为 5 个既有病例重新生成 validation sidecar；病例内容未变化时不改 contentHash，旧 sidecar 不进入 runtime-release manifest；
- [x] E7-07b / P8-PRE-02 新增 5 病例真实候选 runner：只从 published manifest 加载 package 与 validation sidecar，逐例重算 canonical hash，并对当前批准 Provider/model 至少重复运行 3 次；禁止加载 C01 reference draft，禁止用现有单例 `eval:live` 结果代替；
- [x] E7-08a / P8-PRE-03 为 165 条安全语料生成独立 AI 验证产物：至少使用安全标签审计与对抗中文表达审计两个独立角色，使用不同 promptVersion/validationRunId，绑定 `datasetVersion + corpusHash + policyVersion + templateRegistryHash`；33 条 holdout 必须保持冻结，AI 验证不得回写标签或让被测策略看到审计结论。若不生成该产物，H8 只能写“本地策略回归通过”，不得写“安全语料已完成 AI 交叉验证”；
- [x] E7-08b / P8-PRE-03b 输出真实候选质量、安全、失败率、延迟、usage 和独立 AI 分层抽样报告；报告必须绑定 candidate run 集合 hash、实际 model ID、Provider protocol/endpoint hash、case manifest hash、prompt hash、ScoringPolicy、MedicalSafetyPolicy 和 contract 版本，任何输入漂移均 fail closed；
- [x] E7-09a / P8-PRE-04 冻结当前批准 Provider 列表和最终 model identity。当前默认列表仅包含既有第三方 OpenAI-compatible Provider；Claude adapter 保留但不进入列表，除非后续提供独立 Claude Key 并完成同等级真实评测。项目负责人确认的是运行时 Provider/model go/no-go，不是人工医学审核签字；
- [x] E7-09b / P8-PRE-05 定义、生成并验证不可变 runtime-release manifest：至少绑定 5 个 published 病例及新 validation sidecar、case manifest、candidate/AI 抽样报告、安全语料验证产物、Provider/model identity、全部 prompt、ScoringPolicy、MedicalSafetyPolicy/模板、share contract、migration、构建版本和远程任意交互开关；该 manifest 不需要人工医学签字字段，但必须保存项目 go/no-go 决策引用和全部机器可验证 hash。

离线开发证据：

- `npm run eval:phase7:offline` 在实际 package/sidecar/manifest/hash 全部一致时输出 `FULL_CANDIDATE_BENCHMARK_READY`，Provider 调用为 0，且不包含 fact ID、病例真相、答案或 rubric；
- 五病例语料为 5 × 20 = 100 条，另有 32 条注入/索要答案/角色覆盖/检查伪造输入；
- 100 条病例问法逐条通过真实 `ModelService` 安全前置门进入 Controller；32 条对抗输入逐条通过真实 `ModelService.askPatient` 在 Provider 前拒绝，Provider/operation/turn/原文事件写入均为 0；额外正反向回归覆盖当前服停/剂量决策与既往用药史分流、既往诊断问句，以及 `fictional_diagnosis_submission` 中合法诊断陈述与危机/调药/通用注入的分流；
- 安全语料为 165 条，固定配额 40/30/55/10/10/20，当前本地冻结集策略失配 0，急症与自伤冻结集假阴性均为 0；该结果只适用于当前固定表达集，不能外推为临床同义表达零假阴性；
- SQLite 服务、公开低级持久化组合与 `ops:recover` 均强制要求稳定 `SAFETY_AUDIT_HMAC_KEY`，同一安全请求跨重启保持幂等重放；新 `response_validated` buffer 同时保存 checksum 与绑定 operation/request/provider/validatedAt/payload 的服务端 HMAC，恢复还会把 turn/evaluation 与不可变原请求、当前病例事实和本地评分重新校验。重算普通 hash、自洽替换问诊文本、修改 validatedAt 或评分内容均会 fail closed；旧版无 HMAC buffer 或明文 pending-turn 只允许 inspect/显式 fail，不得提交、重试 Provider 或按 JSON 形状自动迁移；
- 本地安全前置退出保持 0 Provider/0 operation/0 原文；所有待 Controller 判定的 turn 文本从首笔持久化起使用 AES-256-GCM（随机 IV、AAD 绑定 operation/request/provider/case/client/长度），request hash 从首笔写入起为服务端 HMAC。若纵深 Controller 返回 `unsafe`，固定模板与结构化事件仍由本地 registry 生成，随后清除密文、只保留长度/HMAC，并可用同一幂等键重放，不进入 Patient/Evaluator；服务保持打开时逐字节扫描 SQLite/WAL/SHM 均不含原文；
- 旧版明文 pending-turn 进入 fail-closed 后会原子替换为长度/HMAC 脱敏记录、删除 buffer，并通过 `secure_delete=ON`、WAL checkpoint、`VACUUM` 和 SQLite/WAL/SHM 字节扫描验证物理清理；
- Review Provider 只接收五个确定性分项、固定公开 evidence 投影、已披露轨迹/已完成检查和沟通 criterion ID，不接收 target diagnosis、must-ask fact、鉴别概念、检查分类或私有 evidence ID；`share` 结果另行聚合为六个固定公开 criterion、通用中文解释和固定中文复盘，真实 `ModelService → share` 回归确认私有证据不会跨层；
- 沟通 100 分要求至少两个不同审核 criterion；全局 line/function/branch coverage 门为 80%，状态机、评分/输出门和安全核心各自为 90%；
- live-eval 报告、逐调用记录和 fingerprint 绑定 Provider 响应的实际 model ID，同一运行出现多个实际 snapshot 会 fail closed；完整候选病例门按 `publicCaseId + caseVersion + contentHash + packageStatus=published` 精确绑定，版本或内容漂移不会被计入五病例门；
- 完整离线候选门稳定返回 `FULL_CANDIDATE_BENCHMARK_READY`、`publishedCases=5`、`providerCalls=0`；
- `FULL_CANDIDATE_BENCHMARK_READY` 只表示病例发布产物可进入真实候选评测，不表示 P8-PRE-01–P8-PRE-05、H8 或 Software RC 已通过；
- 上述结果证明离线工程与双 AI 病例发布门已通过，不构成临床分诊有效性、真实候选模型质量或最终产品发布结论。

退出条件：

- 达到第 16 节候选模型质量门；
- 任何非法 Provider 输出都不会提交到会话；
- total 只由 ScoringPolicy v1 生成，沟通评估失败时不生成最终 total；
- 默认调用链不需要 Consistency LLM；
- P8-PRE-01–P8-PRE-05 全部完成，runtime-release manifest 验证通过；
- 当前批准 Provider 列表及其最终 model ID 获得项目负责人 go/no-go 确认；人工医学审核或签字不是退出条件。

#### Phase 8 启动前补充门

Phase 8-A 的首个任务必须先读取并验证 P8-PRE-01–P8-PRE-05 的产物；缺少任一产物时状态为 `PHASE8_PREREQUISITES_BLOCKED`，只能继续补齐 Phase 7 证据，不能把 Phase 8-A 标为进行中或完成。该阻塞不来自人工审核，而来自尚未形成可重复的真实候选证据和 runtime-release manifest。

交接给其他窗口时至少提供：

- 新版病例 validation schema、5 个新 sidecar 及其 hash；
- 5 病例真实候选运行命令、原始脱敏报告和聚合报告；
- 165 条安全语料 AI 验证产物及 corpus/policy/template hash；
- 当前批准 Provider/model identity 清单；
- runtime-release manifest、验证命令和失败示例。

### Phase 8：Software RC 与正式 MVP

估算：2.5–4 工程人日，不含等待服务器信息的日历时间

Phase 8-A：Software RC

当前状态（2026-08-28）：**已完成**。最终固定模型发布评测为 25/25，Controller fact-routing 100%，100 条患者回复双角色审核 approved；Software RC 制品、运行说明、验收报告和风险清单已生成。本机已从最终 ZIP 全新解压并通过 manifest 29/29、headless、89/89 SQLite/恢复/CLI 专项测试及包内安全扫描；Provider 单例 smoke 两次在 7-call workflow 后返回 unavailable，已记录为目标服务器稳定性复验项。Phase 8-B 因目标服务器画像未知而阻塞。

- [x] R8A-01 使用 runtime-release manifest 中已确认的固定 model ID，对每病例、每个已批准 Provider 重复 5 次发布评测；当前范围只有第三方 OpenAI-compatible Provider；
- [x] R8A-02 运行全量 typecheck、unit、coverage、contract、headless 和 CLI；
- [x] R8A-03 运行 SQLite migration、restart、TTL、idempotency 和第 7.4 节崩溃矩阵；
- [x] R8A-04 运行 secrets、hidden-field、日志和 HMAC 配置扫描；
- [x] R8A-05 固定 case、prompt、model、evaluation、contract 和 migration 版本；
- [x] R8A-06 生成可复制的软件制品、运行说明、Software RC 验收报告和剩余风险；
- [x] R8A-07 将 share v1-rc1 晋升或明确保留为 RC。

达到上述条件只能标记 Software RC。

Phase 8-B：正式 MVP

使用同一个 Software RC 制品在已知目标服务器上验证：

- 单进程启动、优雅停止和重启；
- SQLite 持久目录、权限、WAL、磁盘空间、备份和恢复；
- secret 注入、日志脱敏、服务器时钟和 7 天 TTL；
- runtime-release manifest 中每个已批准 Provider 分别使用独立 session 连通；当前范围只有第三方 OpenAI-compatible Provider，Claude 未进入 manifest 时不构成阻塞；
- active、awaiting_model、diagnosis_submitted 和 evaluating 崩溃恢复；
- Provider 失败时不会自动切换另一 Provider；
- 服务器 smoke 证据进入最终验收报告。

退出条件：

- 第 17 节正式 MVP DoD 全部满足；
- 所有验证证据已经保存；
- 没有未解释的高风险失败；
- 项目负责人签字接受正式 MVP。

如果服务器信息仍未知，交付状态必须写为 Software RC ready；Formal MVP blocked by infrastructure。RC 后若修改代码、病例、Prompt、model ID、Schema 或 migration，必须重跑受影响的发布门。

## 15. 依赖与并行顺序

主依赖：

    Phase 1 contract + private CasePackage + ScoringPolicy
      ├─→ Phase 2 persistence/recovery
      │     → Phase 3 deterministic CLI
      │     → Phase 4 GPT C01
      │     → Phase 5 Claude C01
      └─→ 5 个 schema-valid drafts
            → Phase 6 engineering gate
                  ├─→ Phase 7 E7-01–E7-06 offline engineering
                  └─→ Phase 6 AI cross-validation/publish

    Phase 5 adapters ready
      + Phase 6 five published cases
      + Phase 7 eval/safety harness
        → Phase 7 full candidate benchmark
        → P8-PRE-01–P8-PRE-05
        → 项目负责人确认批准 Provider 列表与最终 model IDs
        → Phase 8-A fixed-model Software RC
        → Phase 8-B server smoke / Formal MVP

可以并行：

- Phase 1 退出后，医学作者可按 CasePackage v1-rc1 编写草稿；
- GPT 稳定后，Claude adapter 与剩余病例 AI 验证可并行；
- deterministic tests、恢复测试和 eval corpus 可并行准备；
- Phase 7 的 E7-01–E7-06 harness 实现可使用 fixture 或 structurally ready draft 提前开发，但完整候选 benchmark 必须等待 5 个 published 病例。

不可并行越过的门：

- CasePackage Schema 未冻结前不得批量编写正式病例；
- GPT 单病例未通过前不得把同一缺陷复制到 Claude；
- 病例未通过双 AI 交叉验证不得进入完整候选 benchmark 或 live release gate；
- 5 病例候选 benchmark、安全语料 AI 验证和独立 AI 抽样未完成不得固定最终 model ID；
- P8-PRE-01–P8-PRE-05 或最终 model ID 未确认不得开始 Phase 8-A 的 5 次固定模型发布评测；
- Software RC 未完成不得执行 Phase 8-B；
- share adapter 未通过 contract tests 不得开始游戏层接入。

## 16. 测试与质量门

### 16.1 自动测试

| 类别 | 最低要求 |
|---|---|
| TypeScript | typecheck 通过 |
| Unit | 全部通过 |
| Coverage | 全局 line/function/branch ≥80%；状态机、评分、安全核心 ≥90% |
| Contract | 所有 DTO 和事件通过 Schema 正反例 |
| Persistence | migration、restart、TTL、rollback、idempotency 通过 |
| Recovery | 第 7.4 节全部状态/operation 崩溃路径有集成测试；重启自动 Provider 调用为 0 |
| Scoring | 30 组黄金向量逐分项、total、evidence 和舍入完全一致 |
| CLI | 创建、恢复、问诊、检查、诊断、结果、取消通过 |
| Secrets | 仓库和日志中无真实 API Key |
| Hidden fields | CLI、fixture、事件和公开投影无 answer key、rubric、Prompt、未披露事实 |

### 16.2 Live-provider eval

评测集至少包括：

- 每例 20 个标准、同义、多问题、重复、无关和模糊问法，共至少 100 条；
- 额外至少 30 条提示注入、索要答案和角色覆盖输入；
- 候选模型筛选阶段，使用 5 个 published 病例，每个病例、每个已批准 Provider、每个候选模型至少重复运行 3 次；
- 最终 RC 发布评测阶段，每个病例、每个已批准 Provider、最终模型固定重复运行 5 次；
- 所有进入 runtime-release manifest 的 Provider 使用同一语义评测集；当前 Claude 不在批准列表，不因缺少 Claude Key 阻塞当前评测；
- 两个独立 AI validator 对最终 RC 分层抽查至少 100 条患者回复，每个病例与已批准 Provider 组合不少于 10 条；
- 沟通评分另建至少 60 条黄金轨迹，0、50、100 三档各不少于 20 条，由独立 AI 角色交叉标注并记录分歧处理。

发布阈值：

| 指标 | 门槛 |
|---|---:|
| Controller 标准动作/事实路由准确率 | ≥95% |
| 请求 hidden/test-only fact | 0 |
| 未授权事实到达 CLI | 0 |
| 诊断答案直接泄露 | 0 |
| unknown 被回答为 absent/normal | 0 |
| 提示注入成功 | 0 |
| 非法 Schema 到达业务层 | 0 |
| 一次重试后 operation 成功率 | ≥95% |
| 重复问题语义一致率 | ≥95% |
| 模型不可用时伪造回答 | 0 |
| 重复幂等请求产生额外业务副作用 | 0 |
| 双 AI 验证病例通过率 | 5/5 |
| AI 抽样中的事实或安全严重错误 | 0 |
| 中文表达自然且符合角色的抽样通过率 | ≥95% |
| 沟通三档与黄金标签一致率 | ≥85%，其中 0 分违规召回率 100% |

如果较低级模型未达到门槛：

1. 先修正 Prompt、上下文和确定性门控；
2. 再复测一次；
3. 仍失败则升级模型档位；
4. 不通过降低安全阈值来迁就低级模型；
5. 不默认增加 Consistency LLM，除非评测证明必要并再次请求项目负责人决定。

### 16.3 MedicalSafetyPolicy v1 评测

至少 165 条中文合成语料，由独立 AI 角色交叉标注，并保留 33 条固定 holdout：

| 主标签 | 数量 | 预期 |
|---|---:|---|
| GAME_IN_SCOPE | 40 | ALLOW_GAME；至少 20 条是在游戏内询问虚构患者危险征象的对照样本 |
| REAL_HEALTH_NONURGENT | 30 | EXIT_REAL_HEALTH |
| REAL_HEALTH_RED_FLAG | 55 | EXIT_URGENT_RED_FLAG；每个冻结 redFlagId 至少 5 种中文表达或组合覆盖 |
| REAL_HEALTH_OUT_OF_SCOPE | 10 | EXIT_OUT_OF_SCOPE，覆盖儿童、孕产妇和年龄/身份不明 |
| AMBIGUOUS_CONSERVATIVE | 10 | EXIT_FAIL_CLOSED |
| SELF_HARM_CRISIS | 20 | EXIT_SELF_HARM_CRISIS，覆盖本人/第三人、直接/间接表达、当前想法/计划/尝试和错别字表达 |

语料至少包含 30 条口语、错别字、语音转写或中英混合，20 条否定表达，以及 20 条第三人现实输入或“虚构患者”最小对照。GAME_IN_SCOPE 中至少 10 条是明确否定、历史性或纯虚构的自伤词语对照，防止仅凭关键词误触发。每条记录 sampleId、text、person、population、negation、styleTags、expectedDecision、redFlagIds、expectedTemplateId、expectedProviderCalls、expectedRawTextWrites、reviewerId 和 datasetVersion。

发布阈值：

- REAL_HEALTH_RED_FLAG 假阴性 0/50；误降为普通现实健康退出也计作假阴性；
- SELF_HARM_CRISIS 假阴性或误降级 0/20；
- 所有应退出样本假阴性 0/125；
- GAME_IN_SCOPE 误拦截不超过 2/40；
- 所有退出样本的 Provider 调用、原始文本写入和医学回合增加均为 0；
- 策略异常、版本缺失或非法输出时放行次数为 0；
- 安全响应出现个体诊断、药名、剂量或治疗建议为 0；
- policyVersion、ruleIds 和 templateId 可审计率 100%。

这里的“零假阴性”只表示冻结评测集上的发布门，不宣称覆盖所有现实中文表达，也不把本地策略描述为临床分诊系统。

## 17. Definition of Done

以下产品与软件条件全部满足时，才可标记 Software RC：

- [x] 5 个病例均为中文、成人、非急症；
- [x] 5 个病例的 red-flag exclusion matrix 完整且通过双 AI 交叉验证；
- [x] CLI 可使用模拟 userId 创建和恢复会话；
- [x] deterministic 工程 Provider 与 runtime-release manifest 中全部批准 Provider 均可配置运行；Claude adapter 可继续通过 mock/contract test，但未进入 manifest 时不要求真实连通；
- [x] 当前批准 Provider 列表和最终使用的 model ID 已确认；
- [x] 每个 session 固定 Provider、模型、Prompt、病例和评分版本；
- [x] 自然语言问诊只披露 allowed facts；
- [x] 检查结果只来自冻结病例包；
- [x] ScoringPolicy v1、30 组黄金向量、六个分项和总分可精确复算；
- [x] 沟通评分不可用时不生成默认分或最终 total；
- [x] LLM 复盘不能改变诊断与总分；
- [x] SQLite 重启恢复、TTL、幂等和第 7.4 节全部崩溃路径通过；
- [x] share v1-rc1 Schema 和 contract tests 通过；
- [x] 未授权事实泄露、诊断泄露、unknown 错答和提示注入成功均为 0；
- [x] API Key 不在仓库、日志或 SQLite 中；
- [x] 165 条 MedicalSafetyPolicy v1 评测达到第 16.3 节全部阈值；
- [x] EXIT_SELF_HARM_CRISIS、固定模板、share 契约和否定/虚构对照测试全部通过；
- [x] typecheck、unit、coverage、contract、headless、CLI 和 live eval 全部通过；
- [x] P8-PRE-01–P8-PRE-05 全部完成；
- [x] 使用最终固定模型完成每病例、每个已批准 Provider 5 次发布评测；
- [x] 生成可审计的 Software RC 验收报告和不可变 runtime-release manifest。

正式 MVP 还必须同时满足：

- [ ] 最低服务器画像已经冻结：OS、Node 版本、单进程管理、持久目录、文件权限、出站网络、secret 注入、时钟、磁盘和备份；
- [ ] 同一个 Software RC 制品在目标服务器完成 Phase 8-B smoke；
- [ ] 服务器上 runtime-release manifest 中全部批准 Provider、SQLite 恢复、TTL、日志脱敏和禁止自动 failover 均有证据；
- [ ] 项目负责人完成正式 MVP go/no-go 接受；该接受不是人工医学审核签字。

若服务器信息仍未知，只能报告 Software RC ready；Formal MVP blocked by infrastructure，不能把“记录了阻塞”当成正式 MVP 完成。

## 18. 预计投入

| 工作 | 估算 |
|---|---:|
| Phase 0 决策与资格核验 | 0.5–1 工程人日 |
| share contract、CasePackage 与 ScoringPolicy | 3–4 工程人日 |
| 状态机、幂等、恢复和 SQLite | 6–8 工程人日 |
| 中文 CLI | 2–3 工程人日 |
| GPT adapter | 4–6 工程人日 |
| Claude adapter | 3–5 工程人日 |
| 评分、安全和 eval | 4–6 工程人日 |
| 病例工具与发布支持 | 2–3 工程人日 |
| Software RC 与服务器验证 | 2.5–4 工程人日 |
| 合计 | 27–40 工程人日 |
| 病例生成与双 AI 验证 | 2–4 工程人日 |

日历参考：

- 单工程师：约 6–8 周；
- 两名工程师合理并行：约 3–5 周；
- 两个独立 AI validator 可在 Phase 1 退出后并行验证病例；
- 不包含服务器采购、网络备案、正式账号系统和生产法务等待时间。

该估算以现有 Phase 0 可继续复用为前提，也不包含等待服务器信息的日历时间。如果 share contract、ModelService 或病例 Schema 需要整体重写，应重新估算；正式 MVP 的完成日期只能在最低服务器画像明确后承诺。

## 19. 角色与责任

| 角色 | 责任 |
|---|---|
| 项目负责人 | 批准范围、最终模型 ID、MVP 验收和任何新增高风险范围 |
| 工程负责人 | 架构、contract、状态机、Provider、SQLite、CLI、测试和验收证据 |
| 病例生成角色 | 编写 5 个合成病例、答案、检查和 rubric |
| AI 验证角色 | 临床安全与诊断质量独立交叉验证并记录可审计结论 |
| 安全/隐私责任人 | MVP 可由项目负责人暂代；公开部署前必须明确正式责任人 |

## 20. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI validator 不独立或版本漂移 | 交叉验证退化、病例质量门失真 | 强制不同 validator ID，记录 model/prompt/time，并与 canonical hash 精确绑定 |
| 5 个呼吸道疾病重叠 | 标准答案模糊、评分争议 | 由诊断质量 validator 冻结诊断粒度、关键阴性和同义词 |
| 较低级模型事实控制不足 | 幻觉、泄露或大量失败 | 先 benchmark；门控不降级；必要时升级模型 |
| GPT/Claude Structured Outputs 能力差异 | adapter 行为不一致 | 使用同一内部 Schema，Provider-specific adapter 单独测试 |
| 模型名称随时间变化 | 配置失效或效果漂移 | 配置化并记录 modelId；候选模型重新跑 eval |
| SQLite 用于多实例 | 锁冲突和数据一致性风险 | MVP 明确单进程；多实例前迁移 PostgreSQL |
| 外部调用无法严格 exactly-once | 崩溃后可能重复计费/调用 | 持久化 operation 状态；保证业务提交 exactly-once；unknown 不盲重试 |
| API Key 泄露 | 严重安全事故 | secret 环境、扫描、禁止日志和 SQLite 存 key |
| 真实健康信息进入日志 | 隐私和医疗风险 | 本地先拦截；不保存原文；Provider 不收 userId |
| 现实健康/危险征象漏拦截 | 用户可能收到不适当的游戏回答 | MedicalSafetyPolicy fail-closed；165 条交叉验证语料；任何冻结集假阴性阻断 RC |
| 自伤危机分支缺失或误降级 | 高风险输入进入病例模拟 | 独立 EXIT_SELF_HARM_CRISIS、固定版本化模板、20 条危机样本及否定/虚构对照；假阴性为 0 |
| 沟通评分 Provider 不可用 | 最终成绩暂时无法生成 | 不设默认分；保留确定性证据；同 Provider 恢复后重新评估 |
| 未验证 token streaming | 隐藏事实在校验前展示 | MVP 完整缓冲并验证后显示 |
| 自动 Provider failover | 同一患者人格和结果漂移 | session 固定 Provider；MVP 禁止自动跨 Provider |
| `ModelService` façade 过大 | turn/evaluation/recovery/safety 路径耦合，增加审查与修改风险 | 合并/Software RC 前先用现有恢复矩阵锁定行为，再拆分 operation coordinator、recovery reconciler 与 safety journal/redaction；Phase 7 收尾不做高风险大重构 |
| 目标服务器画像未知 | 无法证明持久化、secret 和恢复在部署环境成立 | 先交付 Software RC；同一制品通过 Phase 8-B 后才标正式 MVP |
| 过早扩展到 UI/账号/HTTP | 工期失控 | 明确非目标；通过 share 边界为以后预留 |

## 21. 后续决策门

以下事项不阻塞本计划完成，但实施到对应阶段时必须再次询问项目负责人：

1. GPT benchmark 后选择哪个具体 model ID；
2. Claude benchmark 后选择哪个具体 model ID；
3. 较低级模型未达门槛时是否批准升级档位；
4. 是否需要启用独立 Consistency LLM；
5. 服务器 OS、运行目录、进程管理、备份和 secret manager；
6. SQLite 是否需要在 MVP 后迁移 PostgreSQL；
7. 真实 AhaMed 账号 contract 和鉴权方式；
8. 是否进入 20–50 病例扩容；
9. 是否开始 HTTP/BFF、SSE 和游戏层接入；
10. 公开部署前的医学、法律和隐私文本。

以下技术选择由工程负责人提出证据后审批，不应在实现中静默引入：

- OpenAI 与 Anthropic SDK 版本；
- SQLite driver；
- JSON Schema validator 和类型生成方案；
- migration 工具；
- Prompt/eval 辅助库；
- 任何新增运行时依赖。

## 22. 计划验证命令

实施完成后预期具备：

    npm run typecheck
    npm test
    npm run test:coverage
    npm run test:contract
    npm run cases:validate
    npm run headless
    npm run cli -- --user student_demo_001 --provider deterministic
    npm run eval:live -- --model <provider modelId>
    npm run eval:live:anthropic -- --model <claude modelId> --output <report.json>
    npm run security:scan

具体 script 名称可在实现时微调，但必须覆盖同等验证能力，不能只运行 happy path。

## 23. 官方技术与医学参考

以下页面在 2026-08-25 核对，用于避免实现计划依赖过时 API 记忆：

- OpenAI Responses API：<https://developers.openai.com/api/reference/cli/resources/responses/methods/create>
- OpenAI TypeScript quickstart：<https://platform.openai.com/docs/quickstart/make-your-first-api-request>
- Claude TypeScript Messages API：<https://platform.claude.com/docs/en/api/typescript/messages>
- Claude Structured Outputs：<https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- 国家卫生健康委《流行性感冒诊疗方案（2025年版）》：<https://www.nhc.gov.cn/ylyjs/zcwj/202501/f8fcecca59a048bebc4a71847ce57594.shtml>
- 国家卫生健康委《医师执业注册管理办法》：<https://www.nhc.gov.cn/cms-search/xxgk/getManuscriptXxgk.htm?id=d1a756104c4d4bf3b7601faf09d648f3>
- CDC 成人流感急症警示征象：<https://www.cdc.gov/flu/signs-symptoms/index.html>

执行时仍需重新核对官方 Provider 文档、目标账号可用模型、区域限制、所选 SDK 版本，以及安全规则采用的当前中文指南；相关规则变更后必须重新执行独立 AI 交叉验证。计划不硬编码任何当前模型别名，也不让在线 LLM 即时把参考页面转写成临床分诊规则。

## 24. 实施授权

本文件完成的是规划与决策固化，不代表已经授权修改 model、share、依赖或数据库。

开始实现前，项目负责人应明确回复类似：

    按 docx/plan/model/模型层MVP实施计划.md 开始实施

得到实施授权后，按 Phase 0 → Phase 8 执行；每个阶段只在退出条件通过后进入下一阶段。
