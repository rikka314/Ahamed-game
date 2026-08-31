# 模型层独立项目边界

> 当前基线（2026-08-29）：可玩问诊只使用真实 OpenAI-compatible Patient Agent v0.4；每轮传入完整已提交对话历史。患者显示名仅是场景称呼或姓氏提示；医疗事实与显式年龄/性别锚点服从病例，未提供的姓名、家庭、住址和普通日常经历由 AI 合理补全并跨轮保持一致。患者不得用“病例没有说明”“资料未提供”等幕后话术回避。本地不使用固定问答、关键词路由、病例诊断词表或患者话术重渲染。Patient AI 在同一次调用中判断玩家是否已明确提交唯一主诊断：肯定的单一主诊断或清晰的“主诊断 + 鉴别诊断”会启动服务端评分，多病并列无主次、疑问和不确定讨论继续对话。AI 只提取玩家本轮原话中的诊断意图，不判断正确性；本地门禁校验提取词确实来自原话，最终正确性仍由确定性评分器判断。模型层全量测试 331/331，覆盖率门全部通过；真实 `gpt-5.6-sol` 已验证三条诊断分支和非医疗角色历史一致性。旧 C6/C7 runtime manifest 与 Software RC 早于本次纠偏，仅作历史证据，需按当前源码重新生成后才能恢复发布资格。

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
- Patient Agent、Evaluator 等模型职责和提示词版本；Controller 只保留历史兼容实现。
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
- 把未通过冻结版本双 AI 交叉验证的实时生成病例直接发布给玩家。

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
│  ├─ draft/                    未审核草稿；C01 reference 仅供受控工程纵切
│  └─ fixtures/                 只用于开发/测试的合成病例
├─ prompts/
│  ├─ controller/               动作分类提示词版本
│  ├─ patient/                  受控患者提示词版本
│  └─ evaluator/                结构化评分提示词版本
├─ src/
│  ├─ adapters/                 内部结果到 share v1-rc1 的显式映射
│  ├─ application/              会话、问诊、检查、诊断编排
│  ├─ cli/                      中文内部评测 CLI、配置和命令解析
│  ├─ domain/                   服务端病例结构与稳定错误
│  ├─ evaluation/               可替换的评估实现
│  ├─ headless/                 无游戏客户端的完整闭环 runner
│  ├─ observability/            结构化事件 sink
│  ├─ ops/                      持久化检查与显式恢复命令
│  ├─ persistence/              repository ports、内存与 SQLite 适配器
│  ├─ providers/                模型 provider port、真实 adapter 与测试替身
│  ├─ repositories/             病例 repository port 与内存/文件适配
│  └─ safety/                   注入识别与输出门控策略
├─ tests/                       unit + headless/CLI integration tests
├─ package.json
└─ tsconfig.json
```

`src/application/` 承担基线文档中的 orchestration 职责。`share/` 已发布 `@ahamed/doctor-game-share@1.0.0-rc.1`，模型 package 通过本地 package dependency 运行共同的 Schema/hidden-field contract gate。Phase 3 已在 `adapters/` 中完成 CLI/public DTO 显式映射；application DTO 仍是内部形状，游戏层不能直接 import 这里的内部类型。

## 开发命令

在 `model/` 内执行：

```bash
npm install
npm run typecheck
npm test
npm run test:coverage
npm run test:contract
npm run cases:validate
npm run eval:phase7:offline
npm run headless
npm run cli -- --user student_demo_001 --provider openai --model <model-id>
npm run eval:live -- --model <model-id> --output ./var/openai-c01-report.json
npm run eval:live:anthropic -- --model <model-id> --output ./var/anthropic-c01-report.json
npm run ops:inspect -- --help
npm run ops:recover -- --help
```

CLI 默认将 SQLite 写入 `model/var/model-cli.sqlite`，也可用 `--database` 或 `AHAMED_MODEL_DATABASE_PATH` 指定。交互式 CLI 只接受 `openai` provider，并从 `OPENAI_API_KEY` 或成对的 `MODEL_BASE_URL + MODEL_API_KEY` 创建真实 Responses-compatible Patient Agent；必须显式提供模型 ID。`deterministic` 只保留为自动化测试替身，不能通过 CLI 进入可玩对话。会话中途不会自动切换 Provider。

任何使用 SQLite 的 CLI/服务或 `ops:recover` 启动都必须由运行环境注入至少 32 字符的 `SAFETY_AUDIT_HMAC_KEY`。该密钥必须跨重启保持稳定，用于安全退出与 turn 幂等 fingerprint、待 Patient Agent 处理文本的 AES-256-GCM 域分离密钥，以及 `response_validated` buffer 的服务端 HMAC 完整性标签；不得提交到仓库。`ModelPersistence.requiresStableIntegrityKey` 会阻止公开低级构造方式绕过该要求。现阶段如需轮换密钥，必须先完成显式数据迁移或清理对应开发数据库，不能在已有持久化数据上静默更换。

`eval:live` 会自动读取被 `.gitignore` 排除的 `model/.env`。官方 OpenAI 配置：

```dotenv
OPENAI_API_KEY=replace-with-server-secret
AHAMED_MODEL_ID=replace-with-model-id
```

官方 Anthropic Messages 配置仅为未来预留，当前 MVP 不配置也不运行：

```dotenv
# ANTHROPIC_API_KEY=replace-with-server-secret
# AHAMED_MODEL_ID=replace-with-claude-model-id
```

Anthropic adapter 固定到官方 `https://api.anthropic.com`，忽略 `ANTHROPIC_BASE_URL`，并关闭 SDK 自动重试；如未来启用在线问诊，使用与 OpenAI 相同的当前 Patient Agent 输入输出契约，最终评分仍使用 Review。它保持为离线验证通过的可选 adapter，不会读取或复用当前第三方 `MODEL_API_KEY`，也不会进入当前 MVP session。若未来重新启用真实 C01，必须另行批准并配置独立 `ANTHROPIC_API_KEY`。

第三方 OpenAI Responses-compatible API 必须使用独立的 Provider 配置，不能复用 `OPENAI_API_KEY`：

```dotenv
MODEL_BASE_URL=https://provider.example/v1
MODEL_API_KEY=replace-with-third-party-secret
AHAMED_MODEL_ID=replace-with-provider-model-id
```

`OPENAI_API_KEY` 只允许用于官方端点，`MODEL_API_KEY` 只允许与非官方 `MODEL_BASE_URL` 成对出现，错配时会在网络请求前失败。`MODEL_BASE_URL` 必须是公开 HTTPS API 根地址，不能包含用户名密码、query、fragment、尾点主机名，也不能指向 localhost、私网或链路本地地址；运行时会调用 `<MODEL_BASE_URL>/responses`。第三方连接使用不继承系统代理的直接 HTTPS、强制 TLS 证书校验，并在实际 socket DNS lookup 中拒绝任何私网/本地解析结果及自动重定向。`OPENAI_BASE_URL` 明确忽略，防止官方 OpenAI Key 被常见 SDK 环境变量重定向；OpenAI organization/project 环境头也不会发送给第三方。第三方必须实际支持 Responses API、strict JSON Schema Structured Outputs、`store=false` 和 Bearer Key；只兼容 Chat Completions 的服务不能直接使用此 adapter。

## Phase 2 会话与持久化

- `SessionAggregate` 以共享状态机作为唯一合法转换规则，固定会话 TTL 为创建后 7 天；后续写入不会延长 TTL。
- `ModelPersistence` 定义 session、idempotency、operation journal 和 audit event 端口；默认服务使用内存适配器，`createSqliteModelService` 使用 Node 内置 SQLite。
- SQLite 启用 foreign keys、WAL、`synchronous=FULL` 和 busy timeout；当前 Schema migration 为 v6，可从 v1/v2/v3/v4/v5 原位升级。会话持久化连续离题计数、待确认检查和最近 interaction kind；回合持久化病例/人格/已完成检查引用与 `effects`。历史轮次和幂等响应缺少 `effects` 时按空数组读取，旧 validated operation buffer 仍可恢复。会话、回合、检查、诊断、评估、幂等记录、操作日志与只追加审计事件在本地事务内原子提交；事实和检查使用显式 ordinal 保持重启前后的公开投影顺序。
- 创建会话必须提供可信的 `idempotencyScopeId`；该值同时作为当前本地 MVP 的模拟 `userId` 持久化。它应由未来 BFF/CLI 注入，不能从未经验证的客户端字段直接信任。
- 同一 session 的写操作由 keyed serial executor 串行执行。相同幂等键和相同 payload 只在允许重放的会话状态返回原结果；相同键但不同 payload 返回 `IDEMPOTENCY_CONFLICT`，终态不会被旧 turn/test 结果绕过。
- 模型调用不跨数据库事务。操作日志记录 `prepared → dispatched → response_validated → committed`，失败时记录 `failed`；重启发现已派发但未验证的调用时转为 `unknown`，不会自动再次调用 provider。
- 每个 `ModelProvider` 必须声明完整 identity，服务只从 provider 本身固定 provider/model/prompt 版本；每次调用都接收稳定 `operationId`。provider 返回达到或晚于固定 TTL 时不会提交；已验证后的本地事务失败仍保留 `response_validated`。
- 新 turn 的 request hash 从第一笔写入起就是服务端 HMAC；待 Patient Agent 处理的文本使用 AES-256-GCM 加密，随机 96-bit IV，AAD 绑定 operation/session/idempotency/HMAC、Provider/model/prompt/case、client ID 和长度。执行与显式恢复只在内存中解密；通过本地安全前置门与 Patient 输出门后才允许进入 validated buffer 和正常病例回合。因此 SQLite 主文件、WAL 和 SHM 不会出现失败请求的原文。
- 启动恢复对已验证缓冲只做本地提交，对 `unknown` 操作要求显式运维恢复。每个新缓冲同时保存 checksum 与服务端 HMAC；HMAC 绑定 operation/session/idempotency/request hash、Provider/model/prompt/case、buffer kind、验证时间和 payload。提交时还会把 turn/evaluation payload 与不可变原请求、病例事实和本地评分重新绑定校验；旧版无 HMAC 缓冲或明文 pending-turn 只允许检查或显式标记失败，不能提交、重试 Provider 或按 JSON 形状自动迁移。恢复使用短期数据库 lease，并在回写时同时校验 fencing token 与 attempt，阻止旧 writer 覆盖新尝试；恢复决策以 append-only `operation.recovery_decided` 事件记录 action、operator、reason 与前后状态。
- SQLite 读取会验证枚举、日期、JSON 形状和 operation buffer；同步事务拒绝 async callback，逃逸的 transaction handle 在作用域结束后不可继续使用。
- 病例 repository 同时保留同一 `publicCaseId` 的全部冻结版本；新会话使用当前版本，旧会话始终按固定 `caseVersion` 恢复。Evaluator 输出经过严格字段白名单、范围、证据引用和版本校验，最终分项与 total 由本地 `ScoringPolicy v1` 重算并重建后才可缓冲。
- 外部 event sink 只作为事务提交后的观察者；同步抛错和异步 rejection 都被隔离，SQLite 审计事件仍是权威记录。

SQLite 服务示例：

```ts
const service = createSqliteModelService({
  databasePath: "./var/model.sqlite",
  cases: [reviewedCasePackage],
  safetyAuditHmacKey: process.env.SAFETY_AUDIT_HMAC_KEY!,
});

const created = await service.createSession({
  idempotencyScopeId: "local-user-fixture",
  clientRequestId: "create-001",
  publicCaseId: "case_fixture_001",
  patientNpcId: "npc_fixture_patient",
});
```

运维检查以 read-only SQLite 连接打开已有文件，默认只输出脱敏摘要，不输出问诊文本、诊断内容或 validated buffer payload，也不会因路径拼错创建空数据库：

```bash
npm run ops:inspect -- --database ./var/model.sqlite --session <session-id>
npm run ops:inspect -- --database ./var/model.sqlite --operation <operation-id>
```

恢复操作必须先停掉普通写入服务，并指定唯一动作、操作者和原因：

```bash
npm run ops:recover -- --database ./var/model.sqlite --operation <operation-id> \
  --commit-buffered --operator <operator-id> --reason "validated local commit"
```

`--retry-same-provider` 仅支持当前确定性 MVP provider identity，并受恢复 lease 与两次派发尝试上限约束。真实 provider 接入后必须通过 provider registry 恢复原实现，不能借此命令替换 provider。

## Phase 3 中文 CLI

- `src/cli/command-parser.ts` 只解析 `/cases`、`/start`、`/resume`、`/status`、问诊、检查、鉴别诊断、诊断、结果、取消、帮助和退出命令，不再读取病例诊断词表判断自然语言。普通输入统一进入 Patient Agent；其经过门禁的 `diagnosisIntent` 若确认玩家已明确唯一主诊断，CLI 才调用 `submitDiagnosis`，否则继续展示患者回复。结构化 `requestedTestId` 仍可在同一回合触发确定性检查。
- `src/cli/config.ts` 解析模拟 `userId`、provider、model 与 SQLite 路径；provider/model 不匹配时启动即失败。
- CLI 复用 `createSqliteModelService`，退出后保留会话；`/resume` 同时校验 SQLite 中固定的模拟 userId，不向其他用户暴露会话是否存在。
- `src/adapters/share-v1-adapter.ts` 将创建、投影、问诊、检查、评分、取消和错误映射为 share v1-rc1 类型，并在 opaque ID 边界重新验证公共 ID。
- `/cases` 只输出公开入口，`/tests` 输出所有已加载病例的公共检查 ID 并不显示病例内分类；病例真相、rubric、hidden/test-only fact 和内部 ID 不进入 CLI。
- `cases/draft/c01-reference-draft.json` 只用于 deterministic 工程纵切，本身不可发布；正式 C01 由 Phase 6 双 AI 交叉验证流程物化为 published 病例。
- `tests/cli.test.ts` 覆盖完整 C01 闭环、share 映射、重启恢复、模拟用户隔离、取消终态、中文帮助/错误，以及 OpenAI/Claude 的阶段门。

## Phase 4 GPT 工程纵切

- `ModelProvider` 继续作为 `ModelService` 的兼容 façade；在线问诊只调用 `generatePatientReply`，Controller 端口仅为历史 adapter/直接 contract test 兼容而保留，不参与逐轮路由。
- `FilePromptRegistry` 只按 `role + vX.Y.Z` 加载 `prompts/` 中的不可变模板，并记录内容 SHA-256；Provider identity 还绑定三角色 Prompt set fingerprint，使同版本文件被错误改写时无法跨重启继续旧 session。缺失、空模板和路径穿越全部 fail closed。
- `OpenAIModelProvider` 使用官方 `openai@7.7.0` Responses SDK；默认固定官方端点，也支持通过 `MODEL_BASE_URL + MODEL_API_KEY` 显式选择第三方 Responses-compatible HTTPS 端点。端点内容只以确定性 SHA-256 假名标识进入 Provider identity、审计和 benchmark fingerprint，不记录原始 URL；该 hash 不是匿名化结果，已知候选 URL 仍可枚举。官方 Key 永不转发给第三方，第三方 Key 也不会回退到官方端点。Patient/Review 使用 strict JSON Schema Structured Outputs并明确设置 `store=false`；历史 Controller schema 仅为兼容保留。SDK 自动重试关闭，首次持久化 operation 在实际调用角色间共享至多一次自动重试，显式恢复不会重置这笔预算。
- Patient Agent 每轮接收完整 `PatientProfile`、`SafePatientCaseView`、全部已提交对话轮次、已披露事实、完成检查和连续离题轮数；病例 `patientDisplayName` 仅作诊室场景称呼或姓氏提示，显式年龄/性别等人格锚点与医疗事实保持硬约束。未提供的完整姓名、家人姓名、住址、普通日常经历和生活琐事由 AI 自主合理补全，一旦说出就依靠完整历史保持一致；补全不得引入新的症状、异常旅行/接触史、过敏、用药、烟酒、妊娠、外伤等临床事实。它永远不接收 target diagnosis、answer key、rubric、隐藏事实或尚未完成的检查报告，也不得暴露“病例/资料/系统没有说明或提供”等幕后状态。输出必须声明 interaction kind 与医疗事实、显式人格或检查引用 ID；纯非医疗角色补全无需伪造引用。回复经过精确字段、授权引用、检查状态、沉浸感和诊断/未完成检查泄漏门后直接提交给 CLI；服务端不做关键词问答或本地患者话术重渲染。
- Patient Agent 可用 `suggestedTestId` 保存待确认检查，该状态只保留到下一次已提交轮；下一轮确认时返回 `requestedTestId`，拒绝或转题则清除。后者与 `/test` 共用同一确定性检查引擎，在回合操作内原子提交并通过 `TurnCompletedV1.effects` 返回。结构或解析输出拒绝后只允许同一 Provider 一次带定向修复指令的再生成；再次失败时不提交业务状态，也不生成本地回复。
- `medical_chat`、`social_chat`、`test_query`、`test_order` 会映射到现有持久化与效率统计；repeat/other 仍按已提交结果计算。每个新的 turn 幂等键在 Provider 前持久化消耗一次预算，成功、Provider 失败和输出拒绝都计入，幂等重放不重复计数；单会话达到 25 次后在下一次 Provider 调用前拒绝。
- 每个调用把 role、provider/model/prompt/schema 版本、Prompt hash、request ID、状态、延迟、usage 和 retry count 写入 allowlist 审计事件；不记录 Prompt 正文、玩家问题或病例事实值。
- `npm run eval:live` 使用 C01 reference draft 执行固定问诊、确定性检查、诊断和复盘，并导出脱敏 JSON。benchmark fingerprint 绑定完整病例内容 hash、三个 Prompt hash、SDK/adapter/Schema 版本、脱敏 endpoint hash、配置 identity 和 Provider 响应的实际 model ID；同一运行观察到多个实际 model ID 会 fail closed，同一 alias 解析到不同 snapshot 也会产生不同 fingerprint。该命令必须显式配置真实 Provider key/model。2026-08-27 的第三方 OpenAI-compatible 报告完成 7/7 次调用并满足 provider-neutral G4-07；它不代表官方直连端点验证，也不替代 Phase 6 AI 交叉验证或 Phase 7 完整 benchmark。
- 默认测试完全离线：mock transport、官方 SDK custom fetch、C01 mock 纵切、失败恢复和隐藏字段扫描均不需要真实 API Key。

## Phase 5 Claude adapter

- `AnthropicModelProvider` 使用官方 `@anthropic-ai/sdk@0.119.0` Messages API 和 `output_config.format` JSON Schema Structured Outputs；它复用 Phase 4 的三角色端口、Prompt registry、严格业务 Schema、单 operation 重试预算、输出校验和审计记录。
- adapter 单独映射 Anthropic content blocks、`stop_reason`、usage、request ID 与错误；`refusal`、`tool_use` 等非成功终止不会被错误当作结构化文本解析或自动重放。transport 同时声明 provider 与 protocol identity，GPT/Claude 交叉接线会 fail closed。
- `npm run eval:live:anthropic` 复用固定 C01 流程并生成独立的 `anthropic-c01-live-eval-v1` 脱敏报告；默认测试完全离线，真实运行只接受服务器端 `ANTHROPIC_API_KEY`。
- 2026-08-27 的 Phase 5 GPT 预评测复跑使用当前第三方 OpenAI-compatible `gpt-5.6-sol`，完成 7/7 次结构化调用、会话 `completed`、总分 88、3,826 tokens，fingerprint 仍为 `fb41c0b14b25a34043ca084642a7a7bcbe72520e34d0b85bad5c4991ec070122`。项目决定当前只使用这套第三方 API Key；Claude 侧只保留 mock contract/C01 证据，真实 C01 延期。
- 待完整评测的候选短名单为 GPT `gpt-5.6-sol`、Claude `claude-haiku-4-5-20251001` 与 `claude-sonnet-5`。这些只是可审计候选，不是最终型号；最终选择仍留给 Phase 7 benchmark 与项目负责人确认。

## Phase 6 病例生产

- `cases/draft/` 已提供 C01–C05 五个中文、成人、非急症的纯合成 `CasePackage v1-rc1` 草稿；每例至少含 1 个 spontaneous、10 个 if_asked、present/absent/unknown 三态、test_only、hidden、评分输入和九项红旗排除证据。
- `cases/regression/` 为每例固定 success、failure、safety、unknown 四类轨迹；`npm run cases:validate` 验证病例/轨迹交叉引用、版本、泄露门与 canonical 内容 hash。
- `src/cases/phase6-case-production.ts` 实现双 AI 交叉验证门和不可覆盖发布写入。它要求临床安全与诊断质量两个角色使用不同 validator ID，记录模型/提示版本和验证时间，六项检查全部通过，并与 `internalCaseId + caseVersion + contentHash` 精确绑定；同一病例版本通过独占发布锁和唯一 staging 文件防止并发 package/sidecar 交叉配对，人工审核资格和签字不参与发布判定。
- 历史 C01–C05 published 病例与 manifest 已被 C0 标记为 `superseded`。当前对话候选 5/5 structurally ready、0 published；新 hash 记录在 `cases/manifest.dialogue-candidate.v1-rc1.json`，`npm run cases:validate:dialogue` 是 C1 工程门，旧 `npm run cases:validate` 因历史 AI sidecar 漂移而预期 fail closed。

## Phase 7 评分、安全与离线评测

- `diagnosis-matcher.ts` 与 `scoring-policy-v1.ts` 是唯一诊断匹配和确定性评分实现；30 个黄金向量冻结六分项、证据 ID、舍入和沟通 0/50/100 三档。沟通 100 分至少需要两个不同的审核 criterion；沟通评估不可用时不会生成最终 `total`。
- `patient-output-gate.ts` 与 `evaluation-output-gate.ts` 对 Provider 输出执行精确字段白名单、事实 allowlist、诊断/检查结果泄露、证据引用和本地重算门禁；Provider prose 不能覆盖确定性评分。最终复盘与诊断说明使用版本化固定中文模板，避免未经独立医疗建议/泄露门禁的 Provider 自由文本进入结果。
- 私有 ScoringPolicy evidence 只留在模型层审计；`public-evaluation-projection.ts` 在 Review Provider 与 `share` 两个出口分别重建安全投影。公开结果固定为 `criterion.diagnosis/history/differential/test_selection/efficiency/communication` 六项和通用中文解释，只携带当前会话可公开的 turn/已完成 test 引用，不透传 fact、诊断 concept、required/unnecessary 分类或 rubric 结构。
- `MedicalSafetyPolicy v1` 在 operation journal、Provider 调用、回合增加和原文持久化之前执行，固定优先级为自伤危机、急症红旗、超出范围、普通现实健康、保守失败和游戏放行。所有退出响应来自版本化中文模板；审计只保存 HMAC、长度、rule IDs、policy/template 版本等脱敏元数据。
- 同一稳定 HMAC 密钥下，本地安全退出可在 SQLite 重启后以同一幂等键重放且不重复调用 Provider/写事件；`response_validated` 的 turn/evaluation 缓冲同时验证 checksum、服务端 HMAC、不可变原请求、当前病例事实和本地评分，任何重算普通 hash、改写 validatedAt、替换问诊文本或评分内容的篡改都会 fail closed。现实健康、危机与提示注入在 Patient Agent 前由本地策略拒绝，在线链路不会调用 Controller。
- 离线 corpus 包含五例各 20 条中文问法、32 条注入/索要答案/角色覆盖/伪造检查对抗输入，以及按 `40/30/55/10/10/20` 冻结的 165 条中文安全语料。每条病例问法绑定冻结病例的真实 askable fact allowlist；语料中既有 `pending_medical_review` 是兼容性元数据，不再构成发布阻塞。
- 100 条病例问法已逐条穿过真实 `ModelService` 安全前置门并进入 Patient Agent；32 条对抗输入已逐条经真实 `ModelService.askPatient` 本地拒绝，均为 0 Provider 调用、0 operation、0 回合和 0 原文事件写入。
- `npm run eval:phase7:offline` 只运行本地策略与结构校验，输出计数、冻结集失配和发布门状态，不调用 Provider，也不输出 fact ID、病例真相、答案或 rubric。完整候选门实际加载 manifest 指向的 package 和 validation sidecar，重算 canonical hash，并按 `publicCaseId + caseVersion + contentHash + packageStatus=published + releaseValidationMethod=ai_cross_validation` 核对三方绑定；缺失文件、路径逃逸、内容篡改或 sidecar 漂移均 fail closed。当前结果为 165/165 决策和模板一致，急症与自伤冻结集假阴性均为 0；`validatedSamples=165` 只表示本地策略逐条执行，不表示 165 条语料已经完成独立 AI 验证，也不是临床分诊有效性结论。
- 旧 manifest 中 5 个 AI 交叉验证的 published 病例只属于 superseded 版本。新 dialogue candidate manifest 为 0 published；完整候选 benchmark 必须等 C7 重新物化并绑定五个新病例后才能恢复 ready。
- 进入 Phase 8 前必须完成 P8-PRE-01–P8-PRE-05：两个病例验证角色使用不同角色 promptVersion 和 validationRunId 并重新生成 5 个 sidecar；新增 published-only 五病例候选 runner；为 165 条语料生成绑定 corpus/policy/template hash 的独立 AI 验证产物并保持 33 条 holdout 冻结；冻结当前批准 Provider/model；生成不可变 runtime-release manifest。人工医学签字不属于其中任何门。
- 165 条语料仍保留 `reviewStatus: pending_medical_review`、`reviewerId: null` 的旧元数据，但这些字段不阻塞发布。33 条 `holdout` 当前只冻结切分；P8-PRE-03 完成前不得写成“已完成独立 AI 盲测”。
- `npm run test:coverage` 要求全局 line/function/branch 均至少 80%，并对会话状态机、评分/输出门和安全核心分别要求至少 90%。`ModelService` 当前仍是约 3,300 行的兼容 façade；在进入合并/Software RC 前应以现有恢复矩阵锁定行为，再拆分 turn/evaluation coordinator、recovery reconciler 与 safety journal/redaction，避免在本轮 Phase 7 收尾中进行高风险大重构。

## Phase 1 私有规范

- `cases/schemas/` 与 `src/domain/case-package.ts` 共同冻结服务端私有病例包、rubric、AI 交叉验证、provenance 和 red-flag exclusion matrix；旧版人工审核记录只作为可选反馈格式保留。答案、词表、隐藏事实和 rubric 不进入 `share/`。
- `cases/manifest.v1-rc1.json` 固定 `draft/review/published/provenance/fixtures` 目录与版本关联。
- `src/evaluation/scoring-policy-v1.ts` 使用 `share` 的唯一版本号与权重实现六分项确定性评分；沟通不可用时保留五项 provisional evidence，但不生成 `total`，也不补默认分。
- `src/providers/communication-review-provider.ts` 定义独立沟通评审边界；测试和 headless 只能显式注入带 turn/rubric 证据标签的 fixture reviewer。未配置 reviewer 时评估返回可重试的 `EVALUATION_UNAVAILABLE`。
- 诊断首次接受后保存不可变输入与 fingerprint；评估暂时不可用时，同一幂等键或新幂等键都可恢复同一份诊断，不会重复发出 `diagnosis.accepted` 或提前提交最终结果。
- `tests/scoring-policy-v1.test.ts` 固定五个逻辑病例组、每组 6 个、共 30 个黄金向量，逐项断言分数、总分、evidence IDs 和最终舍入。
- `tests/contract/phase1-contract.test.ts` 使用 `share` 提供的同一测试工具验证私有 CasePackage Schema 正反例，并确认 allowlist 投影不会携带病例真相。

`npm run headless` 使用纯合成 fixture 和确定性 provider 跑通：

```text
创建会话 → 问诊 → 固定检查 → 诊断 → 结构化评分 → 审计事件
```

它不调用真实 LLM，不代表医学质量已经通过审核。

## 安全约束

- `cases/`、`prompts/`、答案键和 rubric 只能部署在可信服务端。
- 创建会话和查询会话只返回 allowlist 投影；不会序列化完整病例对象。
- Patient Agent 只能看到 `SafePatientCaseView` 中的可回答事实、人格公开信息、检查状态和已完成报告；answer key、rubric、隐藏事实与未完成报告不会进入请求。
- Patient 输出在提交前经过精确 Schema、事实 allowlist、新造事实、诊断泄露和检查结果伪造门禁。
- 问诊文本和诊断输入有长度/数量上限；`MedicalSafetyPolicy v1` 会在创建 operation journal 前拦截现实健康、急症红旗、超范围、自伤危机、边界模糊输入和提示注入，策略异常 fail closed，Provider 异常只返回固定公开消息。用药规则显式区分当前服停/剂量决策与虚构患者的既往用药史；诊断提交使用独立 `fictional_diagnosis_submission` 上下文，允许“最终诊断考虑……”等提交措辞，但仍复用危机、现实调药和通用指令覆盖门禁。
- 本地安全前置退出不会创建 operation、调用 Provider、增加病例回合或保存原始输入；只记录服务端密钥 HMAC-SHA-256 和版本化审计元数据。所有待 Patient Agent 处理的 turn 文本从首笔持久化开始就是 AEAD 密文、request hash 从首笔写入开始就是 HMAC；输出门拒绝时清除不可提交结果，不生成本地伪患者回复。`SAFETY_AUDIT_HMAC_KEY` 在部署时必须由 secret manager 注入，不能写入仓库。
- 检查结果直接读取冻结病例包；确定性 provider 只用于测试与开发。
- Evaluation 内部保留可审计的私有证据；跨 `share` 只输出固定六项公开证据、固定中文解释/复盘和允许公开的引用，不输出未披露 fact、答案、rubric、鉴别概念、检查分类、Provider prose、金钱、经验、库存或解锁。
- `var/`、SQLite/DB 文件及 WAL/SHM 衍生文件已加入 `.gitignore`。Phase 2 存储只用于合成病例和本地开发，不具备生产身份认证、数据库加密、法定数据保留或删除流程，不能直接承载真实患者数据。

## 当前状态与待决项

- Phase 0 独立运行时已选择 TypeScript；这不决定最终部署必须是独立 Node 服务。
- MVP 仍建议由 Next Route Handlers/BFF 承载；是否拆分 FastAPI：**待项目审核**。
- 模型供应商、模型名称、推理参数、预算和部署地区：**待项目审核**。
- 公共 `share v1-rc1`、私有 `CasePackage v1-rc1` 与 `ScoringPolicy v1` 已冻结，并已建立 model → share 单向 package 依赖和契约测试。
- Phase 2 的 SQLite 持久化、幂等、固定 TTL、同会话串行、操作日志、重启恢复和显式 ops recovery 已实现并通过恢复矩阵测试。
- Phase 3 中文 CLI、配置解析、share v1-rc1 adapter、C01 reference draft 与 CLI integration tests 已实现；headless runner 保持可用。
- 对话重构 C3–C5 已实现 Patient Agent 检查请求/确认循环、同回合 `effects`、一次定向再生成、SQLite v6 迁移与历史恢复；聊天触发检查和 `/test` 共用同一确定性引擎。
- Phase 4 OpenAI adapter、Prompt registry、调用观测、服务端事实落地门、角色共享重试预算、mock HTTP tests 和固定 C01 live-eval 命令已经实现；第三方 OpenAI-compatible 真实 Provider C01 已完成，Phase 4 provider-neutral 工程退出条件满足。交互式 OpenAI CLI 仍按安全阶段门保持关闭。
- Phase 5 Claude Messages adapter、Provider-specific 映射、协议隔离、mock HTTP/provider contract tests、固定 C01 mock 纵切和 live-eval 命令已经实现。按当前修订范围，Phase 5 工程实施完成；真实 Claude C01 与双 Provider 预评测由项目决定延期，不阻塞继续 Phase 6，但不得宣称 Claude 已真实验证。
- 当前运行 Provider 只使用既有第三方 OpenAI-compatible `MODEL_BASE_URL + MODEL_API_KEY`；Claude Key 不配置，Claude adapter 不接入 session，也不存在自动 failover。
- 历史 Phase 7、P8-PRE-01–P8-PRE-05 和 Phase 8-A：**已完成但已 superseded**。旧证据与 zip 只读保留在 `evaluation/phase8/`，不得作为当前版本发布依据。
- Phase 8 命令：`phase8:ai-validate`、`eval:phase8:candidate`、`phase8:manifest`、`phase8:verify`、`eval:phase8:release`、`phase8:patient-audit`、`security:scan`。所有证据目录均不可覆盖；大样本审核若仅发生结构化返回漂移，可用 `phase8:patient-audit` 对已落盘私有样本追加审核，不重放病例会话。
- 当前批准范围只有第三方 OpenAI-compatible Provider + `gpt-5.6-sol`；Claude 真实验证延期且非阻塞，不存在自动 failover。
- 当前对话实现已完成 AI 主导/完整历史/诊断意图纠偏并通过 331/331 测试、全部覆盖率门与真实模型本地 smoke；AI 已验证可合理补全姓名、父母姓名、住址和昨日行程并保持一致，也已验证明确单诊断直接评分、清晰主诊断加鉴别诊断评分、多病无主次继续对话。旧 C6 r6、C7 runtime r10、dialogue-live r5、runtime manifest r11 和 Software RC r9 只作历史证据；当前发布包必须按纠偏后的源码重新生成。

详细模型基线见 [`../docx/baseknowledge/开源资源与技术方案.md`](../docx/baseknowledge/开源资源与技术方案.md)，跨层规则见 [`../docx/baseknowledge/共享层基本内容.md`](../docx/baseknowledge/共享层基本内容.md)。
