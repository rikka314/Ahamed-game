# AhaMed Doctor Game 游戏层 MVP AI 实施计划

> 文档状态：待项目负责人审核；批准后作为游戏层 AI 实施、人工确认和验收的唯一主计划
>
> 建立日期：2026-08-27
>
> 最近修订：2026-08-29（纳入项目负责人对开场、横屏构图、诊室布局、电脑/叫号、队列、气泡对话、检查动线、报告、双资源经营和循环接诊的产品设想）
>
> 适用范围：`D:\Learn\20_Projects\MedicalAI\apps\game\game`，以及游戏侧接入所必需的 `share/` 公共契约
>
> 目标形态：Web-first、仅横屏、桌面浏览器与 Android 可玩的单人俯视 2D 像素模拟医生 MVP
>
> 当前发布事实：模型层 5 个冻结病例已有双 AI 交叉验证记录，但当前源码在 AI-only/完整历史纠偏后仍需重新生成真实 AI 对话验收、runtime manifest 与 Software RC 才能恢复当前发布资格；公共 fixture 可用于 mock、离线开发和自动测试，未进入当前有效 runtime-release manifest 的病例不得进入玩家运行时、公开试玩、Software RC 或生产发布
>
> 实施授权：本文件本身只冻结计划，不授权自动开始全部代码实施。项目负责人明确回复“按 `docx/plan/game/游戏层MVP实施计划.md` 开始实施”即通过 `H-START`，AI 才进入 S0；S0 内再完成 H0/H1 的范围与玩法冻结。执行过程中只在本文规定的人工门停住受影响分支

## 1. 执行结论

本计划交付的最终玩家闭环是：

```text
黑屏淡入诊所全景
→ 玩家医生以坐姿出现，并用头顶气泡说“又是开始接诊的一天”
→ 点击桌边电脑，打开“开始接诊 / 商店 / 升级”界面
→ 点击“开始接诊”并退出电脑，诊室左侧门外出现可见患者队列
→ 点击桌面叫号按钮，队首患者进门并坐到接诊桌旁
→ 患者用气泡问候并陈述初始主诉
→ 点击玩家旁的“对话”按钮，以文字自由问诊（通过 share 契约连接 model）
→ 请求一种本地基础检查，患者自行前往右侧帘后检查区并等待结果
→ 患者回到原座、气泡告知检查完成，旁边出现“查看”按钮
→ 打开报告纸查看模型层提供的允许展示内容
→ 提交诊断并查看结构化评分与复盘（通过 share 契约连接 model）
→ 按确定性规则获得金币与声望
→ 患者离开诊室，叫号按钮允许下一位患者进入并重复循环
→ 玩家可在空档通过电脑完成一次购买和一次受声望约束的升级/解锁
→ 刷新页面后恢复队列、当前患者、经营进度与医学会话允许投影
```

游戏层内部采用三条并行生产线，而不是“等全部美术到齐后才开始写代码”：

```text
代码灰盒线        世界、状态机、UI、经营、存档、测试
美术内容线        视觉方向、地图、角色、设备、UI 皮肤、音频
模型契约线        share DTO、mock adapter、HTTP/SSE adapter、恢复和安全

                    ↓ 阶段性汇合

代表性诊室 PoC → Mock Playable → 黄金美术纵切 → Integrated MVP → Release Candidate
```

AI 是主要程序员、技术美术和制作助理；项目负责人是产品负责人、美术总监和人工验收人。AI 可以自主完成代码、灰盒、占位素材、导出、校验和测试，但不得自行冻结最终美术风格、正式素材、经营体验或发布决定。

## 2. 计划使用规则

### 2.1 冷启动读取顺序

任何执行本计划的 AI，在修改文件或运行项目命令前必须：

1. 完整读取项目根 `AI_CONTEXT.md`；
2. 完整读取 `docx/baseknowledge/压缩上下文.md`；
3. 按 `.codex/skills/load-game-context/SKILL.md` 路由：
   - 游戏、地图、美术、音频、存档、经营任务读取 `docx/baseknowledge/技术栈.md`；
   - 接入 `share`、mock、HTTP/SSE、错误、幂等、恢复任务先读取 `docx/baseknowledge/共享层基本内容.md`，再读取游戏层全文；
4. 完整读取本计划；
5. 读取当前 Phase 明确列出的输入文件、前序交付物和决策记录；
6. 执行 `git status --short --branch`，不得覆盖、回退或清理与当前 Phase 无关的用户改动；
7. 读取 `game/AGENTS.md`，涉及 Next.js 实现时再读取 `game/node_modules/next/dist/docs/` 中与任务对应的当前版本文档。

### 2.2 Phase 状态

每个 Phase 只能使用以下状态：

| 状态 | 含义 |
|---|---|
| `pending` | 尚未开始 |
| `in_progress` | AI 正在实现或验证 |
| `blocked_user` | 只缺本文定义的用户决定、素材或人工验收 |
| `blocked_external` | 只缺服务器、凭据或其他外部依赖 |
| `engineering_complete` | 自动化工程门通过，但尚未完成人工验收 |
| `user_accepted` | 项目负责人已完成人工验收 |
| `complete` | 工程门、人工门和文档同步全部完成 |

禁止把“代码能运行”“AI 生成了图片”“mock 通过”写成“用户已验收”“真实模型已接入”或“可发布”。

### 2.3 证据要求

AI 每完成一个 Phase，必须交付：

- 变更文件清单；
- 可直接访问的本地测试入口或运行命令；
- 自动测试命令与结果摘要；
- 当前 `contentBuildId`、`saveSchemaVersion`、`rewardRuleVersion` 和 `contractVersion`；
- 占位素材、待审核素材和已批准素材清单；
- 失败路径验证结果；
- 仍待用户决定的 3–5 个具体问题；
- 可回滚点和剩余风险。

### 2.4 Git、direct mode 与文件所有权

当前仓库处于 dirty `main`、本地领先远端且 GitHub CLI 未认证，因此本计划默认使用本地 direct mode：

- 每个 S-step 开始和结束都记录 `git status --short --branch` 与本步 diff 清单；
- 每步只修改该步骤“主要/建议文件”列出的范围；确需触碰共享入口、配置或同一文件时，先登记文件 owner、现有未提交改动和合并顺序；
- 多个 AI/代理并行时，一个共享文件同一时刻只设一个写入 owner，其他执行者只读并向 owner 提交建议；
- 不覆盖、回退、格式化或清理无关改动，不使用 destructive reset；
- 每步形成可验证的本地 checkpoint（diff、测试结果和回退说明）；只有用户明确要求时才创建 commit、branch 或 PR；
- `share/` 或 `model/` 的新增交付物不因写在游戏计划中自动获得修改授权，必须遵守对应层计划和变更门。

## 3. MVP 命名与完成层级

为避免把 mock、真实模型和发布混为一谈，使用三个里程碑名称。

### 3.1 Mock Playable

必须完成：

- 一张代表性诊所地图，包含左侧门外队列、接诊桌、医生/患者座位、桌边电脑和叫号按钮、右侧帘后基础检查区，以及桌面端可见的上/下灰雾锁定区；
- 黑屏淡入、医生坐姿开场气泡、电脑开始接诊、队列形成、叫号、患者进门/落座/离场；
- 至少两名公开合成 mock 患者顺序完成循环，证明“下一位患者”不是一次性假入口；
- 使用 `share` 公共 fixture/mock 完成气泡式问诊、一次本地检查动线、报告查看、诊断和评分；
- 金币与声望两种奖励输入、一次购买和一次受声望约束的升级/解锁；
- IndexedDB 刷新恢复；
- 超时、断流、重复请求、过期和损坏存档的游戏侧表现。

它可以使用公开合成 fixture，不需要真实 LLM，也不代表双 AI 病例发布验证或公开发布。

### 3.2 Integrated MVP

在 Mock Playable 基础上必须增加：

- 游戏只通过 `share` 契约和可信服务端 HTTP/SSE adapter 接入模型；
- 模型层完整 runtime-release manifest/gate 已通过，而不只是单个病例被标记为 published；
- 至少两个来自该已批准运行时清单的医学发布病例可供顺序接诊纵切，证明患者离场、下一位叫号和新 session 创建/恢复；
- 可信服务端已交付冻结的 HTTP/SSE transport、公共查询 DTO 和 producer contract evidence；
- 创建/恢复、问诊、检查、诊断和评分全链路；
- 真实延迟、超时、断线、幂等和未知写结果恢复；
- 客户端构建、网络、日志、资源和 IndexedDB 隐藏信息扫描通过。

当前模型层 5 个冻结病例均已有临床安全与诊断质量双 AI 交叉验证记录，模型层全量测试为 323/323，并已有一次当前源码的真实 `gpt-5.6-sol` 连续对话 smoke。与此同时，旧 C6/C7 runtime、dialogue-live、runtime manifest 与 Software RC 均早于 AI-only/完整历史纠偏，只能作为历史证据，不能代表当前源码发布通过。H8 必须基于当前源码重新生成真实 AI 对话验收、批准 Provider/model identity、不可变 runtime-release manifest 和 Software RC；这些产物完成前 Integrated MVP 真实玩家纵切继续等待，但游戏构建、mock/合成 producer 和 consumer 测试可以继续。

### 3.3 Release Candidate

在 Integrated MVP 基础上必须增加：

- 黄金地图、玩家、患者、设备、UI 和最小音频全部 `ACCEPTED`；
- Chromium、Firefox、WebKit 自动化通过；
- 桌面目标浏览器、Android Chrome 和一个目标低端 Android 设备真机验收；
- 医学、隐私、素材许可和产品文案发布门通过；
- 全量回归、存档迁移、隐藏信息扫描和发布清单完成；
- 项目负责人最终 go/no-go。

## 4. 已确认、建议与待确认决策

### 4.1 已确认决策

| ID | 决策 | 内容 |
|---|---|---|
| G-D01 | 平台 | 桌面浏览器与 Android，WebGL 为完整体验验收路径；iOS 不在当前交付范围 |
| G-D02 | 技术栈 | Next.js 16 + React 19 + TypeScript + client-only Phaser 4.2.1 |
| G-D03 | 地图 | Tiled 1.12.2 JSON + Arcade Physics |
| G-D04 | UI 所有权 | 世界与轻量提示在 Phaser；问诊、检查、诊断、结果和关键错误在 React DOM |
| G-D05 | 跨层依赖 | `game → share ← model`；游戏禁止 import `model/` 内部实现 |
| G-D06 | 开发顺序 | 先以同一 `share` 契约完成 mock 闭环，再接真实 model adapter |
| G-D07 | 存档 | IndexedDB + 版本化 `SaveEnvelope` + 迁移 + 导入导出 |
| G-D08 | 经营边界 | 评分只作为结构化输入；奖励和解锁由游戏层确定性规则计算 |
| G-D09 | 美术权力 | 未经用户静态审批和游戏内审批的素材不得成为正式黄金样板 |
| G-D10 | 首发范围 | 一个诊所纵切、至少两名可顺序接诊患者、一个本地基础检查、一次报告查看、一次诊断、金币与声望、一次购买和一次升级/解锁 |
| G-D11 | 运行时兼容 | 游戏接入 `@ahamed/doctor-game-share@1.0.0-rc.1` 前，开发/CI Node 基线统一到 `>=22.18`，不得忽略 share 的 engine 要求 |
| G-D12 | 模型发布边界 | structurally ready draft 只用于显式离线开发和 mock/回归，不得进入玩家运行时 |
| G-D13 | 屏幕方向 | 游戏只支持横屏；手机处于竖屏时暂停世界并显示旋转设备提示，桌面不模拟竖屏主玩法 |
| G-D14 | 固定开场 | 首次进入从黑色淡入，玩家医生坐在桌子右侧座位，并用角色旁气泡说“又是开始接诊的一天” |
| G-D15 | 诊室构图 | 左侧为门与室外队列；中部为朝左的接诊桌、电脑、叫号按钮和患者座；右侧以帘子分隔床与基础检查设备 |
| G-D16 | 开诊与叫号 | 玩家点击电脑中的“开始接诊”，退出电脑后队列形成；只有点击桌面叫号按钮，队首患者才进门并落座 |
| G-D17 | 发言表现 | 玩家和 NPC 的每一次角色内发言都以靠近说话者头顶/身侧的 DOM 气泡呈现；文字输入和长文辅助视图仍使用可访问的 React DOM |
| G-D18 | 检查表现 | 体温、血压、血氧、心电图等本地检查由患者自行前往帘后区域完成，不设计玩家操作型检查小游戏；完成后回座并出现“查看”报告入口 |
| G-D19 | 循环接诊 | 完成结算后当前患者离场，队列推进，叫号按钮重新可用；MVP 必须用至少两名患者证明重复循环 |
| G-D20 | 响应式世界 | 手机横屏优先同屏看见左侧队列/门和中右部诊室；桌面因纵向/整体可视范围更大，可额外看到上、下灰雾锁定区域，世界不拉伸且不因设备差异改变业务状态 |
| G-D21 | 扩展房间 | CT、B 超等位于诊室上方的未来房间；MVP 只表现灰雾/未解锁状态，不制作完整检查动画或辅助 NPC 工作流 |
| G-D22 | 经营语义 | 医学评分由游戏规则确定性换算为金币与声望；金币购买物件，声望推动升级，部分商品受升级等级约束 |
| G-D23 | 视觉方向 | 采用温暖、克制、俯视 2D 像素生活模拟风；《星露谷物语》只作为高层体验参照，不复制其素材、角色、地图、UI、色板或可识别构图 |

### 4.2 本计划建议的 MVP 默认方案

以下方案用于让计划可执行，但必须在 H0/H1 人工门明确确认；确认前只能作为灰盒假设。

| ID | 建议默认 | 理由 |
|---|---|---|
| G-P01 | 开场不强制插入移动教学；淡入和自言自语结束后，玩家可直接点击电脑，也可先在诊室内移动 | 保留设想中的叙事节奏，同时不剥夺自由移动 |
| G-P02 | 队列使用固定入口、固定候诊锚点和确定性顺序；MVP 不引入通用寻路或随机插队 | 可测试、可恢复，并足以证明核心循环 |
| G-P03 | 首例使用的本地基础检查设备初始已拥有且已解锁 | 否则首例无法完成 |
| G-P04 | 首轮经营纵切同时提供一个可购买装饰/设备和一个声望等级解锁；不解锁刚刚使用的基础检查设备 | 直接证明金币、声望、购买和升级之间的关系 |
| G-P05 | 只有收到合法 `EvaluationResultV1` 才能发奖；`evaluating` 或 `EVALUATION_UNAVAILABLE` 保持“评分待完成” | `EvaluationResultV1.scores.total` 是必填字段，禁止构造 partial result、补 0 分或猜测发奖 |
| G-P06 | 多标签页 MVP 先采用“单主标签页 + 其他标签页只读提示” | 先保证不重复问诊、检查、诊断和发奖 |
| G-P07 | 正式中文医疗长文本使用可读的系统/网页字体；像素字体只用于标题或短标签 | 避免小字号中文像素字体影响可读性和无障碍 |
| G-P08 | 第一版只做必要音效；背景音乐由用户确认后决定是否进入 MVP | 降低授权和循环音频工作量 |
| G-P09 | 电脑中的“商店”和“升级”从首个灰盒版本就可进入；未实现内容显示明确的 locked/coming-soon 状态，MVP 只各完成一个真实纵切 | 保留完整产品心智模型，同时控制首版范围 |
| G-P10 | 本地检查的等待以短路径移动、设备状态和气泡反馈表达；不要求玩家跟随或操作设备 | 符合设想并避免把医学流程做成反射小游戏 |
| G-P11 | 手机上的镜头不展示上/下扩展房间；未来远端检查只显示患者离开可视区域、等待状态和返回，桌面可额外看到纯表现动画 | 保证平台功能等价，差异只在可见表现 |

### 4.3 H0/H1 已确认的玩法与生产范围

G-D13–G-D23 与原 H0/H1 开放项均已由项目负责人确认，权威明细见 `decisions/S0-决策日志与人工门.md`。实施时不得重新把下列方向当成开放问题：

1. MVP 同时提供右侧检查区的血压设备与抽屉内体温计；玩家选择体温检查后，医生自动取出并递给 NPC，NPC 测量后归还，医生自动收纳，全程不要求玩家操作。公共 `testId` 仍从批准病例目录映射，游戏内容系统分别分配稳定 `deviceId`。
2. 一个接诊日初始队列 2 人，最大队列 4 人。
3. 正常金币为 20–120 的版本化可调区间；正确诊断基础声望随等级在 100–250 区间提高。MVP 不自行设置二元“诊断失败”阈值；明确失败终局统一结算 0 金币、-50 声望。
4. 首购为可升级盆栽，首次声望升级为诊所等级 2，首个门槛商品为可升级候诊椅；盆栽和候诊椅各 3 级，每级各提高单次诊断声望 25%。
5. 允许重玩同一病例；重复成功基础声望为 50。
6. 接受 share v1-rc1 的 20 回合、单次 1000 字符硬上限；当前明确失败终局就是超过回合上限，患者愤怒离场并结算 0 金币、-50 声望。技术错误、评分 pending/unavailable 不得误判为玩法失败。
7. MVP 同时包含必要 SFX 与 1 首可无缝循环的诊所日间 BGM；暂不制作独立标题/菜单曲。正式美术和音频源资产由项目负责人制作/提供，AI 负责规格、技术校验、转换、集成和验收。
8. 发布与真机范围仅桌面和 Android；不把 iOS 当作当前人工验收前提。
9. 正式素材接受原创、CC0 与来源/署名记录完整的 CC BY。
10. 本地存档存在但服务端会话已删除时，保留历史摘要并开始新病例。
11. 本轮“完成”目标为 Integrated MVP；公开发布仍另走 RC 门。

### 4.4 玩家体验与空间合同

#### 4.4.1 首次进入与开诊

1. 首屏从纯黑开始，在可配置但可跳过的短淡入中逐渐显示诊所；淡入不会隐藏资源加载失败。
2. 玩家医生初始绑定稳定的 `doctorSeatAnchorId`，使用坐姿 idle；角色头顶/身侧气泡显示“又是开始接诊的一天”。
3. 开场气泡结束后开放世界输入和电脑交互。玩家点击桌边电脑，React DOM 以像素终端样式显示“开始接诊 / 商店 / 升级”。
4. 点击“开始接诊”提交一次确定性的 `shiftId`/营业状态；电脑面板关闭后才在左侧室外候诊锚点生成队列，避免 UI 未退出时发生不可见状态推进。
5. 商店和升级入口始终可见，但未满足条件的商品/等级必须显示明确原因，不使用无反馈的灰按钮。

#### 4.4.2 诊室和扩展区域

```text
桌面额外可见的上方区域：CT / B 超等未来房间（MVP 灰雾锁定）

左侧室外队列 → 左侧门 | 中部接诊区：患者座 ← 接诊桌/电脑/叫号按钮 → 医生座 | 帘子 | 右侧基础检查区：床/设备

桌面额外可见的下方区域：未来功能区（MVP 灰雾锁定）
```

- 诊室主体为近似正方形的小房间，接诊桌朝向左侧；医生坐在桌子右侧，患者进入后坐在桌子左侧或左前方的稳定座位锚点。
- 左门同时承担入场与离场动线；门外必须保留队列可视空间，患者之间不重叠、不穿墙、不争用同一座位。
- 右侧帘子是视觉和碰撞边界；基础检查区至少包含床位与一个首例设备占位，后续可扩展体温、血压、血氧和心电图。
- 上/下扩展区属于同一世界构图的未来内容，不以客户端隐藏病例或模型能力解锁；MVP 用统一灰雾、低饱和遮罩和“未解锁”反馈表达，不允许进入。

#### 4.4.3 横屏与响应式镜头

- 游戏世界只接受横屏主交互。移动设备进入竖屏时暂停 Phaser update、停止提交交互并显示可访问的旋转提示；恢复横屏后回到原状态。
- 不按设备拉伸地图。相机根据安全可视矩形和长宽比裁切：手机横屏必须优先同屏包含左侧队列/门、接诊桌和右侧主要诊室；允许帘后最右缘按设备宽度轻微裁切，但关键按钮不得出屏。
- 桌面视口可显示更多上/下空间和灰雾锁定区；手机看不到这些区域不构成功能缺失。未来 CT/B 超流程在手机只显示患者离开可视区域、等待和返回，桌面可额外看到表现动画，但检查结果、耗时和状态完全一致。
- React 气泡、电脑、报告和输入 UI 使用 safe-area、最小触控尺寸和碰撞避让；气泡不得遮住关键交互按钮或长期挡住角色路径。

#### 4.4.4 气泡、输入与报告

- 所有角色内发言都创建带 `speakerNpcId`/`speakerRole` 的气泡消息，并锚定到说话者的屏幕坐标；开场独白、患者问候、主诉、回答、检查完成提示和离别均遵守同一规则。
- 气泡由 React DOM 渲染，以保证中文排版、缩放、屏幕阅读器和触控；Phaser 只提供稳定角色锚点和轻量状态，不在 Canvas 中排长段医疗文本。
- 短气泡自动换行并在可配置时长后收起；长回答可以展开/滚动，并在一个可访问的会话历史入口中回看。收起只影响表现，不删除已提交对话。
- 患者落座后，玩家角色旁出现“对话”按钮；点击后打开文本输入。发送后玩家问题先显示在玩家气泡，患者 completed 回复再显示在患者气泡；delta 只作临时打字表现。
- 检查完成并回座后，患者旁出现“查看”按钮。点击后打开独立报告纸 UI，内容只来自 `TestResultV1`/`TurnCompletedV1.effects` 的客户端允许投影；游戏不得自行补写医学数值或报告结论。

#### 4.4.5 队列、检查和循环

1. 开诊后生成当天确定性队列；只有队首可被叫号。
2. 叫号按钮提交一次 `callId`，队首从室外候诊点进入、走到患者座并切换坐姿；到座前不能开始问诊。
3. 患者落座后先问候并陈述初始主诉；医学 session 在叫号后创建或恢复，并绑定 `npcId + sessionId + patientRoleId`。
4. 血压检查被接受后，患者从座位走到右侧设备锚点自主完成检查；玩家无需跟随或操作设备。
5. 体温检查被接受后，游戏暂停玩家世界输入并自动播放：医生打开抽屉取出体温计、递给患者、患者测量并归还、医生放回抽屉；序列完成或进入可恢复错误状态后恢复玩家输入。
6. 检查完成后患者回到或保持在原座，气泡提示完成并开放报告查看。若 unavailable/技术错误，角色和设备回到可恢复状态，不伪造报告，也不重复提交检查。
7. 诊断、评分、奖励领取结束后患者从左门离场；权威离场 checkpoint 完成后才释放座位、推进队列并重新启用叫号。
8. 队列为空时显示当日接诊完成状态；MVP 不实现无限随机刷病人。

#### 4.4.6 MVP 与后续边界

| 能力 | MVP 必须 | 后续扩展 |
|---|---|---|
| 队列 | 确定性队列、至少两名患者、叫号/离场/下一位循环 | 日历、预约、插队、急诊优先级、大规模队列 |
| 本地检查 | 血压由患者自主前往设备完成；体温由医生取出、递交、患者测量、归还、医生收纳的无操作自动演出完成；结果完成后查看报告 | 血氧、心电图等完整目录与更多动画 |
| 远端检查 | 上/下房间灰雾锁定和稳定扩展锚点 | CT/B 超房间、辅助 NPC、桌面可见动画、手机离屏流程 |
| 电脑 | 开始接诊、商店、升级三个入口 | 完整目录、装修预览、维修、复杂升级树 |
| 经营 | 金币、声望、一个购买、一个升级/门槛商品 | 电视、绿植等诊室装饰，更多设备、长期经济曲线、任务与日历 |
| 对话 | 全部发言角色锚定气泡、输入、历史回看 | 语音输入、更多表情/姿态、复杂社交系统 |

#### 4.4.7 后续远端检查表现合同（非 MVP 实现）

- CT、B 超等远端检查接受后，患者从当前座位沿稳定路径离开诊室并进入上方检查房间；该流程仍由游戏层表现、模型层提供检查状态和报告，不要求玩家操作设备。
- 桌面端在房间已解锁且进入后续版本时，可看到患者在上方房间由辅助 NPC 接待和操作设备；手机横屏因相机不包含该房间，只显示“患者检查中”的等待状态。两端不得产生不同检查结果、耗时规则或可用性。
- 完成后患者携报告返回原接诊座位，用气泡说明检查已经完成，随后开放同一个“查看”报告入口；CT/B 超报告也只消费模型/share 允许投影。
- MVP 只为上方房间、入口、路径和辅助 NPC 预留稳定 ID/锚点，并显示灰雾锁定；没有实际房间、动画和报告纵切时不得把该能力标成可用。

## 5. 当前实现基线

当前已经实现：

- 独立 `game/` package：Next.js 16.3.2、React 19.2.8、TypeScript 5.9.3、Phaser 4.2.1、idb、Vitest、Playwright；
- client-only Phaser 启动和 React Strict Mode 安全销毁；
- `BootScene → WorldScene`；
- 320×180 实验逻辑分辨率、pixelArt、FIT/CENTER_BOTH 和 Arcade Physics；
- 键盘与触摸移动、对角线归一化；
- 程序生成的玩家、患者、墙体和硬编码诊所；
- 患者距离交互和移动锁定；
- React/Phaser typed bridge；
- 基础 movement、bridge unit tests 和浏览器 smoke。

当前尚未实现：

- Tiled 地图加载、碰撞层、遮挡层、对象层和患者到达路径；
- 正式美术、动画、UI 视觉和音频；
- `PreloadScene`、资源 manifest 校验、加载重试和 content build 发布流程；
- 游戏侧 `share` package 依赖和 `MedicalSessionPort`；
- mock/HTTP/SSE adapter；
- 问诊、检查、诊断、评分 React UI；
- 患者到达与诊疗流程状态机；
- 奖励、交易流水、解锁和防重复结算；
- IndexedDB `SaveEnvelope`、迁移、导入导出和服务端会话恢复；
- 隐藏信息扫描、错误恢复和真实设备门。

共享层当前已经实现：

- `@ahamed/doctor-game-share@1.0.0-rc.1`；
- 公共 TypeScript DTO、JSON Schema、36 项正反 fixture；
- SessionPhase、错误码、事件、幂等 fingerprint、allowlist projection；
- 0–100 评分、20 回合、7 天 session TTL、8 天幂等保留；
- completed event/会话查询是恢复权威，delta 不是权威；
- contract、serialization、hidden-field 和兼容矩阵测试。

游戏侧 adapter 仍为 pending。共享层当前未提供现成 mock server，因此 mock adapter 属于本计划交付内容。

## 6. MVP 范围

### 6.1 必须实现

- 仅横屏进入一张代表性诊所地图；竖屏显示旋转提示并暂停世界；
- 黑屏淡入、医生坐姿、开场自言自语气泡和可恢复的开场 checkpoint；
- 桌面键盘和移动端触控自由移动；
- 墙、家具、NPC 脚部碰撞与前景遮挡；
- 左侧门外队列、中部接诊区和右侧帘后基础检查区；桌面可见上/下灰雾锁定区；
- 手机与桌面使用同一世界状态和不同安全构图，不拉伸、不让关键操作出屏；
- 电脑 UI 包含“开始接诊 / 商店 / 升级”，开始接诊后退出电脑才形成队列；
- 桌面叫号按钮、确定性队列、至少两名患者的进门、落座、离场和下一位循环；
- 每个叫号/患者/session 事件只提交一次，刷新不复制患者、不跳过队首；
- 患者落座后创建或恢复医学会话，先以气泡问候并陈述主诉；
- 玩家旁“对话”按钮、React DOM 文字输入和按说话者锚定的全部发言气泡；世界输入正确暂停和恢复；
- 一种初始设备对应一种公开医学检查；患者自主前往帘后操作、返回原座并提示完成；
- 患者旁“查看”按钮和独立报告纸 UI；报告只使用模型/share 的允许投影；
- 主要诊断提交和不可重复确认；
- 结构化评分、证据和复盘展示；
- 金币与声望两种版本化经营奖励；
- 同一 `evaluationId` 只结算一次金币、声望和解锁流水；
- 商店中至少一个真实可购买物件；升级中至少一个声望等级变化；至少一个商品受升级等级约束；
- 购买/升级/解锁前后有可观察的世界或 UI 变化；
- IndexedDB 自动保存、刷新恢复、损坏数据处理和至少一次迁移测试；
- mock 与真实 adapter 使用同一游戏侧端口；
- 资源加载失败、模型超时、断流、会话过期、版本不兼容、IndexedDB 不可用有明确 UI；
- Chromium、Firefox、WebKit 自动化和移动真机 smoke；
- 客户端 bundle、public 资源、source map、日志、网络响应、Phaser cache、IndexedDB 和导出存档无隐藏病例信息。

### 6.2 明确不进入本 MVP

- 无限患者、随机插队、急诊优先级、复杂预约或大规模队列；
- 每日随机病例、无限病例池或在线随机生成病例；
- 多诊室、完整医院或开放世界；
- CT/B 超房间的实际解锁、辅助 NPC 操作和完整动画；MVP 只做灰雾锁定与扩展锚点；
- 血氧、心电图等更多检查的完整目录；MVP 只实现已确认的血压设备与抽屉体温计两种本地检查纵切；
- 玩家操作型检查小游戏；
- 完整商店目录、复杂库存、装修摆放、维修、雇员和长期经济曲线；
- 多级升级树、昼夜和复杂日历；
- 云存档、账号和跨设备同步；
- 排行榜、防作弊和正式在线成绩；
- PWA、完整离线游戏或离线模型；
- 多人游戏；
- 大批量 NPC、地图、UI 主题或音频；
- Matter.js、ECS、自制引擎或第二套游戏运行时；
- 未经医学发布的病例进入玩家运行时；
- 将完整问诊、诊断或结果 UI 画进 Phaser Canvas。

## 7. 所有权与三条生产线

| 工作 | AI 主责 | 用户主责 | 共同验收 |
|---|---|---|---|
| 架构、代码、测试 | 实现、验证、文档 | 定义体验目标 | 可玩构建 |
| 灰盒地图 | Tiled/占位实现 | 判断空间与动线 | 桌面与手机试玩 |
| 视觉方向 | 生成候选和风险分析 | 选择、否决、冻结 | 视觉圣经 |
| 正式地图与角色 | 规格、清理、导出、接入 | 提供/选择/修改/批准 | 游戏内观感 |
| UI | React/CSS/无障碍实现 | 信息层级和视觉批准 | 长文本与触控 |
| 音频 | 搜索建议、格式、加载、混音接入 | 试听、来源和氛围批准 | 游戏内实际音量 |
| 模型接入 | port、adapter、恢复、错误处理 | 体验与等待反馈 | 真实纵切 |
| 奖励与解锁 | 规则、流水、幂等实现 | 决定奖励意义与节奏 | 重复结算测试 |
| 存档 | Schema、迁移、恢复 | 提示和产品边界 | 刷新/损坏测试 |
| 发布 | 自动回归和证据 | 真机试玩、许可、go/no-go | RC 验收 |

AI 遇到未确认的美术、奖励或产品参数时，应继续执行不依赖该决定的代码、测试和灰盒工作；只把受影响的批量资产或最终集成标记为 `blocked_user`。

## 8. 修订后的用户—AI 工作流

用户提出的原流程方向正确，但“用户先提供全部素材，AI 才开始代码”会导致规格过早冻结和长时间停工。正式流程调整为：

```text
第 1 轮：范围与体验访谈
→ AI 分析玩法、技术、风险和待决事项
→ AI 生成 2–3 个视觉方向和灰盒方案

并行：
├─ AI 使用 placeholder 建立 Tiled/状态机/mock/存档基础
└─ 用户评审视觉方向、空间和关键资产需求

代表性诊室灰盒
→ 用户实际试玩
→ 冻结逻辑分辨率、tile、frame、pivot、碰撞和导出合同

每一批素材：
详细询问
→ AI 分析
→ AI 给出素材卡、候选尺寸、工具、社区、搜索词/提示词、许可要求
→ 用户提供或选择素材
→ AI 做技术规格检查
→ 用户做静态视觉审批
→ AI 集成代码
→ AI 提供实际操作构建和验证证据
→ 用户做游戏内审批
→ 修改
→ ACCEPTED / LOCKED

完整 mock 闭环
→ contract 与恢复门
→ 至少两个医学已发布病例的真实 adapter 顺序接诊纵切
→ 真机和 RC 门
```

每轮只处理一个问题组：空间/构图、比例/轮廓、色彩/光影、细节、动画、游戏内适配不得在同一轮全部重做。

## 9. 人工确认门

| 门 | 用户必须确认 | 未确认时 AI 仍可继续 |
|---|---|---|
| H-START 实施授权门 | 批准 AI 按本计划进入 S0；不等于一次性批准所有美术、玩法和发布决定 | 只读盘点、问题整理和计划修订 |
| H0 范围门 | MVP 层级、首发范围、非目标、AI 执行边界和决策记录方式 | 已授权范围内的基线验证；不得冻结仍有分歧的玩法 |
| H1 玩法门 | 已确认开场/电脑/队列/叫号/离场循环；仍需确认首项检查、队列数值、金币/声望公式、首个购买与升级、重玩规则 | 技术骨架和 placeholder |
| H2 视觉方向门 | 关键词、反例、主方向、目标情绪 | 灰盒、domain、adapter |
| H3 技术美术门 | 逻辑分辨率、tile、角色 frame、pivot、色板和 Tiled 合同 | 与尺寸无关的业务代码 |
| H4 素材来源门 | 外部/AI 素材许可和正式使用 | 继续用 placeholder |
| H5 静态黄金资产门 | 诊室、医生坐姿、至少两名患者、电脑/叫号、帘后设备、气泡/报告/商店/升级 UI 静态稿 | 测试、存档、经营基础 |
| H6 游戏内美术门 | 动画、遮挡、比例、手机可读性 | 其他已批准资产接入 |
| H7 经营体验门 | 金币/声望公式、购买价格、升级阈值、门槛商品和反馈 | 幂等流水和存档基础 |
| H8 模型运行时发布门 | 完整 model runtime-release manifest/gate 通过，并包含可供纵切的已发布病例 | 全部 mock/fixture、transport 设计和合成 producer tests；不得开启远程任意玩家交互 |
| H9 Integrated MVP 门 | 真实模型延迟、错误、恢复和隐藏信息 | mock 回归和缺陷修复 |
| H10 RC 门 | 真机、整体观感、许可、文案和 go/no-go | 自动回归和报告 |

H8 不得由游戏层自行降级成“找到一个 `packageStatus=published` 病例”。执行 S10b 前，AI 必须读取模型层当时的最新发布清单并逐项验证至少包括：

- 病例的两个独立 AI validator、六项检查、内容 hash 与 red-flag 证据满足模型层门槛；
- 固定急症、自伤和现实健康输入安全模板已版本化并通过自动回归；
- 165 条安全语料的本地策略/模板回归已通过；另有与 `datasetVersion + corpusHash + policyVersion + templateRegistryHash` 绑定的独立 AI 验证产物，且 33 条固定 holdout 未被回写或泄露给被测策略；
- 当前源码纠偏后的独立病例 validation sidecar、5 病例真实候选 benchmark、安全语料 AI 验证、独立 AI 抽样、批准 Provider/model identity、真实连续对话验收和 runtime-release manifest 均已重新生成且可机器验证；
- 远程任意交互已在模型层显式启用，当前目标 Provider/model、日志、隐私和故障策略已进入不可变 runtime-release manifest；
- 相应 Phase 8/Software RC 运行时门已经通过，或模型计划明确给出供游戏 Integrated MVP 使用的同等级批准产物。

任何发布必需项仍是 `blocked` 或只能由 draft/mock 证明时，H8 都保持未通过；`pending_medical_review` 等人工反馈兼容元数据本身不再阻塞 H8。

## 10. 美术与非代码素材合同

### 10.1 素材状态

```text
DRAFT       AI/用户探索中
→ REVIEW    等待用户静态评审
→ APPROVED  用户允许进入技术集成
→ IN_GAME   已接入真实 Phaser/React 场景
→ ACCEPTED  用户已在实际游戏中验收
→ LOCKED    可作为批量派生的黄金样板
```

- 只有 `APPROVED` 以上素材可以进入正式集成分支；
- 只有 `ACCEPTED` 素材可以进入候选构建；
- 只有 `LOCKED` 样板可以用于批量派生；
- placeholder 永远不因“能加载”自动晋升；
- 修改 `LOCKED` 素材必须走第 18 节计划变更协议。

### 10.2 每项素材任务卡

AI 在请求用户提供素材前，必须输出并保存以下卡片；未知尺寸必须写“候选/待 H3 冻结”，不能猜成最终值。

```text
assetId：
资产类别：地图 / tileset / sprite / UI / audio / font
用途与出现位置：
玩家应感受到：
必须保留：
允许变化：
绝对不要：
参考图及“只借鉴什么”：
原创 / 外部来源 / AI 生成：
建议社区、搜索词或生成工具：
建议生成提示词：
可编辑源格式：
运行时格式：
候选尺寸：
冻结尺寸：
tile / frame 网格：
帧数、帧序和 FPS：
pivot / foot point：
碰撞体 / 交互点：
色彩空间、透明度、边距、padding/extrusion 和命名：
音频 master sample rate / bit depth / mono-stereo：
音频运行时 codec fallback / 时长 / loop sample boundary / fade：
音频 target loudness / true peak / 单文件与总预算：
许可证、作者、URL、下载日期：
是否允许商用、修改和再分发：
署名文本：
contentBuildId：
当前状态：
静态审批：
游戏内审批：
本轮验收标准：
```

### 10.3 MVP 最小素材包

| 类别 | 最小内容 | 技术要求 | 用户审批重点 |
|---|---|---|---|
| 诊所地图 | 左侧室外队列与门、中部接诊区、右侧帘后检查区、桌面可见的上/下锁定区 | Tiled `.tmj` 源；运行时未压缩 JSON；固定层名；稳定座位/队列/设备/扩展房间锚点 | 空间、患者循环动线、手机/桌面镜头 |
| Tileset | 地板、墙、门、桌、椅、电脑、叫号按钮、候诊点、帘子、床、检查设备、柜子、灰雾锁定遮罩 | 一张连续 PNG；不得使用 Collection of Images；tile 尺寸 H3 后冻结 | 透视、色板、物体识别、锁定区可读性 |
| 玩家医生 | 4 向移动、站立 idle、开场/接诊坐姿 | 固定网格 spritesheet；透明背景；脚底与座位锚点一致 | 主角气质、坐姿比例、动画节奏 |
| 患者组 | 参考现有三种公开人物人格制作三类可区分原型；排队 idle、移动、接诊坐姿、帘后等待、普通/愤怒离场 | 与玩家同一视角/像素密度；不得通过造型泄露诊断；允许共享基础骨架但需可辨识 | 尊重性、可信度、辨识度、队列不拥挤 |
| 电脑与叫号 | 电脑交互状态、开诊终端和桌面叫号反馈 | 稳定 `interactionId`；普通/hover/focus/disabled/active 状态清楚 | 玩家是否一眼理解开诊和叫号 |
| 初始检查设备 | 右侧血压设备与抽屉体温计 | 两个 `deviceId` 与公开 `testId` 分离；血压设备状态清楚；体温检查具备医生取出/递交/接回/收纳和 NPC 接过/测量/归还状态；自动序列可恢复 | 医疗场景可信、交接关系清楚、无需玩家操作、无小游戏误导 |
| 购买/升级内容 | 3 级盆栽、诊所等级 2 与 3 级候诊椅 | locked/available/purchased/unlocked 和 3 级外观状态可观察；每级外观可与 25% 声望加成流水对应 | 是否清楚体现金币、声望与升级收益 |
| 医疗/经营 UI | 角色锚定气泡、对话输入、电脑、报告纸、诊断、评分、商店、升级、等待、错误、恢复 | React DOM；中文正文不烘焙进图片；键盘焦点、触控、safe-area 和气泡避让 | 信息层级、与像素世界一致、手机可读性 |
| 音效 | 淡入后环境、开始接诊/门铃、叫号、脚步、坐下、帘子、按钮、患者普通/愤怒离场、金币、声望、购买、升级、解锁、错误 | 首次用户手势后解锁；保留 WAV master；冻结 sample rate/bit depth、mono/stereo、Web codec fallback、loudness、true peak 和文件预算 | 氛围、音量、是否夸张 |
| BGM | 1 首可无缝循环的诊所日间主题；MVP 不做独立标题/菜单曲 | 保留可编辑 master；冻结无缝 sample boundary、codec fallback、loudness/true peak；来源和 Content ID 风险可追溯 | 是否与方向 A 一致、长期循环不疲劳 |

H3 前，`320×180 + 16px tile` 只是项目候选。AI 应至少用 16px 与 32px 两组技术样片或等价证据比较手机可读性、贴图量和角色表现，再提出冻结建议。

### 10.4 推荐社区、工具和许可规则

#### 免费/开放素材候选

| 来源 | 适合 | 使用规则 |
|---|---|---|
| [Kenney](https://kenney.nl/assets) | 占位 UI、通用物件、音效、快速原型 | 官方资产页多数为 CC0；下载时仍保存具体资产页和随包 license |
| [OpenGameArt](https://opengameart.org/) | 像素 tileset、角色、图标、音乐、音效 | 逐项许可证不同；优先 CC0，其次完整记录 CC BY；GPL/CC BY-SA/NC 项不得默认采用 |
| [itch.io Game Assets](https://itch.io/game-assets) | 独立美术包、像素环境、UI、音频 | “免费/零元下载”只是价格，不等于许可；必须阅读每个作者页面和包内 license |
| [Freesound](https://freesound.org/) | 门铃、脚步、环境、UI 和设备音效 | 使用高级筛选优先 CC0；CC BY 必须署名；默认排除 CC BY-NC |
| [Pixabay Audio](https://pixabay.com/music/) | 背景音乐和通用音效候选 | 保存下载链接、文件名和许可证证明；不得把原素材作为独立音频重新分发，并检查 Content ID 风险 |

默认策略：原创/用户提供并可证明权利的素材 > CC0 > 可完整署名的 CC BY > 其他许可。来源不明、仅写“free”、禁止商用、禁止改编、CC BY-NC 或无法保存许可证证据的素材不得进入正式版本。

#### 制作与 AI 辅助工具

| 工具 | 用途 | 边界 |
|---|---|---|
| [Tiled](https://www.mapeditor.org/) | 地图、层、碰撞、对象和稳定属性 | 本项目正式地图工具 |
| [Aseprite](https://www.aseprite.org/) | 像素源文件、动画和 spritesheet | 付费许可；保留 `.aseprite` 源文件 |
| [LibreSprite](https://libresprite.github.io/) | 免费像素编辑替代 | 导出前仍按同一 frame/grid 合同校验 |
| [Audacity](https://www.audacityteam.org/) | 剪辑、降噪、淡入淡出、循环检查 | 编辑器许可不替代输入音频素材许可 |
| 项目可用的图像生成能力 | moodboard、方向草案、构图候选、接触表 | 不经用户审批和人工清理不得直接当正式资源 |
| [PixelLab](https://www.pixellab.ai/) | 4/8 向像素角色、动画、物件和 tileset 候选 | 输出需检查账户条款、尺寸、脚点、方向一致性、风格漂移和商业使用条件 |

AI 生成素材必须记录工具、日期、提示词、参考输入、输出版本和人工修改；禁止以“模仿某位在世艺术家风格”作为正式生产捷径。

### 10.5 生成提示词模板

#### 场景方向图

```text
Top-down orthographic 2D pixel-art clinic interior concept for a browser simulation game.
Mood: [温暖 / 专业 / 克制 / 轻松].
Include: a nearly square consultation room, entrance and visible patient queue on the left,
a left-facing consultation desk in the center, doctor seat on the right side of the desk,
patient seat on the left side, a small computer and call-next button on the desk,
a curtain-separated bed and one examination device on the right,
plus muted locked expansion areas above and below for the desktop composition.
Consistent single camera angle, consistent light direction, limited palette,
clear silhouettes, respectful adult patient representation.
No isometric perspective, no text, no logo, no watermark, no diagnosis clues,
no horror-hospital atmosphere, no mixed pixel densities, no copied game assets or UI.
This is a visual-direction concept, not a final production tileset.
```

#### H3 冻结后的 tileset

```text
Top-down orthographic pixel-art clinic tileset on an exact [TILE_SIZE]×[TILE_SIZE] grid.
Warm professional community-clinic style matching reference asset [GOLDEN_ASSET_ID].
Create modular floor, wall, inside/outside corners, doorway, desk, chair,
waiting chair, cabinet and examination furniture.
One consistent palette and light direction, hard pixel edges, no anti-aliasing,
no gradients, no text, no logo, no watermark, no perspective mismatch.
Output as separated candidates for manual cleanup; do not fake a Tiled-ready sheet.
```

#### 玩家/患者 4 向角色

```text
Four-direction top-down pixel-art character sprite for [ROLE].
Exact frame [FRAME_W]×[FRAME_H], transparent background, fixed foot anchor,
same body proportions, clothes and colors in north/south/east/west views.
Required states: idle and walk; [PATIENT only: waiting idle].
Match golden character [GOLDEN_ASSET_ID].
No text, no logo, no watermark, no extra props, no diagnosis-revealing appearance,
no frame-to-frame body drift, no anti-aliasing.
```

#### 音频搜索词

```text
clinic entrance bell / soft door chime / quiet clinic ambience
subtle UI confirm / UI cancel / UI error
warm reward stinger / gentle unlock sound
soft indoor footsteps / chair movement
```

下载前必须逐文件检查是否包含人声、真实姓名、品牌设备声、版权音乐片段或不适合医疗场景的喜剧效果。

## 11. 目标架构与核心状态

### 11.1 运行时架构

```text
Next / React DOM
├─ ClinicShell
├─ OrientationGate / FadeIntro
├─ SpeechBubbleLayer
├─ ClinicComputerPanel
├─ QueueAndCallStatus
├─ ConsultationPanel
├─ TestStatus / ExaminationReportPanel
├─ DiagnosisPanel
├─ EvaluationPanel
├─ RewardSettlementPanel
├─ ShopPanel / UpgradePanel
├─ SaveRecoveryPanel
└─ Loading / Error / Safety / Expired UI
          ↕ typed serializable bridge
Phaser
├─ BootScene
├─ PreloadScene
├─ WorldScene
└─ OverlayScene（仅轻量提示）

纯 TypeScript game domain
├─ clinic-flow
├─ patient-queue / seating / examination-flow
├─ interaction
├─ case-projection
├─ rewards
├─ economy + reputation
├─ shop / facilities / upgrades / unlocks
└─ save

Adapters / systems
├─ asset manifest + Tiled loader
├─ input + audio
├─ IndexedDB save adapter
├─ MedicalSessionPort
│  ├─ MockMedicalSessionAdapter
│  └─ HttpMedicalSessionAdapter
└─ hidden-field / compatibility validation
```

Scene 只能适配渲染、输入和世界对象，不能成为患者流程、奖励、医学会话或存档状态的唯一事实源。

### 11.2 诊所与患者流程状态

建议建立可序列化游戏状态：

```text
boot_loading
→ intro_fading_in
→ doctor_seated_intro
→ clinic_ready
→ computer_opened
→ business_opened
→ queue_forming
→ ready_to_call
→ patient_entering
→ patient_seated
→ consultation_active
→ test_outbound
→ test_pending
→ test_returning
→ report_ready
→ diagnosis_submitted
→ evaluation_pending
→ evaluation_completed
→ reward_pending
→ reward_granted
→ patient_leaving
→ ready_to_call / shift_completed
```

要求：

- 每个开诊使用稳定 `shiftId`，每次叫号使用稳定 `callId`，每名患者使用稳定 `queueEntryId`/`arrivalId`/`npcId`；同一事件只提交一次；
- 页面刷新后恢复同一队列顺序、当前患者、座位占用、检查动线和 session，不重新生成或跳过患者；
- Phaser 动画不是权威状态；动画完成事件只能请求 domain 转换；
- 患者到座后才开放“对话”，回座并收到 completed 检查结果后才开放“查看”，离场 checkpoint 后才释放座位和重新叫号；
- 诊疗医学状态以服务端 `SessionPhaseV1` 为权威，游戏只保存显示镜像；
- `evaluation_pending`、`evaluating` 或 `EVALUATION_UNAVAILABLE` 尚未产生合法 `EvaluationResultV1` 时不得进入 `reward_granted`；
- 同一 `evaluationId` 只能产生一笔同时包含金币与声望的奖励流水和一次相应解锁；购买和升级使用各自稳定交易 ID，余额不足或声望不足不得产生部分写入。
- 商店/升级是电脑交互的正交子状态，可在没有患者移动、没有医学请求待完成且产品规则允许的空档打开；它不插入或改变医学 `SessionPhaseV1`。

### 11.3 游戏侧 MedicalSessionPort

端口只允许组合 share 公共 DTO。`MedicalSessionReadModel` 是游戏 application 层的本地读模型，不是现存 wire DTO，也不得被当作已经冻结的 HTTP 响应：

```ts
type MedicalSessionReadModel = {
  reference: SessionReferenceV1;
  summary: CaseSummaryV1;
  projection: ClientCaseProjectionV1;
  evaluation?: EvaluationResultV1;
};

interface MedicalSessionPort {
  createSession(request: CreateSessionRequestV1): Promise<CreateSessionResponseV1>;
  getSession(sessionId: SessionIdV1): Promise<MedicalSessionReadModel>;
  submitTurn(
    sessionId: SessionIdV1,
    request: TurnRequestV1,
    onEvent?: (event: PublicEventV1) => void,
  ): Promise<TurnCompletedV1>;
  orderTest(
    sessionId: SessionIdV1,
    request: TestRequestV1,
    onEvent?: (event: PublicEventV1) => void,
  ): Promise<TestResultV1>;
  submitDiagnosis(
    sessionId: SessionIdV1,
    request: DiagnosisSubmissionV1,
    onEvent?: (event: PublicEventV1) => void,
  ): Promise<DiagnosisAcceptedV1>;
  cancelSession(
    sessionId: SessionIdV1,
    request: CancelSessionRequestV1,
  ): Promise<CancelSessionResponseV1>;
}
```

当前 `share/contracts/v1` 没有 `SessionSnapshotV1`，也没有冻结的 GET-session wire response 或 OpenAPI transport。S4 的 mock 可以在游戏内部组装上述读模型；S10a 必须先通过共享层变更流程增加并冻结合法的公共查询/恢复 DTO、JSON Schema、正反 fixture、changelog 和 compatibility evidence，S10b 才能消费。不得为了匹配本草案而复制一套 wire 类型或让客户端强转未知 JSON。

`submitDiagnosis` 只返回 `DiagnosisAcceptedV1`。最终评分只能来自 `evaluation.completed` 的 `EvaluationResultV1` 或权威查询；`EvaluationResultV1.scores.total` 在当前契约中是必填数字。尚在 `evaluating` 或收到 `EVALUATION_UNAVAILABLE` 时，游戏保持 pending/recovery UI，不构造 partial `EvaluationResultV1`，也不补 `total=0`。

### 11.4 事件和恢复

- `patient.reply.delta` 只用于临时显示；
- `patient.reply.completed`、`test.completed`、`evaluation.completed` 或会话查询才提交权威状态；
- `TurnCompletedV1.effects` 中的 `test_completed`/`test_unavailable` 与显式 `orderTest` 复用同一检查表现入口；先展示患者 reply，再按 effects 顺序推进检查状态，幂等重放不得重复启动走路、报告或扣费；
- 事件按 `eventId` 去重，同一 session 按 `sequence` 排序；
- 未知 eventType 不修改权威状态；
- 断流后优先查询会话，不盲目重复模型调用或诊断提交；
- `DiagnosisAcceptedV1` 只证明诊断写入已接受，不证明评价已完成；
- 若写请求响应未知，先用同一幂等标识和权威查询判断服务端事实，不能从 UI 状态推断成功或失败；
- 所有写请求使用 `clientRequestId`/`clientTurnId` 和 share fingerprint 语义；
- 相同 key + 相同 hash 返回首次结果；相同 key + 不同 hash 返回 `IDEMPOTENCY_CONFLICT`。

### 11.5 奖励与解锁

```text
EvaluationResultV1
→ 构造 RewardInputV1
→ RewardPolicy v1（纯 TypeScript）
→ RewardTransaction(evaluationId, coins, reputation, rewardRuleVersion)
→ ShopPurchaseTransaction(purchaseId, coins)
→ ReputationUpgradeTransaction(upgradeId, reputationThreshold)
→ UnlockTransaction(unlockId, sourceTransactionId)
→ UI/Phaser 表现
```

- LLM 文本、复盘文字和自由文本解释不得作为奖励输入；
- 奖励公式、等级映射、重玩衰减和明确终局类型必须通过 H7；MVP 不从评分自行推导二元失败阈值，失败终局统一为 0 金币/-50 声望；
- 技术实现先支持配置化 policy，不提前冻结长期经济曲线；
- 奖励流水必须同时原子提交金币与声望；购买、升级和解锁必须能在刷新、断流、重复事件和多标签页下保持一次性；
- 金币是可消费余额，声望是累计进度，首版默认不因升级扣除声望；若 H7 决定采用消耗型声望，必须单独记录并增加迁移/回滚测试；
- 商店可见性由 `upgradeLevel`/解锁条件的纯规则决定，模型层和 LLM 不直接决定商品、价格或等级。

结算必须使用 crash-safe 原子协议。以 `evaluationId` 作为全局唯一处理键；同一 evaluation 无论后来规则版本如何变化都不能产生第二笔奖励。`rewardRuleVersion` 和 `RewardInputV1` 的 canonical hash 被写入原始收据，用于审计而不是组成可再次发奖的新主键。

```text
收到合法 EvaluationResultV1
→ 纯函数计算 SettlementPlan
→ 开启同一 IndexedDB database 的单个 readwrite transaction
→ 查询 processedEvaluations[evaluationId]
   ├─ 已存在且 inputHash 一致：返回既有 receipt，仅重放未展示的 UI
   ├─ 已存在但 inputHash/规则事实冲突：进入 recovery-required，不重算、不覆盖
   └─ 不存在：在同一 transaction 内同时写入
      processed evaluation marker
      + reward ledger receipt
      + unlock ledger receipt
      + profile coin balance + reputation total/level
      + clinic-flow checkpoint
→ 等 transaction 完成后才显示“已领取/已解锁”
```

崩溃语义：commit 前崩溃则整笔 transaction 不可见，恢复后可以安全重试；commit 后、UI 更新前崩溃则恢复时读取既有 receipt，只补表现，不再次发奖。多标签页的 UI 主标签锁只是体验优化，正确性最终依赖同一数据库 transaction、唯一 `evaluationId` 和冲突后读取既有 receipt。

### 11.6 存档边界

```ts
type SaveEnvelope = {
  schemaVersion: number;
  contentBuildId: string;
  updatedAt: string;
  slotId: "autosave" | string;
  payload: GameSave;
};
```

本地允许保存：玩家位置、地图、横屏/镜头设置、开场状态、`shiftId`、队列顺序、当前患者、座位/检查/离场 checkpoint、金币、声望、购买/升级/奖励流水、解锁、设置、`sessionId`、`caseVersion`、session phase 镜像、已经展示的对话气泡/检查报告缓存和结果摘要。

本地禁止保存：完整病例、未披露事实、答案、rubric、prompt、模型密钥、内部推理和服务端安全规则细节。

IndexedDB 至少分离并在同一数据库中支持原子结算的 stores：`saveSlots`、`processedEvaluations`、`rewardLedger`、`purchaseLedger`、`upgradeLedger`、`unlockLedger` 和 `profile`。具体命名可调整，但以下事实必须位于同一 readwrite transaction：processed `evaluationId`、reward receipt、unlock receipt、金币/声望和 clinic-flow checkpoint；购买/升级也必须在各自单个 transaction 中同时提交扣款、等级、商品/解锁和 UI checkpoint。禁止“先加余额、稍后再写已处理标记”或跨两个数据库完成结算。

恢复顺序：

```text
读取 IndexedDB
→ 校验 saveSchemaVersion 和 contentBuildId
→ 恢复本地世界/经营状态
→ 使用 sessionId 查询服务端权威医学状态
→ 对比 contractVersion 和 caseVersion
→ 合并 allowlist projection
→ 恢复 UI，或进入 expired/incompatible/recovery-required
```

## 12. 实施步骤

本计划拆成 12 个主步骤，其中 S10 明确包含“服务端/transport 交付”和“游戏 adapter 消费”两个不同 owner 的受门控子步骤。每一步都应形成一个清晰的本地 checkpoint；当前 GitHub CLI 未登录且工作树存在其他未提交工作，因此默认采用本地 direct mode，不自动创建 PR，也不得使用 `git reset --hard`、`git checkout --` 或清理无关文件。每个执行者开始前重新检查 Git 状态。

### S0：计划冻结、技术基线和决策登记

状态：`complete`（2026-08-29；自动基线通过，H0/H1 已由项目负责人确认并同步决策记录）

依赖：H-START 实施授权门；H0/H1 在本步骤内完成，不得反过来作为 S0 的入口依赖

冷启动上下文：当前游戏是可运行的 Phaser/React 占位 PoC；share v1-rc1 已实现但 game adapter pending；5 个冻结病例已有双 AI 验证记录，但当前源码纠偏后的 runtime manifest、真实 AI 对话验收与 Software RC 尚需重建，因此不能视为当前 live-ready。本步骤不制作正式地图或美术。

目标：把会改变架构、资源规模或验收定义的决定显式登记，证明现有基线可运行，并准备后续 AI 可重复执行的命令与文档。

AI 自主任务：

- 读取第 2.1 节全部上下文；
- 运行并记录 `git status --short --branch`；
- 检查本机 Node、npm、game 与 share engines；
- 为后续集成统一 Node `>=22.18` 的执行建议；
- 在不修改业务代码的前提下运行 game 和 share 当前基线；
- 建立本计划的决策日志、人工门跟踪表和素材审批清单；
- 记录当前 `contentBuildId=dev`、现有测试数量和未实现模块；
- 确认任何真实 API Key 都不进入仓库；
- 确认所有 model draft 只用于离线开发，不复制到 game/public。

必须向用户分轮询问：

- 第 4.3 节剩余的 12 个 H0 问题；不得重问 G-D13–G-D23 已确认的体验方向；
- 每轮最多 3–5 个相互关联的问题；
- 每个答案转成稳定决策 ID；
- 对用户暂时无法决定的事项，给出 2–3 个选项、影响和推荐默认值，不强迫一次答完。

主要文件/交付物：

- 本计划状态与决策段；
- 新增时才创建 `docx/plan/game/decisions/`，不预生成空目录；
- 基线验证报告；
- 第一版开放问题表。

自动验证：

```powershell
cd D:\Learn\20_Projects\MedicalAI\apps\game\game
npm run lint
npm run typecheck
npm test
npm run build

cd D:\Learn\20_Projects\MedicalAI\apps\game\share
npm run typecheck
npm test
npm run test:contract
```

人工验收：用户确认 MVP 层级、首例范围、参与方式和本计划的执行权边界，完成 H0；玩法临时决定完成 H1 的可开工部分。

退出条件：

- H0 通过；
- H1 已确认的开场、电脑、队列、叫号、气泡、检查自主操作和离场循环写入决策记录；首项检查、队列数值、金币/声望公式、购买与升级至少已有可用于灰盒的临时决定；
- 基线命令通过或失败原因已经单独记录；
- 没有未解释的 secret 或用户文件变更；
- 后续步骤知道哪些分支可继续、哪些只能使用 placeholder。

回滚：本步骤原则上只改计划和决策文档；移除未批准的计划附录即可，不触碰现有游戏运行时。

### S1：体验深访谈、视觉方向和第一批素材任务书

状态：`complete`（2026-08-29；项目负责人批准方向 A，Visual Bible v0.1 与扩展素材任务卡已同步）

依赖：S0；可与 S4 的纯契约工作并行

冷启动上下文：正式分辨率、tile、角色 frame 和色板仍未冻结。当前 320×180 与程序纹理仅为技术占位。此步骤不得批量生成正式资产。

目标：将“我想要什么样的诊所和游戏”转成可比较的视觉方向、体验原则、禁止项和代表性诊室资产清单。

G-D13–G-D23 已构成不得重问的产品起点。访谈只为补足美术、数值和交互细节，不得把“是否横屏”“是否用电脑开诊”“是否有队列/叫号/气泡/帘后检查/患者离场”重新开放。

访谈轮次：

1. 产品情绪：目标玩家、五个关键词、三个以上反例、希望玩家在首局结束时的感受；
2. 空间与叙事细化：诊所类型、年代、整洁度、桌椅尺寸、门外队列容量、帘子材质、床/设备密度、上/下锁定区轮廓；既定左门—中部接诊—右侧检查布局不再重选；
3. 角色：玩家医生坐姿/站姿、至少两名患者、服装、年龄段、身体比例、多样性和不得使用的刻板化；
4. 视觉：像素密度、色板、轮廓、阴影、UI 现代感/像素感、中文字体；
5. 声音与反馈：淡入、电脑、开始接诊、叫号、开门、脚步、坐下、帘子、患者离场、问诊、金币、声望、购买、升级、解锁、错误和 BGM；
6. 用户能力：可用工具、愿意亲自修改哪些源文件、可投入的评审频率和真机设备。

AI 自主任务：

- 整理用户参考图，但逐张记录“只借鉴什么”；
- 输出 2–3 个明确不同且内部一致的视觉方向；
- 每个方向说明优点、制作成本、移动端风险、中文 UI 风险和素材可得性；
- 输出 `Visual Bible v0.1`，所有尺寸标为候选；
- 输出第一间诊所的功能布局草图和 Tiled 对象清单；
- 输出第一批素材任务卡：诊室、玩家、患者、初始设备、解锁内容、UI、音效；
- 为每张任务卡提供社区、搜索词、提示词、源格式和许可要求；
- 将用户否决项写入永久“禁止方向”，避免后续 AI 重复提出。

用户提供：

- 3–8 张参考图或实际诊所照片；
- 每张图明确想借鉴的局部；
- 3–5 个绝对不要的方向；
- 如有 AhaMed 品牌色、Logo 使用规范或现有网站截图，作为参考而非自动烘焙进像素图；
- 第一间诊所必须出现的物件清单。

自动验证：此步骤不以代码测试代替视觉判断；AI 检查每张素材任务卡是否包含来源、格式、候选尺寸、审批状态和验收标准。

人工验收：H2 通过；用户选定一个主方向，可从其他方向保留有限局部，但不能保留互相冲突的多个主风格。

退出条件：

- `Visual Bible v0.1` 获得用户方向批准；
- 第一间诊所功能布局和患者路线可用于灰盒；
- 第一批素材任务卡完整；
- 尚未冻结的数字明确标为候选；
- 用户无需一次性提供全部正式素材，S2 可使用 placeholder 开始。

回滚：视觉方向未通过时只重做方向稿，不修改已验证的运行时和业务 domain。

### S2：Tiled 诊所灰盒、横屏开场、电脑/队列/叫号与真实操作 PoC

状态：`engineering_complete`（2026-08-29；Tiled 灰盒与自动门完成，H3/真机体验待项目负责人确认）

依赖：S0 + S1；至少 H2 主视觉方向和功能布局已确认，正式美术可尚未提供。若 H2 未通过，只能建立不绑定最终尺寸/布局的 loader、domain 和测试骨架，不能进行代表性灰盒验收或冻结 H3

冷启动上下文：当前 `WorldScene` 使用硬编码矩形和程序纹理。本步骤的目的不是做漂亮场景，而是用真实 Tiled 数据验证第 4.4 节空间合同、横屏构图、开场、电脑、队列、叫号、座位和目标设备表现。

目标：完成一个可玩的代表性诊所灰盒，并用实际设备证据冻结技术美术合同。

AI 自主任务：

- 新增实际需要的 `PreloadScene`；
- 建立一张 Tiled `.tmj` 灰盒地图：左侧室外队列/门、中部接诊桌/电脑/叫号/双座位、右侧帘后床/设备、上/下扩展区；
- 实现 `Ground / Decoration / Collision / AbovePlayer / Objects` 层合同；
- 实现稳定 `mapId`、`spawnId`、`npcId`、`interactionId`、`shiftId`、`queueEntryId`、`callId`、`arrivalId`、`seatAnchorId`、`examAnchorId`、`deviceId`；
- 不使用 Tiled GID、数组下标或 Phaser 对象 ID 作为存档标识；
- 实现玩家脚部碰撞体、前景遮挡、相机和整数像素对齐；
- 实现横屏 `OrientationGate`：竖屏暂停世界、屏蔽业务提交并提示旋转；横屏恢复不重复状态转换；
- 实现黑屏淡入、玩家医生坐姿和开场气泡；加载错误不能被无限黑屏掩盖；
- 实现桌边电脑交互和“开始接诊 / 商店 / 升级”灰盒 UI；S2 中商店/升级可以显示明确锁定状态；
- 实现确定性 `doctor_seated_intro → computer_opened → business_opened → queue_forming → ready_to_call → patient_entering → patient_seated`；
- 建立至少两个队列条目和固定室外候诊锚点；只有队首响应叫号，叫号前不得自行进门；
- 患者从固定入口沿固定路径/路点到患者座并切换坐姿，不引入通用寻路系统；
- 实现第一名患者离场和第二名患者进入的纯流程灰盒；医学结算触发由 S6 接入；
- 同一运行期内隐藏/恢复、重复点击开始接诊或叫号不得复制队列、患者或座位占用；刷新持久恢复由 S8 验收；
- 建立“开始接诊”“队列已形成”“叫号”“患者正在进入”“可以对话”的轻量提示和气泡占位；
- 实现手机安全构图与桌面扩展构图：手机优先看见队列/门/接诊区，桌面额外显示上/下灰雾锁定区；两端共享同一世界状态；
- DOM 面板打开时隔离 Canvas 输入；
- 建立资源缺失和 WebGL 不可用的基础提示；
- 采集 16px/32px 或其他候选规格的实际截图、可读性和性能数据。

用户可提供但不阻塞代码：

- 手绘平面图、截图标注或物件优先级；
- placeholder 色板偏好；
- 患者入口和候诊位的选择。

可能修改/新增的文件：

```text
game/src/game/scenes/PreloadScene.ts
game/src/game/scenes/WorldScene.ts
game/src/game/domain/clinic-flow/*
game/src/game/domain/interaction/*
game/src/game/systems/maps/*
game/assets/source/maps/*
game/public/game-assets/<build-id>/maps/*
game/tests/unit/map-*.test.ts
game/tests/unit/clinic-flow.test.ts
game/tests/e2e/clinic-graybox.spec.ts
```

AI 不应提前创建没有实际代码或说明的空目录。

自动验证：

```powershell
cd D:\Learn\20_Projects\MedicalAI\apps\game\game
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e -- --project=chromium
```

至少覆盖：Tiled 属性解析、非法/重复 ID、碰撞、遮挡、出生点、竖屏暂停/横屏恢复、淡入只提交一次、电脑开诊一次性、队列顺序、重复叫号、座位互斥、第一名离场后第二名进入、桌面/手机镜头安全区、桌面键盘、移动触控、DOM 打开时世界暂停、关闭后恢复。

人工操作测试：

1. 打开 `http://localhost:3020`；
2. 观察黑屏淡入、医生坐姿和“又是开始接诊的一天”气泡；
3. 点击电脑，确认三个入口存在；点击“开始接诊”并退出电脑；
4. 观察左侧队列形成，点击桌面叫号按钮，让队首从门口进入并落座；
5. 用灰盒完成第一名患者离场，再叫入第二名患者；
6. 绕房间走一圈，测试墙、桌椅、帘子、床、设备、患者和遮挡；
7. 在手机横屏测试队列/门/接诊区、触控和气泡可读性；转成竖屏确认世界暂停并出现旋转提示；
8. 在桌面确认上/下灰雾区可见但不可进入；
9. 重复点击开始接诊/叫号并切换一次后台/前台，确认队列、患者和座位不会重复。完整刷新恢复在 S8 操作测试中执行。

人工验收：用户对空间、移动速度、镜头、角色比例、患者到达节奏和手机可读性给出反馈。

退出条件：

- 一张真实 Tiled 灰盒可稳定加载；
- 淡入、坐姿、横屏门、电脑、队列、叫号、移动、碰撞、遮挡、双患者顺序和离场通过；
- 目标设备有真实证据；
- H3 冻结逻辑分辨率、tile、frame、pivot、碰撞体、动画命名和 Tiled 导出合同；
- 正式美术仍可以为空，但素材规格不再模糊。

回滚：保留现有程序纹理作为开发 fallback；新 Tiled loader 可通过开发配置回退到旧 PoC，直到灰盒门通过。

### S3：资产管线、正式规格和第一批素材接收

状态：`pending`

依赖：S2 + H3

冷启动上下文：技术美术数字已经由实际 PoC 冻结。本步骤建立源文件到不可变 content build 的可重复管线，不负责扩展完整医院。

目标：使用户提供的素材能够被检查、版本化、导出和安全加载，同时保留可编辑源文件和许可证据。

AI 自主任务：

- 根据 H3 将 `Visual Bible` 升级为 `v1.0`；
- 建立实际需要的 `assets/source/maps|tilesets|sprites|audio`；
- 建立 `public/game-assets/<contentBuildId>/` 输出；
- 实现 manifest 读取、版本、路径、重复 ID、缺失文件和 checksum/元数据检查；
- 实现 Boot 最小资源与 Preload 首场景资源分离；
- 为加载失败提供重试和可读错误；
- 验证 Tiled 发布 JSON 未压缩、tileset 连续 PNG、外部 `.tsj` 在发布前已验证/扁平化；
- 优先固定网格 spritesheet，不默认使用 Aseprite packed atlas；
- 为 sprite 帧边界、脚点、透明边缘和动画抖动建立检查；
- 建立素材许可证台账；
- 建立 DRAFT/REVIEW/APPROVED/IN_GAME/ACCEPTED/LOCKED 状态清单；
- 对每次正式内容变化生成新 `contentBuildId`，不覆盖旧路径。

用户提供：

- 按第 10.2 节任务卡提交第一批源素材或选择候选；
- 每项外部素材的 URL、作者、许可证和下载日期；
- AI 生成素材的工具、提示词和参考输入；
- 对静态稿做 H4/H5 审批。

自动验证：

- manifest 与文件一一对应；
- 所有 sprite 尺寸整除 frame 网格；
- Tiled 层和对象属性符合合同；
- 正式构建不引用 DRAFT/REVIEW 素材；
- 没有素材 ID 或文件名泄露病例答案；
- `npm run lint/typecheck/test/build` 通过；
- Playwright 覆盖资源缺失与重试。

人工验收：用户查看原始像素图、真实倍率截图和可玩场景三种材料；静态通过后进入集成，游戏内通过后才标记 ACCEPTED。

退出条件：

- `Visual Bible v1.0` 和技术美术合同冻结；
- 资产管线可重复产生同一 build；
- 第一批素材全部有源文件、运行产物、许可和状态；
- 至少一套代表性素材进入 IN_GAME；
- 未通过素材仍可安全回退 placeholder。

回滚：切回上一个不可变 `contentBuildId`；不删除源文件或覆盖旧内容包。

### S4：share 依赖、MedicalSessionPort 与确定性 mock adapter

状态：`pending`

依赖：S0；可与 S1–S3 并行，汇合前必须通过 contract gate

冷启动上下文：share v1-rc1 已实现公共 DTO、Schema、fixture、状态机、错误、事件和幂等；没有现成 game adapter 或 mock server。game 当前 Node engine 与 share 不一致。

目标：让游戏业务只依赖稳定 `MedicalSessionPort`，使用公共 fixture 完成可预测的医学数据流，不触碰 model 内部实现。

AI 自主任务：

- 将 game 开发/CI Node 基线统一到 `>=22.18`；
- 以本地 package 方式依赖 `@ahamed/doctor-game-share@1.0.0-rc.1`；
- 建立 `MedicalSessionPort`、`MedicalSessionFacade` 和 share DTO 映射；
- 实现 `MockMedicalSessionAdapter`；
- 明确 `share/fixtures/v1/public-fixtures.json` 只是分散 DTO 正反样例，不是可执行的有状态会话脚本；
- 建立 game-owned、版本化、仅含公开合成数据的 `MockScenarioV1` pack，逐步组合经过 Schema 验证的 share DTO；
- 支持创建/查询会话、问诊、检查、诊断、评分和取消；
- 支持 timeout、unavailable、stream interrupted、expired、version mismatch、safety interrupted；
- 实现事件 `eventId` 去重、`sequence` 排序和 completed 权威提交；
- 实现 share fingerprint 语义；
- 保证相同幂等 key/相同 payload 不重复副作用，不同 payload 返回冲突；
- 只保存 `projectClientCaseV1` allowlist projection；
- 在测试 harness 的私有上游对象中注入每次运行唯一 canary values，验证 projection、事件处理、日志和序列化输出都不含这些值；该私有 harness 不进入生产 bundle；
- 禁止 import `model/`，禁止复制病例私有 draft；
- 将 adapter 配置化，使 mock/HTTP 可以替换而不改变 UI/domain。

`MockScenarioV1` 至少明确：`scenarioId`、`scenarioVersion`、`contractVersion`、初始 session/case 公共投影、允许动作脚本、每步期望事件序列、最终权威读模型、幂等存储和可选 fault trigger。第一版必须覆盖：happy、two-patient-sequential、wrong-diagnosis、evaluation-unavailable、timeout、stream-interrupted、expired、version-mismatch、safety-interrupted 和 idempotency-conflict。`two-patient-sequential` 使用两个互相独立的公开合成 session，验证第一名 completed/离场后第二名才创建或恢复，队列顺序属于游戏层且不进入 share 医学状态机。触发方式使用测试配置或仅开发环境 scenario selector，不能把未发布病例真相或测试后门打进玩家生产构建。

建议文件：

```text
game/src/game/application/medical-session/*
game/src/game/adapters/medical/MockMedicalSessionAdapter.ts
game/src/game/adapters/medical/medical-session-port.ts
game/src/game/domain/case-projection/*
game/src/game/mocks/scenarios/*
game/tests/unit/medical-session-*.test.ts
game/tests/contract/*
```

自动验证：

```powershell
cd D:\Learn\20_Projects\MedicalAI\apps\game\share
npm run typecheck
npm run test:contract

cd D:\Learn\20_Projects\MedicalAI\apps\game\game
npm run lint
npm run typecheck
npm test
npm run build
```

契约测试至少覆盖：每个 scenario 的合法动作/非法动作/期望事件序列/最终读模型，创建会话、问诊 completed、检查 accepted/completed、诊断 accepted 与异步 evaluation completed、事件去重/排序、幂等冲突、超时、断流、过期、安全中断、allowlist 投影，以及禁用字段名和私有 canary value 的双重零泄露。

用户参与：无美术素材要求；只需在 S5/S6 体验错误文案和等待方式。

退出条件：

- game 只依赖 share，不依赖 model；
- mock adapter 可复现所有核心和失败路径；
- contract gate 通过；
- share RC 的不兼容问题已经登记，不由游戏复制或绕开类型解决。

回滚：保留 mock 为永久开发 adapter；依赖失败时回到上一运行 PoC，但不得以直接 import model 作为临时方案。

### S5：问诊与单项检查 React UI

状态：`pending`

依赖：S2 + S4；视觉可使用 S1/S3 的已批准素材或 placeholder

冷启动上下文：患者已能被叫号、落座并等待，mock adapter 已能创建会话、问诊和返回检查。所有角色发言必须靠近说话者呈现，但文字密集交互仍必须由 React DOM 实现。

目标：患者落座后以气泡问候并陈述主诉；玩家通过身旁“对话”入口自由问诊，再选择血压或体温检查。血压由患者自主前往设备完成；体温由医生与患者自动完成取出、递交、测量、归还和收纳，随后开放报告查看。

AI 自主任务：

- 扩展 typed bridge，只传稳定、可序列化业务事件；
- 建立 `SpeechBubbleLayer`：接收稳定 speaker ID 与 Phaser 屏幕锚点，用 React DOM 渲染、避让边缘/按钮，并提供短气泡收起和长文本展开；
- 将当前 GameCanvas mock 弹窗拆成可测试的气泡、对话输入、检查状态和报告纸组件；
- 患者到座前隐藏“对话”；到座后创建/恢复 session，以患者气泡依次显示问候和初始主诉，并在玩家旁显示“对话”按钮；
- 实现对话历史、输入和提交；玩家提交内容先显示在玩家气泡，患者 completed 回复显示在患者气泡；所有已提交发言可从可访问历史入口回看；
- 实现 `awaiting_model`、完成、超时、不可用、断流和安全中断 UI；
- DOM 打开时暂停 Phaser 世界输入，关闭后恢复；
- 单次输入遵守 share/已确认的最大字符和回合限制；
- delta 只作为患者气泡中的临时打字表现，completed 才写入 projection 和历史；
- 输入失败时保留玩家文本并提供安全的重试/状态查询；
- 实现一种检查的设备校验和医学检查请求；
- `deviceId` 属于游戏，`testId` 属于模型；
- 检查 accepted 后关闭患者座交互，患者沿固定路点到右侧帘后 `examAnchorId`，设备进入 pending；玩家不执行任何检查小游戏；
- 只有 completed 权威结果到达后患者才返回原座，并以气泡说明检查完成；unavailable/error 必须走可恢复回座或明确终止路径；
- 回座且 completed 后在患者旁显示“查看”按钮，打开报告纸 UI；报告正文、数值和附件只来自允许的 `TestResultV1` 或 `TurnCompletedV1.effects` 投影；
- 重复检查显示已有结果，不重复扣费或推进；
- 提供检查可用、pending、completed、unavailable 和错误状态；
- 长中文文本支持滚动、键盘焦点和移动端触控。

用户确认：

- 问诊 UI 信息层级和视觉；
- 模型等待期间展示什么；
- 安全中断和错误提示语气；
- 检查设备的表现和结果展示；
- 气泡最大宽度、停留时长、展开方式和历史入口；
- 检查 pending 时玩家是否允许在诊室内移动（建议允许，但不允许叫入下一位患者）；
- 是否允许关闭输入面板后继续在世界移动（建议 active 状态允许，awaiting_model 时仅关闭展示、不取消服务端操作）。

建议文件：

```text
game/components/consultation/*
game/components/tests/*
game/components/speech-bubbles/*
game/components/reports/*
game/components/status/*
game/src/game/bridge/gameBridge.ts
game/src/game/domain/dialogue/*
game/tests/unit/dialogue-*.test.ts
game/tests/e2e/consultation-mock.spec.ts
```

自动验证：

- UI 状态机和错误映射 unit tests；
- 输入长度、重复 turn、delta/completed、断流恢复；
- 检查一次性、`deviceId/testId` 映射、患者出座/帘后/回座和报告开放条件；
- 气泡锚点、边缘避让、玩家/患者 speaker 归属、delta/completed、长中文展开和历史回看；
- Playwright 验证键盘/触控、焦点隔离、移动锁定、气泡问诊、患者自主检查和报告查看；
- `lint/typecheck/test/build` 通过。

人工操作测试：用户叫入患者，观察问候/主诉气泡，点击玩家旁“对话”，输入多个中文问题，触发一种检查，观察患者到帘后、等待、回座与“查看”报告，再制造一次超时/断流并评价等待和恢复体验。

退出条件：

- mock 下全发言气泡、自由问诊、患者自主检查和报告查看稳定可用；
- 世界与 DOM 输入无冲突；
- 重复请求无第二副作用；
- 失败不伪造患者回答或检查结果；
- 用户对问诊、检查和等待体验给出第一轮反馈。

回滚：医疗 UI 可通过 adapter/config 回到固定 fixture 模式；不得把网络或模型错误转换成假成功。

### S6：诊断、评分与完整 Mock Playable 医疗闭环

状态：`pending`

依赖：S5

冷启动上下文：问诊和一种检查已通过 mock。此步骤完成诊断确认、评估等待、结果恢复和全部医学交互错误闭环；它仍不是发布病例或真实 LLM 证据。

目标：在 mock 下稳定完成“叫号 → 患者落座 → 问诊 → 检查/报告 → 诊断 → 评分 → 患者离场 → 下一位叫号”，并让结果成为后续奖励 domain 的唯一合法输入。

AI 自主任务：

- 实现主要诊断输入和可选鉴别诊断；
- 诊断采用自由文本、术语选择器或混合方式，以 H1 UI 决策为准；
- 提交前显示不可逆确认；
- 提交后阻止继续问诊、检查和第二次诊断；
- 实现 `diagnosis_submitted → evaluating → completed`；
- 实现评价等待、进度、超时、evaluation unavailable 和恢复；
- 诊断写结果未知时先查询权威 session，不盲目重复；
- 实现结构化诊断判断、六项评分、证据、总结和版本展示；
- 尚未收到合法 `EvaluationResultV1` 时显示“评分待完成”，不构造 partial result，也不伪造 0 分；
- 实现结果页返回世界的确定性行为；在 S7 奖励结算尚未接入时以明确灰盒确认继续，接入后由奖励领取完成触发离场；
- 实现患者离别气泡、起身、从左门离场、座位释放、队列推进和下一次叫号；患者尚未完成离场 checkpoint 时叫号按钮保持禁用；
- 为第二名公开合成患者创建独立 mock session，重复完整医疗闭环或至少完成叫号/落座/session 创建验证；不得复用第一名患者的 `sessionId`/幂等键/报告；
- 为正确、错误、部分评分和失败评分准备 public fixture；
- 完成 mock golden flow 和失败流 e2e。

用户确认：

- 诊断确认语气和是否允许返回修改；
- 结果页信息层级；
- 正确/错误诊断的情绪反馈强度；
- 是否展示全部六项评分和逐项证据；
- “评分暂时不可用”时的产品行为；
- 患者离别气泡文案、离场速度和下一次叫号何时开放；“完成后离开并允许下一位”已确认，不再把保留在座位作为候选。

建议文件：

```text
game/components/diagnosis/*
game/components/evaluation/*
game/src/game/domain/case-flow/*
game/tests/unit/case-flow.test.ts
game/tests/e2e/mock-medical-golden-flow.spec.ts
game/tests/e2e/mock-medical-failures.spec.ts
```

自动验证至少覆盖：

- 重复诊断不重复评估；
- `evaluation.completed` 重放不产生额外业务动作；
- 患者离场动画/事件重放不重复释放座位、推进队列或创建下一 session；
- 第二名患者不得继承第一名患者的对话、检查、诊断、评价或报告；
- `evaluating`/`EVALUATION_UNAVAILABLE` 未产生合法 `EvaluationResultV1` 时保持 pending/recovery；
- 断流后显式查询 completed 权威结果；页面刷新后的持久恢复归 S8；
- 过期、版本不兼容和安全中断；
- React 状态不持有完整病例或禁止字段；
- mock golden flow 在 Chromium、Firefox、WebKit 自动化通过。

人工操作测试：用户完整玩完第一名患者，观察其离场并叫入第二名患者；另分别体验错误诊断和一次模型失败路径。

退出条件：

- Mock 医疗闭环可连续完成至少两名患者；
- contract tests 全部通过；
- 所有稳定错误码有明确 UI；
- 结果可安全交给奖励 domain；
- 不含未通过双 AI 发布验证的病例、模型私有实现、禁止字段名或测试私有 canary value。

回滚：保留 S5 问诊/检查能力；结果页新功能通过配置关闭时，诊断仍不得误标 completed 或触发奖励。

### S7：金币、声望、一次购买与一次升级/解锁

状态：`pending`

依赖：S6 + H7

冷启动上下文：医学评分由 model/share 权威提供；游戏只消费结构化结果。本步骤通过电脑中的商店/升级各做一个纵切，不建设完整目录或长期经济系统。

目标：将一次稳定评分确定性转换为金币与声望，完成一次金币购买、一次声望等级提升，并证明部分商品只有升级后才能购买。

AI 自主任务：

- 建立纯 TypeScript `RewardPolicy v1`；
- 只消费 `RewardInputV1` 允许字段；
- 建立同时包含金币与声望的 `RewardTransaction`，以及 `ShopPurchaseTransaction`、`ReputationUpgradeTransaction` 和 `UnlockTransaction`；
- 用唯一 `evaluationId` 定义结算幂等键；本步骤先完成纯 domain/内存 repository 证明，持久化原子性和多标签竞争由 S8 完成；
- 尚未产生合法 `EvaluationResultV1` 时不发奖；
- 相同 evaluation 重放不产生第二份 SettlementPlan 或业务动作；
- 实现金币可消费余额与声望累计值/等级；MVP 不额外引入经验；
- 在电脑“商店”中实现至少一个可购买物件，并展示金币余额、价格、已购买状态和余额不足原因；
- 在电脑“升级”中实现至少一个声望等级阈值，并展示当前声望、下一阈值和升级结果；
- 实现至少一个等级门槛商品：升级前显示锁定原因，达到等级后可购买；首例已使用的检查设备不能作为该门槛商品；
- 购买、升级或解锁后在世界或 UI 中立即可观察；
- 奖励公式数据化，并记录 `rewardRuleVersion`；
- 长期价格、升级时间和经济曲线继续保持非目标；
- 为交易流水、规则迁移、输入 hash 冲突和结算协议建立 domain tests。

用户已确认，S7 必须落实：

- 正常金币 20–120、正确诊断基础声望 100–250 的版本化映射，以及两类 3 级家具每级各 25% 的相加加成；
- 不设置未批准的二元诊断失败阈值；当前明确失败终局是超过 20 回合，统一为 0 金币/-50 声望；
- 重复成功基础声望 50 并继续应用家具加成；金币衰减写入版本化配置；
- 首购为 3 级盆栽、首次声望升级为诊所等级 2、首个门槛商品为 3 级候诊椅；
- 金币、声望、购买、升级和解锁的视觉/音频反馈；
- 奖励是自动入账还是由玩家点击确认。本 MVP 建议先显示结果，再由玩家点击“领取”，随后患者离场；购买和升级在电脑中由玩家主动执行。

建议文件：

```text
game/src/game/domain/rewards/*
game/src/game/domain/economy/*
game/src/game/domain/reputation/*
game/src/game/domain/shop/*
game/src/game/domain/facilities/*
game/src/game/domain/progression/*
game/components/rewards/*
game/components/shop/*
game/components/upgrades/*
game/tests/unit/rewards-*.test.ts
game/tests/unit/shop-upgrade-*.test.ts
game/tests/e2e/reward-shop-upgrade.spec.ts
```

自动验证：

- 精确金币/声望奖励向量；
- 同 evaluation 只产生一笔流水；
- 纯 domain 结算计划同时包含 processed marker、金币、声望、解锁、profile 和 checkpoint，不允许调用者拆分；
- 重复购买/升级无第二次扣款或解锁；余额不足、声望不足、门槛未达均无部分写入；
- repository contract 在中途失败后可重放；真实 IndexedDB crash-safe 证明归 S8；
- LLM 文本变化不影响奖励；
- `rewardRuleVersion` 变化不静默重算历史奖励；
- 购买、升级和等级门槛解锁前/后行为正确。

人工操作测试：用户完成首例，领取金币与声望并观察患者离场；打开电脑商店购买一个物件，再打开升级完成一次等级变化并观察门槛商品开放。本步骤验证同一运行期内重复进入结果页、商店或升级页不重复发放/扣款。刷新和多标签页人工测试归 S8。

退出条件：

- 金币、声望、一次购买和一次升级/解锁稳定可观察；
- H7 通过；
- 单进程 domain 一次性不变量有自动证据；持久恢复与多标签不变量已形成 S8 的强制验收合同；
- 玩法没有暗中扩展为完整商店目录或长期经济系统。

回滚：关闭新奖励 policy，保留 evaluation 结果；已提交的交易不可删除或重发，规则修改通过新版本处理。

### S8：IndexedDB 存档、迁移与双权威恢复

状态：`pending`

依赖：S2 + S6 + S7

冷启动上下文：游戏位置、开场、队列、叫号、座位、患者表现、金币、声望、购买、升级和解锁属于本地游戏权威；医学会话属于服务端权威。刷新恢复不能只读取本地 JSON，也不能用服务端覆盖本地经营进度。

目标：在关键阶段刷新后恢复正确的开场/电脑/队列/当前患者/检查动线、医学投影、金币、声望、购买、升级和解锁，同时保护隐藏信息和旧存档。

AI 自主任务：

- 实现 idb adapter 和版本化 `SaveEnvelope`；
- 分离 IndexedDB database version 与 save `schemaVersion`；
- 保存 `contentBuildId`、`contractVersion`、`rewardRuleVersion`；
- 建立 autosave trigger：开场完成、电脑开始接诊、队列形成、叫号接受、患者落座、会话创建、患者离座检查、检查完成/回座、报告开放、诊断接受、evaluation 完成、金币/声望发放、患者离场、购买、升级和解锁；
- 按第 11.5 节在同一 IndexedDB database 的单个 readwrite transaction 中原子提交 processed evaluation、reward ledger、unlock ledger、金币余额、声望总量/等级和 clinic-flow checkpoint；
- 购买与升级分别使用稳定 transaction ID，在单个 readwrite transaction 中原子提交扣款/等级/商品状态/世界变化；
- 为 `evaluationId` 建立数据库级唯一键；冲突执行者必须读取并返回已有 receipt，不能覆盖或再次计算；
- 建立 v1→v2 示例迁移或等价旧版本迁移测试；
- 写入前保留旧值/备份策略；
- 实现损坏数据、超配额、隐私模式和 IndexedDB 不可用 UI；
- 实现 JSON 导出/导入，导入前验证且不覆盖健康存档；
- 恢复本地世界后使用 `sessionId` 查询服务端；
- 合并 allowlist projection，处理 expired、not found、incompatible 和 recovery required；
- 明确同设备同浏览器边界；
- 形成有效进度后可请求持久存储，但拒绝时游戏仍可运行；
- 建立多标签页单主标签策略或等价防重复机制。

强制故障注入点：

1. 计算 SettlementPlan 后、transaction 开始前崩溃；
2. transaction 内写 reward ledger 后抛错；
3. 写 unlock/profile/checkpoint 任一阶段抛错；
4. transaction commit 后、React/Phaser 表现前崩溃；
5. 两个标签页同时领取同一 `evaluationId`；
6. 已处理 evaluation 以不同 input hash 或规则事实重放。

期望结果分别是“无可见部分写入后安全重试”“整笔回滚”“恢复后只补 UI 表现”“只有一笔 receipt/余额/解锁”“冲突进入 recovery-required”。

必须覆盖的刷新点：

1. 黑屏淡入中；
2. 医生坐姿开场气泡已显示；
3. 电脑已开始接诊、队列正在形成；
4. 队列已形成但尚未叫号；
5. 患者正在进门；
6. 患者已落座/问诊 active；
7. 患者正在前往帘后或检查 pending；
8. 检查已完成、患者正在回座；
9. 患者已回座且报告可查看；
10. 诊断已提交；
11. 正在评估；
12. 已评分但未领取；
13. 已发放金币/声望、患者尚未离场；
14. 患者正在离场或已离场、下一位尚未叫入；
15. 已购买、已升级或门槛商品已解锁。

建议文件：

```text
game/src/game/domain/save/*
game/src/game/adapters/save/IndexedDbSaveAdapter.ts
game/src/game/application/recovery/*
game/components/save/*
game/tests/unit/save-*.test.ts
game/tests/e2e/save-recovery.spec.ts
```

自动验证：round-trip、迁移、损坏导入、无 IndexedDB、版本不兼容、每个刷新点、横竖屏切换不重复提交、队列顺序/座位/检查锚点恢复、服务端完成但客户端未收到、重复 reward event、购买/升级重复提交、上述六个故障注入点、多标签并发只有一笔结算、隐藏信息扫描。

人工操作测试：用户在至少三个阶段手动刷新，导出/导入一次存档，并体验过期会话提示。

退出条件：

- 全部关键刷新点可预测恢复；
- 旧存档迁移或明确拒绝；
- 损坏导入不破坏现有存档；
- 服务端医学状态和本地经营状态各自保持权威；
- processed evaluation、金币、声望、购买、升级、解锁、余额和流程 checkpoint 的原子性有故障注入证据；
- 两个标签竞争同一 evaluation 时只有一个 transaction 获得新结算，另一个读取既有 receipt；
- IndexedDB 和导出文件无禁止字段；
- 同设备同浏览器限制明确展示。

回滚：保留上一个 saveSchema migrator 和原始备份；不得通过清空整个数据库来处理普通迁移失败。

### S9：黄金美术、UI 皮肤和最小音频集成

状态：`pending`

依赖：批次生产可在 S3 + S6 后开始，并与 S7/S8/S10a/S10b 的非美术部分并行；S9 `engineering_complete` 需要全部核心批次至少 IN_GAME，S9 `user_accepted/complete` 还依赖 S7 + S8 对应奖励、解锁和恢复状态可实际试玩

冷启动上下文：功能灰盒和素材合同已冻结。此步骤只完成一个黄金诊室与至少两名患者的顺序接诊纵切，不扩展完整医院、CT/B 超房间或大规模病例池。

目标：将所有玩家可见的 MVP 核心状态替换为用户批准的正式或明确接受的素材，并建立后续内容生产样板。

执行批次：

1. 黄金诊室 tileset；
2. 黄金 Tiled 地图；
3. 黄金玩家医生（站立、移动、开场/接诊坐姿）；
4. 参考三种公开人物人格制作的三类黄金患者（排队、移动、坐姿、帘后等待、普通/愤怒离场）；
5. 黄金电脑、叫号按钮、帘子、床、右侧血压设备、抽屉体温计，以及医生/NPC 的体温计交接动作；
6. 黄金 3 级盆栽、诊所等级 2、3 级候诊椅与灰雾锁定区；
7. 气泡、对话、报告纸、电脑、商店、升级、诊断、评分与奖励 UI 皮肤；
8. 淡入环境、电脑、开始接诊、叫号、脚步、坐下、帘子、离场、按钮、金币、声望、购买、升级、解锁和错误音效；
9. 1 首可无缝循环的诊所日间 BGM；MVP 不制作独立标题/菜单曲。

每一批拥有独立状态和证据，S9 汇总状态只能从各批状态派生：某个房间或角色 `ACCEPTED` 不代表整个 S9 完成。奖励/解锁 UI 在 S7 前、恢复/损坏提示在 S8 前最多只能用占位状态接入，不能提前取得最终游戏内审批。

每一批必须执行：

```text
AI 输出详细素材任务卡
→ 用户提供/选择/修改素材
→ AI 检查尺寸、许可、帧、脚点和命名
→ 用户静态审批
→ AI 集成
→ AI 提供实际游戏和对照截图
→ 用户游戏内审批
→ 修改
→ ACCEPTED / LOCKED
```

AI 自主任务：

- 保持角色各方向、各帧尺寸、脚点和服装一致；
- 修复透明边缘、孤立像素、调色板漂移和动画抖动；
- 将碰撞集中在 Tiled `Collision` 层；
- 验证 AbovePlayer 遮挡；
- React UI 与 Canvas 共用色彩、边角、描边和动效语言，但保持中文正文可读；
- 第一次明确用户手势后解锁音频；
- 提供静音、音乐、音效分组和设置持久化；
- 检查循环点、爆音、并发叠加和离开场景后的清理；
- 记录全部来源、署名和 AI 生成历史；
- 生成新的不可变 `contentBuildId`。

用户必须亲自验收：

- 黄金房间、医生坐姿、至少两名患者、电脑/叫号、帘后设备、购买/升级内容、气泡/报告和其他 UI；
- 患者表现是否尊重、可信且不泄露诊断；
- 动画节奏、遮挡、比例和交互物体辨识；
- 桌面扩展构图、手机横屏构图和竖屏旋转门；
- 音效是否专业、不过度娱乐化；
- 所有外部/AI 素材是否允许进入正式候选。

自动验证：素材 manifest、frame/grid、Tiled schema、缺失文件、许可清单、视觉 smoke、音频解锁、桌面/移动截图、内存/FPS 和全量 `lint/typecheck/test/build/e2e`。

退出条件：

- `engineering_complete`：全部核心批次至少 IN_GAME，自动资源/渲染/音频门通过，所有 placeholder 都被明确登记；
- `user_accepted`：S7/S8 完成后，用户已在完整奖励、解锁、刷新和错误状态中逐批验收；
- `complete`：核心可见状态无未说明 placeholder，黄金资产全部 ACCEPTED，后续可复用样板全部 LOCKED；
- content build、源文件、导出物和许可可追溯；
- 真机性能没有因正式素材跌出 H3 预算。

回滚：切回上一 content build；单个素材可回退上一 APPROVED 版本，不覆盖或删除源文件。

### S10a：可信服务端与 HTTP/SSE transport 交付（外部依赖）

状态：设计和合成 producer tests 可在 S4 后推进；真实远程任意交互保持 `blocked_external`，直到模型层变更获授权且 H8 完整运行时发布门通过

owner：模型/集成服务端负责人；公共 DTO、Schema 和 transport 兼容性由 share 双方共同批准。此游戏计划只声明游戏所需依赖和验收证据，不自动授权 AI 修改 `model/` 内部实现或降低模型层门槛。

依赖：S4 的 consumer 需求 + 对应模型层/共享层 Change ID；live activation 另依赖 H8

冷启动上下文：当前 `model/` 提供 package、CLI/headless/service adapter，但没有已冻结、可供浏览器消费的 HTTP Route Handler/server；当前 `share` 也没有 GET-session 查询 DTO 或 OpenAPI transport。它们必须成为显式交付物，不能被 S10b 客户端猜测。

目标：交付一个可信、server-only 的同源优先 BFF/API，使游戏能在不接触 Provider key、私有病例或模型内部类型的前提下消费 share 公共契约。

建议冻结的 v1 endpoint 集合（最终名称随 transport Change ID 固定）：

```text
POST /api/v1/sessions
GET  /api/v1/sessions/{sessionId}
POST /api/v1/sessions/{sessionId}/turns
POST /api/v1/sessions/{sessionId}/tests
POST /api/v1/sessions/{sessionId}/diagnoses
POST /api/v1/sessions/{sessionId}/cancel
GET  /api/v1/sessions/{sessionId}/events   # SSE；是否支持 Last-Event-ID 必须明确
```

这些路径在 Change ID、transport hash 和 producer contract 通过前只是提案；S10b 禁止将它们写成不可替换的客户端常量或据此宣称 transport 已冻结。

必须交付：

- 共享层新增并冻结公共查询/恢复响应 DTO（如经批准的 `GetSessionResponseV1`）、JSON Schema、正反 fixture、schema manifest、changelog 和 compatibility matrix；
- 冻结 HTTP method/path、request/response/event envelope、HTTP status 与 share error code 映射、body/stream limits、timeout 和 retry 语义；
- 明确 SSE 心跳、`eventId`、`sequence`、断线、重连、`Last-Event-ID` 支持与不支持时的权威查询回退；
- 可信服务端 producer，实现创建/查询、问诊、检查、诊断、取消和事件流；
- Provider key、病例真相、rubric、prompt 和安全策略只在服务端；客户端永不直连模型 Provider；
- 明确一种认证/会话模式。若使用 cookie 等 ambient credential，必须提供 `HttpOnly`/`Secure`/`SameSite`、Origin/Referer 校验和 CSRF 防护；若使用显式 token，必须定义保存、轮换、泄漏和撤销边界；
- 默认同源部署；若确需跨源，冻结精确 allowlist、credentials 和 preflight 行为，禁止 `*` 放行带凭据请求；
- 请求体大小、速率/并发限制、幂等保留、traceId 脱敏、结构化日志和错误降级；
- 本地启动、测试、部署和 secret 注入命令；不得要求在浏览器环境变量中放 Provider key；
- producer contract suite，验证每个 endpoint/SSE event 对公共 Schema、状态机、幂等和错误映射负责；
- 只使用公开合成 scenario 的服务器 smoke；真实运行时激活必须等待 H8。

交付证据：冻结 transport 文档/Schema hash、producer contract 报告、启动命令、匿名或授权会话安全说明、CORS/CSRF 测试、SSE 断线恢复测试、secret/client-bundle 扫描和回滚说明。

退出条件：

- `engineering_complete`：合成 producer 与 share transport contract 全部通过，游戏不需要猜测任何 wire JSON；
- `live_ready`：H8 通过、当前批准的 Provider/model identity 和 runtime-release manifest 已部署到可信环境，并由模型/集成 owner 出具 smoke 证据；
- 任一条件缺失时，S10b 只能对合成 server 或 mock 执行，不能宣称真实 Integrated MVP。

回滚：停止 live route 或切回合成 producer；不得把服务端能力搬入客户端，也不得通过直接 import `model/` 规避 transport 交付。

### S10b：游戏侧真实 HTTP/SSE adapter 纵切

状态：`blocked_external`，直到 S10a `live_ready` 且 H8 通过

依赖：S6 + S7 + S8 + S10a + H8；可与 S9 并行准备 consumer、Schema 校验和合成故障测试

冷启动上下文：游戏已经有稳定 MedicalSessionPort、完整 Mock Playable、原子结算和恢复。真实 adapter 只替换传输，不改变游戏业务、奖励规则或本地权威边界。

目标：消费 S10a 冻结的可信服务端和 share transport，用完整 runtime-release manifest 中至少两个已批准病例完成真实顺序接诊 Integrated MVP。

前置门：

- Mock Playable、S7、S8 完成；
- game/share consumer tests 与 S10a producer tests 针对同一 transport hash 通过；
- H8 的完整模型运行时发布清单通过，不以单例 `packageStatus=published` 替代；
- 可信服务端入口、认证/会话、secret、CSRF/CORS/同源和部署方案已有证据；
- 真实模型只使用当前 runtime-release manifest 批准的 Provider/model identity，不复用 Key 调未批准 Provider；
- 客户端 hidden-value canary 基线扫描通过。

AI 自主任务：

- 实现 `HttpMedicalSessionAdapter`；
- 只负责 HTTP/SSE、Schema 验证、事件去重/排序、认证会话和错误映射；
- 不在客户端持有 API Key、病例真相、rubric、prompt 或模型私有类型；
- 建立创建/查询、问诊、检查、诊断接受、异步评价结果和取消；
- 实现 timeout、有限安全重试、断流后权威查询；
- 未知诊断写结果不得盲目重复提交；奖励是本地原子结算，不是 HTTP 写操作；
- 将 share error code 映射到已验证 UI，记录不含敏感信息的 traceId；
- mock adapter 永久保留为开发和故障回归；
- 在测试服务端私有事实、答案、rubric、prompt 中注入每次运行唯一 canary values；
- E2E 扫描 network body、SSE、DOM、client console/log、Phaser cache、IndexedDB、save export、public、bundle 和 source map，证明 canary values 为 0，而不只扫描禁用字段名；
- 验证真实失败时不伪造回答、检查、评分或奖励。

用户/专家参与：

- H8 runtime-release manifest 可保留模型/医学 owner 的非阻塞备注，但不要求人工医学签字或病例审批；项目级 Provider/model 与正式发布 go/no-go 仍由项目负责人确认；
- 用户体验真实等待、错误和恢复；
- 医学/法律/隐私责任人审批真实健康输入提示和日志策略；
- 用户确认模型不可用时是否允许进入病例。本计划建议不可进入新病例，但允许恢复已有权威结果。

自动验证：

- 至少两个来自批准 runtime manifest 的病例顺序完成 e2e；第一名离场后第二名创建独立 session，不串用对话、检查、报告或评价；
- 同幂等请求不产生第二次调用/回合/检查/诊断接受/评估/奖励；
- 断流后恢复 completed 或稳定进入 recovery/error；
- active/test/diagnosis/evaluating/completed 刷新恢复；
- 禁止字段名扫描为 0，私有 canary value 扫描也为 0；
- 错误路径不伪造内容；
- mock、合成 HTTP 与 live HTTP adapter 通过同一 consumer test suite。

人工操作测试：用户使用真实模型完成一局，并主动断网/刷新一次，评价等待感、恢复、错误和结果一致性。

退出条件：

- Integrated MVP 全链路通过；
- H9 通过；
- contract v1 是否晋升由 share 双方 gate 决定；
- 只有完整 H8、真实服务端 producer evidence 和真实 Provider/runtime manifest 证据齐全才能写成完成；
- 若 H8 或 S10a 未通过，状态保持 `blocked_external`，Mock Playable 仍可完成。

回滚：通过配置切回 mock/合成 server；真实 adapter 失败不得导致 game 直接依赖 model 或复制私有病例。

### S11：全量质量门、真机验收与 Release Candidate

状态：`pending`

依赖：S7 + S8 + S9 `complete` + S10b

冷启动上下文：完整闭环、真实 adapter、黄金内容和恢复已经分别通过。本步骤不新增玩法，只修复阻断发布的问题并形成证据。

目标：证明同一候选制品在目标浏览器和设备上可玩、可恢复、无隐藏数据、无未批准素材，并由用户作最终决定。

AI 自主任务：

- 运行全量 lint、typecheck、unit、coverage、contract、build、e2e；
- Chromium、Firefox、WebKit 自动化；
- 资源失败、WebGL 不可用、音频未解锁；
- IndexedDB 迁移、损坏、被清除、导入导出；
- timeout、断流、重复请求、过期、版本不兼容、多标签页；
- bundle/source map/public/network/SSE/DOM/log/Phaser cache/IndexedDB/save export 的禁用字段名与私有 canary value 双重扫描；
- manifest、content build、许可和署名检查；
- 首屏、单地图贴图、音频、内存、FPS 和切场数据；
- 生成可审计 RC 报告、已知限制和回滚包；
- 更新 `AI_CONTEXT.md` 当前实现状态；
- 如果高频架构或路由事实改变，同步 `压缩上下文.md` 和相关长文档。

用户必须亲自完成：

- 桌面完整一局；
- 桌面目标浏览器完整或关键 smoke；
- Android Chrome 完整或关键 smoke；
- 一个可获得的低端设备档位；
- 横屏/旋转门、淡入、电脑开诊、队列/叫号、双患者循环、气泡输入、帘后检查、报告、诊断、评分、金币/声望、购买、升级和刷新恢复；
- 美术、音频、字号、触控区和等待体验；
- 许可、署名、产品说明和 go/no-go。

退出条件：

- 第 15 节 DoD 全部满足；
- 没有未解释的 P0/P1 缺陷；
- 所有正式素材 ACCEPTED；
- H8 完整模型运行时发布门、S10a 服务端门和隐藏信息双重扫描门通过；
- 同一 content build 与 save schema 的证据完整；
- H10 通过；
- 用户明确签字接受 RC。

回滚：保留上一 Integrated MVP build；RC 后任何地图、素材、规则、Schema、病例或模型变更都生成新版本并重跑受影响门。

## 13. 依赖图与并行顺序

```text
H-START
→ S0 计划/基线与 H0/H1
├─→ S1 访谈与视觉方向
│     → S2 Tiled 灰盒/横屏开场/电脑/队列/叫号
│           → S3 技术美术冻结/资产管线
│                 → S9 黄金美术与音频分批生产
│
└─→ S4 share port/mock adapter
      → S5 气泡问诊/自主检查/报告 UI
            → S6 诊断/评分/离场/下一位 Mock Playable
                  → S7 金币/声望/购买/升级 domain
                        → S8 原子存档/恢复/多标签

S4 consumer requirements
→ S10a share transport + 可信服务端 producer（live activation 等待完整 H8）

S6 + S7 + S8 + S10a live_ready + H8
→ S10b 游戏 HTTP/SSE adapter / Integrated MVP

S3 + S6 → S9 分批 IN_GAME / engineering_complete
S7 + S8 + 各核心批次 ACCEPTED → S9 user_accepted / complete
S7 + S8 + S9 complete + S10b → S11 RC
```

可并行：

- S1/S2 美术访谈与 S4 share adapter；
- S3 资产管线与 S5/S6 医疗 UI；
- S7/S8 经营存档与 S9 分批素材生产；
- S9 黄金美术、S10a 合成 producer 与 S10b consumer/错误测试；真实远程纵切仍等待完整 H8。

不可越过的门：

- 未完成 S2 实机 PoC，不冻结 tile/frame/分辨率；
- 未通过 H5，不把素材当正式资源；
- 未通过 game/share contract，不接真实 model；
- 未完成 S6 mock 闭环，不接真实 Provider；
- H8 完整模型运行时发布清单未通过，不做玩家可访问的远程任意交互；单个 published case 不足以越门；
- 未产生合法 `EvaluationResultV1`，不发奖；
- 奖励和解锁未通过同一 IndexedDB transaction、崩溃注入和多标签竞争证明，不进入 RC；
- 未完成真机和许可验收，不标记 RC。

## 14. 测试与质量门

### 14.1 自动测试最低要求

| 类别 | 最低要求 |
|---|---|
| TypeScript | game 与 share typecheck 全部通过 |
| Lint | game lint 无错误；新警告必须解释 |
| Unit | 当前与新增 unit 全部通过 |
| Coverage | 游戏关键纯 domain line/function/branch ≥90%；新增普通可测逻辑 ≥80% |
| Contract | game consumer 与 share v1-rc1 正反 fixture 全部通过 |
| Map | Tiled 层、属性、稳定 ID、碰撞、遮挡和非法输入覆盖 |
| Clinic flow | 淡入/开诊只提交一次；队列顺序、叫号、座位、检查动线、离场和下一位的合法/非法状态转换覆盖 |
| Medical | 每名患者独立创建/恢复、气泡问诊、自主检查、报告、诊断 accepted、异步 evaluation completed/不可用和失败恢复覆盖 |
| Idempotency | start-shift/call/turn/test/diagnosis/reward/purchase/upgrade 重放无第二副作用；冲突稳定拒绝 |
| Reward | 金币/声望规则向量、舍入、一次流水、一次购买、一次升级/解锁和版本覆盖 |
| Save | round-trip、迁移、损坏、版本冲突、每个刷新点覆盖 |
| Hidden information | public、fixture、bundle、存档和 IndexedDB 禁止字段名为 0；私有 canary values 在 network/SSE/DOM/log/cache/storage/export/bundle/source map 中也为 0 |
| Build | Next production build 通过 |
| E2E | Chromium、Firefox、WebKit golden flow 和失败流通过 |
| Mobile | Pixel 级模拟自动化 + Android 真机 smoke；模拟不能替代目标 Android 真机 |

### 14.2 核心可测试验收标准

#### 世界与患者

- 首次进入加载一张 Tiled 诊所地图；
- 首屏从黑色淡入，玩家以坐姿出现，“又是开始接诊的一天”只提交/展示一次；
- 手机竖屏时世界暂停并提示旋转，恢复横屏不重复推进；
- 手机横屏包含左侧队列/门与中右部诊室关键交互；桌面额外显示上/下灰雾区且不可进入；
- WASD、方向键和触控均可移动；
- 玩家不能穿过 Collision；
- AbovePlayer 遮挡顺序正确；
- DOM 面板打开时玩家坐标不变化；
- 电脑包含开始接诊、商店和升级入口；开始接诊重复点击不复制 shift 或队列；
- 至少两个队列条目顺序稳定，只有队首响应叫号；
- 同一 `callId` 只触发一次进门，患者到座前不能对话，座位同时只属于一名患者；
- 当前患者完成后从左门离场；离场完成前不能叫下一位，完成后下一位可进入；
- 刷新、横竖屏切换或进入后台再返回不会复制队列、跳过患者、重复路线或错误占座；
- 患者使用稳定 `npcId`、`interactionId`、`queueEntryId`、`seatAnchorId` 和 `examAnchorId`。

#### 医疗交互

- mock 下可完成完整会话；
- 所有玩家/NPC 角色内发言均由对应 speaker 的 DOM 气泡呈现，长中文可展开和回看；
- 同一 `clientTurnId` 重发不增加第二回合；
- 同一检查请求重发不重复扣费或状态推进；
- 检查结果来自 adapter，不由游戏生成；
- 检查 accepted 后患者自主到帘后，completed 后回到原座；只有回座且结果已提交时开放“查看”报告；
- `TurnCompletedV1.effects` 重放不重复启动检查移动、报告或扣费；
- 第二名患者拥有独立 session、对话、报告、诊断和评价；
- 诊断提交后 UI 不允许第二次提交；
- `evaluating`/`EVALUATION_UNAVAILABLE` 时不构造 partial result 或伪造 total；
- `MODEL_UNAVAILABLE` 时不展示假患者回答；
- `STREAM_INTERRUPTED` 后查询服务端权威状态；
- completed event 重放不重复改变 projection；
- 客户端禁止字段为 0。

#### 奖励与解锁

- 奖励只消费冻结的结构化字段；
- 同一 evaluation 只有一笔同时包含金币与声望的 reward transaction；
- 刷新、断流和重复响应不重复发奖；
- 商店完成一次金币购买；余额不足或重复购买不产生部分写入；
- 升级完成一次声望等级变化；阈值不足不升级；
- 至少一个门槛商品在升级前锁定、升级后开放；
- 刷新后金币、声望、购买、等级和解锁仍存在；
- 新 reward policy 生成新 `rewardRuleVersion`；
- 历史奖励不被新公式静默重算。

#### 存档

- round-trip 保持允许字段等价；
- 队列顺序、当前患者、座位/检查/离场 checkpoint、金币、声望、购买和升级 round-trip 等价；
- 至少一个旧版本迁移通过；
- 损坏数据不导致白屏；
- IndexedDB 不可用时有明确提示；
- 本地/服务端冲突按第 11.6 节处理；
- 过期会话保留允许的本地摘要但不能继续提交；
- `contentBuildId` 不兼容时明确迁移、降级或阻止载入；
- 导出存档没有完整病例或服务端机密。

#### 美术与音频

- 每个正式资产有源文件、运行产物、尺寸、锚点、许可和审批状态；
- 只有 ACCEPTED 资产进入 RC；
- 静态审批和游戏内审批分别留证；
- 关键交互物体在桌面和手机上可识别；
- 医生坐姿、患者排队/移动/坐姿/帘后/离场动画与锚点一致；
- 气泡、报告纸、电脑、商店和升级 UI 在手机横屏不遮挡关键操作；
- 患者没有明显污名化或诊断泄露；
- 动画没有明显脚点漂移、肢体跳变或风格漂移；
- 像素缩放没有模糊和相机抖动；
- 音频在首次手势后可用，静音/音量有效，循环无明显断点；
- 最终尺寸和性能预算来自 PoC 证据。

### 14.3 用户实际操作测试脚本

AI 每次交付可玩里程碑时，应把环境启动好并给用户以下最短路径：

1. 打开诊所；
2. 观察黑屏淡入、医生坐姿和开场气泡；
3. 用键盘和触控分别移动，并把手机转为竖屏再转回横屏；
4. 点击电脑，检查三个入口；点击开始接诊并退出电脑；
5. 观察左侧队列，点击叫号，让队首进门落座；
6. 观察患者问候/主诉气泡，点击玩家旁“对话”并问至少三个问题；
7. 使用唯一检查，观察患者到帘后、等待、回座，再点击“查看”报告；
8. 提交一次诊断并查看评分；
9. 领取金币与声望，观察患者离场；
10. 叫入第二名患者，确认 session 与第一名互不串用；
11. 打开电脑商店完成一次购买，再在升级中完成一次声望升级并观察门槛商品开放；
12. 在队列、检查或离场中的一个阶段刷新并确认状态；
13. 额外执行一次断网/超时恢复；
14. 按以下模板反馈。

```text
构建/contentBuildId：
测试设备/浏览器：
测试到哪一步：
结论：通过 / 有条件通过 / 退回
必须保留：
必须修改：
建议修改：
具体位置或截图编号：
问题造成的感受/功能后果：
优先级：
是否阻塞下一阶段：
本轮修改后是否可 ACCEPTED/LOCKED：
```

## 15. Definition of Done

### 15.1 Mock Playable DoD

- [ ] 一张包含队列/门、接诊区、帘后检查区和灰雾扩展区的 Tiled 诊所可横屏进入并自由移动；
- [ ] 黑屏淡入、医生坐姿、开场气泡、电脑开始接诊和竖屏旋转门通过；
- [ ] 至少两名 mock 患者按队列顺序完成叫号、进门、落座、离场和下一位循环，并可刷新恢复；
- [ ] 全发言气泡、文字问诊、患者自主检查、报告查看、诊断和评分全部通过 share mock；
- [ ] 金币、声望、一次购买和一次升级/门槛解锁确定、可观察且幂等；
- [ ] IndexedDB 可恢复关键阶段；
- [ ] 错误、断流、过期和版本不兼容有 UI；
- [ ] game/share contract tests 通过；
- [ ] mock、fixture、bundle 和存档无禁止字段；投影测试中的私有 canary value 在全部客户端表面为 0；
- [ ] 用户完成一轮实际操作测试；
- [ ] 所有占位内容明确标记，未伪装为正式美术。

### 15.2 Integrated MVP DoD

- [ ] Mock Playable DoD 全部满足；
- [ ] H8 完整模型 runtime-release manifest/gate 真实通过，包含固定安全模板、165 条本地策略回归及其独立 AI 验证产物、33 条冻结 holdout、5 病例真实候选 benchmark、独立 AI 抽样、最终批准 Provider/model identity 和远程任意交互开关；
- [ ] 至少两个已发布病例属于该批准 manifest，并完成顺序接诊真实纵切；
- [ ] S10a 可信服务端、公共查询 DTO、transport hash 和 producer contract evidence 完整；
- [ ] 游戏只通过 share + HTTP/SSE adapter 接真实模型；
- [ ] 创建/恢复、问诊、检查、诊断和评分真实纵切通过；
- [ ] session、case、contract、evaluation 版本可追溯；
- [ ] 断流、刷新、重复请求和未知写结果可安全恢复；
- [ ] 模型不可用时不伪造内容；
- [ ] 奖励不会因真实事件重放重复发放；
- [ ] 客户端禁止字段名 scan 为 0，私有 canary value scan 也为 0；
- [ ] 用户完成人工 H9 验收。

### 15.3 Release Candidate DoD

- [ ] Integrated MVP DoD 全部满足；
- [ ] 黄金诊室、玩家、患者、设备、UI 和音频 ACCEPTED；
- [ ] 所有素材来源、许可和署名可追溯；
- [ ] Chromium、Firefox、WebKit 自动化通过；
- [ ] 桌面目标浏览器、Android Chrome 和低端 Android 设备 smoke 通过；
- [ ] 资源、性能、存档迁移和错误恢复报告完成；
- [ ] 医学、隐私、产品边界和安全文案通过对应审核；
- [ ] `AI_CONTEXT.md` 和必要项目文档同步；
- [ ] 用户明确 go/no-go，并对 RC 签字。

## 16. 投入、角色与协作节奏

### 16.1 工作量表达

本计划不承诺固定日历天数。AI 工程速度、素材等待、反馈轮数、医学发布和真机获取彼此独立。执行时按以下复杂度估算并在每个 Phase 后重新评估：

| 步骤 | 工程复杂度 | 预期用户评审 |
|---|---|---|
| S0 基线/决策 | S | 1–3 轮产品确认 |
| S1 视觉访谈 | M | 3–6 轮方向/素材确认 |
| S2 Tiled 灰盒 | L | 2–4 轮试玩 |
| S3 资产管线 | M | 每批静态+游戏内两门 |
| S4 share/mock | L | 主要为体验文案确认 |
| S5 问诊/检查 | L | 2–4 轮 UI/等待体验 |
| S6 诊断/评分 | M | 2–3 轮结果体验 |
| S7 奖励/解锁 | M | 2–4 轮经营体验 |
| S8 存档/恢复 | L | 1–3 轮刷新/导入测试 |
| S9 黄金美术 | L，人工等待占主导 | 每类资产至少两门 |
| S10a 服务端/transport | L，外部 owner 与发布门占主导 | 模型、共享契约、安全与部署审核 |
| S10b 游戏真实 adapter | L，外部门占主导 | 真实模型等待、错误和恢复体验 |
| S11 RC | L | 多设备完整验收 |

范围增加时必须说明删减、延期或新增投入，不能只在原计划上叠加。

### 16.2 角色责任

| 角色 | 责任 |
|---|---|
| 项目负责人/用户 | MVP 范围、玩法、视觉、关键素材、经营体验、真机和最终发布决定 |
| AI 工程负责人 | 架构、代码、adapter、domain、存档、测试、验证、文档和证据 |
| AI 技术美术 | 素材任务卡、尺寸/帧/锚点校验、导出、manifest、游戏内接入和问题报告 |
| 用户或合作美术 | 原创/修改素材、方向选择、静态审批和游戏内审批 |
| 模型/集成服务端负责人 | S10a 可信 API、server-only secret、transport producer、部署和运行证据 |
| share 双方 owner | 公共查询 DTO、Schema、transport/错误兼容性、fixture、changelog 和 gate |
| AI 病例生成/验证角色 | 病例、检查、答案、rubric、红旗矩阵和双 AI 发布验证记录 |
| 隐私/法律责任人 | 真实健康输入、日志、地区化文案和公开部署审核 |

### 16.3 默认协作节奏

- 每个 AI 实施批次只追求一个可操作结果；
- 每个美术批次最多向用户提出 3–5 个必须判断的问题；
- 用户尚未回答时，AI 继续不依赖该答案的分支；
- 每次用户反馈后，AI 先复述“保留、修改、禁止、是否锁定”，再动手；
- AI 完成代码后必须启动实际构建并给出操作步骤，不只发送截图；
- 用户反馈被转成测试、视觉圣经规则或 Change ID，避免同一问题重复出现。

## 17. 风险登记与禁止反模式

| 风险/反模式 | 后果 | 防线 |
|---|---|---|
| 等全部美术后才写代码 | 长期阻塞，晚发现技术不兼容 | placeholder 三线并行 |
| PoC 前锁死 16px/320×180 | 地图、角色、镜头整体返工 | S2 + H3 真实设备冻结 |
| 为手机/桌面拉伸同一画面或强求显示同一区域 | 像素变形、手机按钮出屏、桌面空间浪费 | 同一世界坐标 + 相机安全构图 + 桌面额外灰雾区 |
| 竖屏仍允许业务输入 | 玩家看不清且可能误触重复提交 | OrientationGate 暂停世界和业务提交，横屏恢复幂等 |
| 静态图通过即视为完成 | 游戏内遮挡、缩放、动画失败 | H5 静态门 + H6 游戏内门 |
| 从一个未锁定角色批量派生 | 风格错误指数扩散 | 只有 LOCKED 可批量 |
| AI 生成图直接进入 public | 权利、尺寸、风格和源文件不明 | 任务卡、审批、人工清理和台账 |
| “免费”当作可商用 | 许可证或署名风险 | 逐项保存许可，默认 CC0 |
| 直接 import model | 三层边界破坏、客户端泄露 | `game → share ← model` contract gate |
| 先接真实模型再做 mock | 开发不稳定、失败难复现 | S4–S6 先完成 Mock Playable |
| 用单个 published case 代替完整运行时门 | 安全模板、评测或 model identity 未批准却开放自由问诊 | H8 runtime-release manifest 硬门 |
| 业务状态放进 WorldScene | 难测试、刷新丢失 | 纯 TypeScript domain + adapters |
| 用患者走路/坐下动画直接代表队列权威状态 | 刷新、后台或掉帧导致跳号/重复占座 | queue/call/seat/leave checkpoint 为权威，动画只请求转换 |
| 把 delta 当权威回答 | 断流后保存残缺内容 | completed/query 才提交 |
| 把全部气泡文字画入 Canvas | 中文长文本、缩放、触控和无障碍失败 | Phaser 提供锚点，React DOM 渲染气泡/输入/报告 |
| 气泡固定屏幕位置或无限叠加 | 遮挡人物、按钮和路径 | speaker 锚定、边缘避让、队列化显示、历史入口 |
| LLM 文本决定奖励 | 不可审计和可被操纵 | RewardInput + RewardPolicy |
| 为 pending/不可用评价构造 partial result 或补 0 分 | 错误奖励和不公平 | 只接受合法 `EvaluationResultV1`；否则 pending/recovery，不发奖 |
| 首例结束解锁首例必用设备 | 玩法自相矛盾 | 初始设备与解锁内容分离 |
| 患者使用真实时间随机出现 | 后台/刷新/测试不可控 | 确定性开始接诊、队列和叫号事件 |
| 奖励结算前释放患者座位或叫入下一位 | session/评价/奖励跨患者串线 | 结算与离场 checkpoint 完成后才推进队列 |
| 因桌面能看到上方区域就把 CT/B 超做进 MVP | 范围膨胀、移动端流程未定义 | MVP 只做灰雾锁定与扩展锚点，完整远端检查另立 Change ID |
| 直接复制《星露谷物语》素材或可识别 UI/构图 | 风格依赖和版权风险 | 只借鉴温暖 2D 像素生活模拟的高层体验，建立原创 Visual Bible |
| 重试/崩溃/多标签导致重复或半笔发奖 | 经济、解锁和存档损坏 | 唯一 evaluationId + 单个 IndexedDB transaction + 故障注入 |
| 只有禁用字段名扫描 | 隐藏值可借合法字段、日志或缓存泄漏 | 私有随机 canary values 扫描全部客户端表面 |
| 本地存档覆盖服务端医学状态 | 恢复错误和隐藏信息风险 | 双权威合并流程 |
| 新内容覆盖旧路径 | 地图/脚本/存档错配 | 不可变 contentBuildId |
| 中文长文本使用微型像素字 | 手机不可读、无障碍失败 | DOM 可读字体 + 像素装饰语言 |
| 音频自动播放假设 | 移动浏览器无声/报错 | 首次用户手势解锁 |
| 模拟器代替真机 | 忽略 Android Chrome 实际问题 | H10 真机门 |
| 工作树清理/重置 | 覆盖用户和其他代理改动 | 每步 git status，禁止 destructive reset |

## 18. 计划变更协议

所有已冻结决定只能通过 Change ID 修改，禁止静默覆盖。

### 18.1 已登记变更：GAME-CHG-20260829-01

```text
Change ID：GAME-CHG-20260829-01
提出日期：2026-08-29
提出者：项目负责人/用户
原决策/原范围：移动提示后开始营业；单患者；无患者离场；第二位患者/队列和完整商店均不进入 MVP；经营只选一种资源
新要求：横屏淡入坐姿开场；电脑开始接诊；左侧可见队列与桌面叫号；至少两名患者循环；全部发言角色锚定气泡；右侧帘后患者自主检查与报告查看；患者结算后离场；金币+声望；电脑商店/升级各做一个纵切；桌面额外显示上/下灰雾锁定区
变更原因：对齐项目负责人描述的目标玩家体验和完整接诊循环
影响的 Phase：S0–S11，重点 S1/S2/S4/S5/S6/S7/S8/S9/S10b
影响文件或资产：计划；后续 clinic-flow、queue、speech bubble、map、character animation、report、economy/reputation/shop/upgrade、save 与 e2e
是否影响 share contract：当前不改变；队列/叫号/金币/声望属于 game。报告复用 TestResultV1/TurnCompletedV1.effects；若后续需要新增公开检查位置/耗时字段，另走 share Change ID
是否影响 saveSchemaVersion：实施时是；新增 shift、queue、seat/exam/leave checkpoint、coins、reputation、purchase 和 upgrade 状态必须迁移
是否影响 contentBuildId：正式地图、坐姿/离场动画、电脑/叫号/帘子/报告/商店 UI 接入时是
是否影响 rewardRuleVersion：是；从单资源改为金币+声望并加入升级阈值
是否使 LOCKED 素材失效：当前无 LOCKED 正式素材；未来按 H3–H6 管理
新增自动测试：横屏门、淡入、电脑开诊、队列/叫号/座位、双患者、气泡、检查动线、报告、离场、金币/声望、购买/升级、刷新与多标签
新增人工验收：手机/桌面构图、开场节奏、气泡可读性、帘后动线、双患者循环、商店/升级反馈
工程投入变化：S2、S5–S9、S10b 和 e2e 范围增加；CT/B 超完整房间被明确延期以抵消范围
人工等待/反馈轮数变化：增加空间/气泡/坐姿/双患者/经营纵切验收；不重问已确认的核心流程
回退方法：按独立 feature/config 回退到上一灰盒/contentBuildId/save migrator；不得把患者保留在座位或单资源旧语义伪装为新计划完成
用户批准：用户已明确要求据此修改/补充计划；不等同于 H-START 代码实施授权或 H2–H10 素材/发布验收
```

### 18.2 后续变更模板

```text
Change ID：GAME-CHG-YYYYMMDD-NN
提出日期：
提出者：
原决策/原范围：
新要求：
变更原因：
影响的 Phase：
影响文件或资产：
是否影响 share contract：
是否影响 saveSchemaVersion：
是否影响 contentBuildId：
是否影响 rewardRuleVersion：
是否使 LOCKED 素材失效：
新增自动测试：
新增人工验收：
工程投入变化：
人工等待/反馈轮数变化：
回退方法：
用户批准：
```

规则：

- 视觉文案变化通常不等于 share 变更；ID、DTO、状态和恢复语义变化必须走共享契约变更；
- 存档字段或语义变化必须 bump `saveSchemaVersion` 并提供迁移；
- 地图、spritesheet、音频或 UI 运行资产变化必须生成新 `contentBuildId`；
- 奖励公式变化必须生成新 `rewardRuleVersion`；
- `LOCKED` 尺寸、视角、色板或角色比例变化必须先做全资产影响分析；
- 新范围必须明确删除/延期项或新增投入；
- 步骤可被拆分、插入、重排或放弃，但必须更新依赖图和 DoD；
- 阻塞只影响实际依赖该门的分支，不自动暂停整个计划；
- 放弃某 Phase 时说明 MVP 层级是否随之降级。

## 19. 计划级验证命令

完成全部实施后，至少具备以下命令或等价能力：

```powershell
cd D:\Learn\20_Projects\MedicalAI\apps\game\share
npm run typecheck
npm test
npm run test:coverage
npm run test:contract

cd D:\Learn\20_Projects\MedicalAI\apps\game\game
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

若后续新增脚本，建议名称：

```text
npm run test:contract
npm run assets:validate
npm run maps:validate
npm run save:validate
npm run security:scan-client
npm run test:e2e:golden
```

脚本名称可以调整，但能力不能被“手工看起来没问题”替代。

## 20. 官方工具、素材和许可参考

以下链接在 2026-08-27 核对；实际下载或安装时仍需重新查看当前版本和条款。

### 游戏与内容工具

- [Tiled 文档](https://doc.mapeditor.org/en/stable/)
- [Tiled JSON 格式](https://doc.mapeditor.org/en/stable/reference/json-map-format/)
- [Aseprite CLI](https://www.aseprite.org/docs/cli/)
- [Aseprite FAQ 与许可](https://www.aseprite.org/faq)
- [LibreSprite](https://libresprite.github.io/)
- [Audacity](https://www.audacityteam.org/)
- [PixelLab 文档](https://www.pixellab.ai/docs)

### 素材社区与许可

- [Kenney 支持/CC0 说明](https://kenney.nl/support)
- [OpenGameArt 许可 FAQ](https://opengameart.org/node/5571)
- [itch.io Game Assets](https://itch.io/game-assets)
- [Freesound 许可 FAQ](https://freesound.org/help/faq/)
- [Pixabay Content License](https://pixabay.com/service/license-summary/)

### 项目技术参考

- [Phaser 4.2.1 release](https://phaser.io/download/release/v4.2.1)
- [Phaser Arcade Physics](https://docs.phaser.io/phaser/concepts/physics/arcade)
- [Phaser cameras](https://docs.phaser.io/phaser/concepts/cameras)
- [React useEffect](https://react.dev/reference/react/useEffect)
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)

## 21. 实施授权与第一轮行动

批准本计划后，AI 不会立刻要求用户一次提供全部美术。第一轮只执行：

1. S0 基线与 H0/H1 剩余数值/范围问题；不重问 G-D13–G-D23；
2. S1 第一轮视觉细化访谈，围绕既定诊室构图、坐姿、患者组、气泡、帘后区和灰雾区产出方向；
3. 同时准备不依赖正式美术的 S4 share/mock 技术工作；
4. 在用户选择视觉方向后建立 S2 横屏淡入、电脑、队列、叫号与双患者诊所灰盒；
5. 由用户实际试玩后再冻结尺寸并请求第一批正式素材。

项目负责人可使用以下授权语句：

```text
按 docx/plan/game/游戏层MVP实施计划.md 开始实施。
先执行 S0 和 S1；所有美术与玩法人工门按计划询问我，未确认分支使用 placeholder，其他安全分支继续。
```

如果项目负责人只想先评审计划而不开始代码，可以回复具体修改意见；AI 应按第 18 节记录变更，并重新提交计划摘要和受影响依赖。
