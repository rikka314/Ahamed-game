# AhaMed Doctor Game Context

## 项目定位

面向 AhaMed 网站引流的 Web-first 单人模拟医生游戏。采用俯视 2D 像素风，玩家可在诊所等场景中自由走动、与 NPC 和环境交互，并进入问诊、检查、诊断和结果流程。同时还会加入升级、购买新设备等养成经营内容。

## 当前状态

- 游戏层独立 package 已在 `game/` 初始化：Next.js 16.3.2、React 19.2.8、TypeScript 5.9.3、Phaser 4.2.1、idb 8.0.3、Vitest 4.1.11、Playwright 1.62.1
- `game/` 已有 client-only Phaser 启动、`BootScene -> WorldScene`、Arcade Physics、键盘/触摸移动、患者 NPC 交互、React/Phaser typed bridge、纯 TypeScript 移动规则和基础 unit/e2e 测试
- 当前游戏场景只使用程序生成的公开占位纹理，用于验证运行时与边界，不代表正式地图或美术已经落地
- 根目录 Next.js 15 初始化壳暂时保留为未来集成壳候选；游戏层开发和本地运行以 `game/` 为当前入口
- 目标技术栈仍包括 Tiled 1.12.2 JSON 地图、版本化 IndexedDB 存档和 `share/` contract v1；完整审核与约束见 `docx/baseknowledge/技术栈.md`
- 原 Godot 3D 技术基线已撤销；当前正式发布与真机范围为桌面浏览器和 Android，完整体验以 WebGL 为验收目标；iOS 不属于本轮交付范围
- 本地端口：3020
- 2026-09-04 首发范围调整为“标准病人纯对话版”：`game/app/page.tsx` 现在提供与 AhaMed 主站一致的暖白、淡紫和深墨色临床问诊工作台，开放 r9 发布清单中的 30 个 `published + approved` 病例；进入页面和完成一例后都会从可用病例中随机分诊，界面不暴露病例目录、固定患者信息栏、诊断侧栏或手动选例/提交入口。玩家在同一输入框自由问诊并明确说出最终诊断，Patient Agent 的诊断意图提取通过服务端门禁后自动触发确定性评分，结果以模态悬浮窗展示总分、六项分数和“再来一局”；自动结算保留原对话幂等键，评分重试键只由服务端按持久化的明确失败状态顺序派生且每局最多三个，每个 HTTP 请求至多启动一次评分，并可恢复已完成但响应丢失的结果。创建会话的请求键也会在未知传输结果后跨刷新复用。浏览器只消费公开 allowlist 投影。二维 Phaser 诊所仍保留在 `/world-preview`，不作为首发入口。
- `game/app/api/clinic/**` 是同源 BFF/composition root，只在服务端调用 `@ahamed/doctor-game-model@0.2.7` 的公开 Web runtime，并固定载入 `manifest.launch-release-20260904-r9.json` 的 30 个 `published + approved` 病例；病例答案、rubric、生产 prompt、模型密钥和未披露事实不进入客户端。Web runtime 使用 SQLite、匿名 HttpOnly SameSite=Strict profile cookie 和现有 `share v1-rc2` DTO/状态机，限制请求大小/来源/频率，过期会话按配置清理，Provider 未配置或失败时继续 fail closed。生产数据库必须使用私有可写卷上的绝对路径。
- 主站仓库 `D:/Learn/20_Projects/AhaMed` 的“标准病人演练”卡片仍指向稳定路径 `/content/standardized-patient`；该路由通过服务端环境变量 `STANDARDIZED_PATIENT_APP_URL` 跳转到本应用，开发默认值为 `http://127.0.0.1:3020`，生产环境必须显式配置真实部署地址。
- 三层边界设计已完成；`model/` 的既有 Phase 0–8 历史证据继续只读保留。可玩 CLI 只允许真实 OpenAI-compatible Patient Agent，每轮传入完整已提交对话历史；病例显示名只作场景称呼或姓氏提示，显式人格锚点和医学事实保持硬约束，未提供的非医疗角色细节可由 AI 合理补全并跨轮保持一致。患者不得暴露“病例/资料未提供”等幕后状态；本地不使用固定问答、关键词患者话术、诊断词表路由或患者回复重渲染。明确的“最终诊断……”声明会先在服务端提取成结构化数据，原始声明不进入 Patient Provider，提交到沟通复核的轨迹使用固定脱敏文本；该脱敏不变量已覆盖 SQLite `response_validated` 崩溃恢复与 `commit-buffered` 后续评分路径。其余自然语言仍由 Patient Agent v0.5.0 判断诊断意图，本地门禁校验疾病词可回溯到玩家原话，正确性由确定性评分器判断。真实 Provider 未配置或失败时 fail closed。当前 Web runtime 定向测试 2/2、模型层全量测试 459/459 通过，全部覆盖率门通过。
- 2026-09-02 已完成《模型层病例与人格扩充实施计划》E0：`model/cases/policy/launch-content-policy-v1.json` 机器冻结 30 例矩阵、9 个疾病域配额、24/6 难度、六人格各 5 例且跨至少 3 域、30 个唯一 `patientRoleId`、首发排除、来源许可判定和 v2 版本政策；`model/src/cases/launch-content-policy.ts` 与 JSON Schema 执行结构和跨行语义校验，`npm run cases:validate:launch-policy` 可复验质量记录。旧 C6/C7/RC 的 6 组最新历史制品以精确 SHA-256 记录为 `superseded`。隔离 AI 来源/许可审核尚未运行，按计划如实记录为非阻塞 `not_run`。
- 2026-09-04 已完成同一计划 E1、M0 与 B1–B5：`case-package-v2-rc1`、`patient-persona-templates-v2`、`provenance-record-v2`、非阻塞 `ai-case-cross-review-v3` 与结构型 `case-manifest-v2-rc1` 已实现；身份、交流人格和医学事实分层，六人格及三项 modifiers 可安全投影到统一 Patient Agent 输入。C01–C05 已显式迁移，C06–C30 已分五批生成；旧 v1 继续只读兼容且未被覆盖。活动集合共 30 例、120 条回归轨迹、300 条黄金向量、600 条问诊样本、40 条新增域安全样本、60 次病例 AI 调用和 360 项审核检查。
- 2026-09-04 的当前 E2 活动清单为 `model/cases/manifest.phase6-compat.v2-rc9.json`，病例发布绑定为 `model/cases/manifest.launch-release-20260904-r9.json`。清单统一 1/5/30 例语义与制品校验，red-flag policy 拆为通用集合和 9 个疾病域策略，Phase 7 语料显式绑定到 Manifest。病例发布、C7 dialogue/acceptance、runtime manifest 与 Software RC 对 AI 拒绝、未运行和陈旧证据采用 `reviewPolicy: non_blocking` 的结构化 findings；Schema、路径、hash、原子写入和不可覆盖仍是技术硬错误。r9 的 30 例均为 `published + approved`。
- E3 工程与六人格真实运行记录已完成。当前权威证据 `model/evaluation/phase8/e3-persona-live-20260904-r4/` 包含六人格 × 12 场景的 72 条规则断言、六份 journey 和 84 个已提交轮（每人格 14 轮）；Patient 回复率与人格一致率均为 100%，诊断、未完成检查结果和 unknown-as-absent 泄漏均为 0。医学事实边界 reviewer 对 `e3-run-02.turn-7` 新增的“两天鼻部不适”判为 1/84 严重事实错误，因此审核为 `rejected`；报告 SHA-256 为 `79b59e61a8f3b661d81fd1d9dfbefdf1e040deeb5606ad12695e0efdf96323b7`。E5 对后来安全门修改观测到 1 项 source-tree reuse binding 漂移，E3 自身证据复验仍通过；两者均按非阻塞政策如实保留。
- E4 工程与最终跨层闭环已完成。`share` 的 `v1-rc2` / package `1.0.0-rc.2` 以必填 `CaseSummaryV1.patientRoleId` 暴露公开身份键，rc1 制品保持冻结；模型与游戏 adapter 均采用 allowlist。当前证据 `model/evaluation/phase8/e4-cross-layer-20260904-r12/` 与闭包 `share/versions/e4-patient-identity-e5-closure.20260904-r10.json` 覆盖 30 例、15 个两槽班次、30 次创建会话/问诊/离场、5 个运行时表面、零敏感命中、Chromium 2/2 及两个隔离且均通过的 AI 审核；闭包 SHA-256 为 `8aebd370a1825f55db576cd3da1d3e30a949c7cdf885e2a9c72ec5e576b6a3c5`。save-export 尚不存在，已作为证据限制记录。
- E5 当前权威候选为 `model/evaluation/phase8/e5-full-release-20260904-r3/`。24/24 本地技术门全部通过，源码树与 staged RC 均独立复验 2068 个制品，staged 扫描覆盖 1959 个文本文件和 7 个公开证据文件，密钥与隐藏字段命中均为 0；acceptance、runtime manifest、index 与 tar.gz 的 SHA-256/大小复验全部通过，tar.gz SHA-256 为 `b38444f2f55ad29d5d25ad66c723f5f298b9435d18716cffd8e77d1261407ab2`。最终 decision 为政策允许的 `reported_with_failures`，9 条非阻塞 finding 包含 E3 的 1 个事实错误及 1 项陈旧绑定、C7 对话的上下文/事实审核未达标，以及 60 项来源许可 AI 评估 `not_run`。病例分支本身已修复：`model/evaluation/phase8/c7-ai-release-20260904-r9/` 为 30/30 病例批准、60/60 调用、360/360 检查、0 finding；旧 25 例拒绝不再是当前结论。
- `model/cases/review/病例审核工具.html` 保留为可选的离线内容反馈台：内置 C01–C05，支持导入后续病例、逐例意见、浏览器自动保存、审核意见 JSON 及内嵌状态的可回传 HTML 副本。该工具不生成 AI 发布批准，其人工意见也不会阻塞发布；正式发布依据只来自与冻结病例精确绑定的 `model/cases/ai-validation/` 交叉验证记录。
- 历史 Phase 8-A Software RC 文件仍位于 `model/evaluation/phase8/software-rc-20260828/`，原 ZIP SHA-256 `6632228e553e36223c624b16d836b00d7ef55dd4cd270ce35b82505eee183b5e`，只可作为被替代版本的审计记录。当前病例双 AI 与安全语料证据位于 `model/evaluation/phase8/c7-ai-release-20260904-r9/`，当前完整候选为 E5 r3；旧 `c7-ai-20260828-r1`、C6 r6、C7 runtime r10、dialogue-live r5、runtime manifest r11、Software RC r9 和 E5 r1/r2 均只作历史证据。
- 当前真实对话证据 `model/evaluation/phase8/c7-dialogue-live-20260904-r4/` 覆盖 30 例、六人格和 360 个已提交轮，只调用 Patient Agent，Patient 回复率 100%、人格一致率 99.72%、上下文跟进率 91.67%、自然语言检查动作正确率 100%，诊断与未完成检查结果泄漏均为 0；独立审核记录 24 个严重事实错误并给出 `rejected` / `revision_recommended`，因此 E5 r3 如实保留为非阻塞质量 finding，不能宣称对话质量已通过。
- `share/` 当前为独立 `@ahamed/doctor-game-share@1.0.0-rc.2` package：公共 TypeScript DTO、JSON Schema、36 项正反 fixture、会话状态机、错误/安全/事件、allowlist 投影、幂等 fingerprint 规则和版本清单；E4 新增必填 `CaseSummaryV1.patientRoleId`，并把 rc1 与 rc2 的入口、Schema、fixture 分目录冻结。`model/` 已同步创建会话 adapter；首发网页已通过服务端 Web runtime 接通创建会话、问诊和诊断，检查 UI 与完整经营 adapter 留待后续版本。
- 游戏层尚未实现正式二维素材、IndexedDB 存档和模拟经营闭环；这些能力不阻塞当前纯对话首发。旧二维灰盒继续位于 `/world-preview`，用于保留运行时和跨层回归证据。
- `game/` 与 `model/` 继续保持独立业务边界，`share/` 保存双方共同遵守的 DTO 与状态机契约；首发网页只在 Next.js 服务端 composition root 组合模型公开 facade，浏览器与游戏领域代码不得引用模型内部模块。

## 目录约定

- `apps/game/` 是本项目的所有权边界；游戏相关代码、配置、素材、测试、构建文件和文档全部放在本目录内
- `AGENTS.md` + `.codex/skills/load-game-context/SKILL.md`：项目常驻上下文入口；在本目录及子目录工作前，必须先完整读取本文件和 `docx/baseknowledge/压缩上下文.md`，再按任务路由只完整读取相关长文档
- `.codex/skills/produce-s1-game-assets/SKILL.md`：S1 第一批游戏素材的单入口制作 skill；按地图/道具、角色、DOM UI、音频四条制作线自动路由，内置 H3 DRAFT 门禁、工具分工、来源许可、运行时交付和验收规则
- `docx/baseknowledge/压缩上下文.md`：默认必读的短摘要与文档路由；概括三份长文档，但不替代任务命中的详细设计
- `docx/baseknowledge/技术栈.md`：游戏层技术、二维世界、模拟经营、美术、客户端存档、测试与发布基线
- `docx/baseknowledge/开源资源与技术方案.md`：模型层病例、LLM 角色、检查、诊断、评分、评测、安全与开源参考基线
- `docx/baseknowledge/共享层基本内容.md`：共享契约、状态机、API、事件、稳定 ID、版本、安全边界、联调与合并门槛
- `game/`：前期游戏层独立项目边界；首发根路由为标准病人对话工作台，并以服务端 BFF 组合模型公开 runtime；二维世界、NPC 表现、模拟经营、美术、输入、UI 与客户端存档仍由该层负责，旧二维灰盒入口为 `/world-preview`
- `model/`：前期模型层独立 TypeScript package；负责病例生产、Patient Agent 患者模拟、检查事实、诊断评估、评分、安全与观测。`npm run headless` 保留离线脚本闭环；可玩入口使用 `npm run cli -- --user <id> --provider openai --model <modelId>`，必须配置真实 OpenAI-compatible Provider。`npm run cases:validate:dialogue` 验证活动 30 病例的人格、检查别名、Schema 与 canonical hash。`createSqliteModelService` 是 SQLite v6 持久化入口，默认未配置真实 Provider 时直接拒绝问诊；`npm run ops:inspect` / `ops:recover` 用于脱敏检查和显式恢复，`npm run test:contract` 验证 share 与私有病例 Schema。deterministic provider 仅可作为自动化测试替身，不能进入可玩 CLI 或冒充当前发布证据。
- `share/`：已实现的连接层独立 package；负责跨项目 DTO、JSON Schema、事件协议、fixture、契约测试和版本管理，当前版本为 v1-rc2
- 当前根目录 `app/` 仍是 Next.js 15 初始化壳并暂作集成壳候选；`game/app/` 是现阶段独立游戏层入口，最终是否删除根壳留待 MVP 合并方案审核
- 浏览器和游戏领域代码不得直接引用模型内部模块，只能依赖 `share/` 中的版本化契约；Next.js 服务端 composition root 可组合模型 package 的公开 facade，且必须维持 allowlist 与隐藏信息边界
- LLM 密钥、隐藏病例事实、标准答案和评分规则必须保留在模型侧可信服务端，不得进入 `public/`、客户端 bundle、游戏素材或 IndexedDB
