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
- 三层边界设计已完成；`model/` 的既有 Phase 0–8 历史证据继续只读保留。2026-08-29 对《模型层对话架构重构计划》C6/C7 做了用户验收后的 AI 主导纠偏：可玩 CLI 只允许真实 OpenAI-compatible Patient Agent，不再允许选择 deterministic provider；每一轮向 Patient Agent 传入完整已提交对话历史。病例 `patientDisplayName` 仅作为诊室场景称呼或姓氏提示，显式年龄/性别等人格锚点和病例医疗事实保持硬约束；姓名、家庭成员姓名、住址、普通日常经历等未给出的非医疗细节由 AI 合理补全，并依靠完整历史在后续轮次保持一致。患者回复不得提及“病例没有说明”“资料未提供”等幕后数据状态。本地不再按关键词选择固定问答、固定社交话术、诊断词表路由或重渲染患者回答；服务端只保留结构、医疗事实/显式人格/检查引用、检查状态、沉浸感和泄漏边界，真实 Provider 未配置或失败时 fail closed。当前 Patient Agent v0.4 在同一次模型调用中分析玩家是否已明确提交唯一主诊断：肯定、结论性的单一主诊断直接启动本地评分；一个明确主诊断加多个鉴别诊断同样提交；多个疾病并列但没有主次、疑问或仍不确定时继续对话。AI 只提取本轮玩家原话中的疾病词和提交意图，不判断正确性；服务端门禁要求所有提取词逐字可回溯到玩家输入。模型层全量测试为 331/331，覆盖率门全部通过；本地实际 `gpt-5.6-sol` 已验证明确单诊断直接评分、主诊断加多个鉴别诊断评分、多病无主次保持 active，以及非医疗角色补全和历史一致性。
- `model/cases/review/病例审核工具.html` 保留为可选的离线内容反馈台：内置 C01–C05，支持导入后续病例、逐例意见、浏览器自动保存、审核意见 JSON 及内嵌状态的可回传 HTML 副本。该工具不生成 AI 发布批准，其人工意见也不会阻塞发布；正式发布依据只来自与冻结病例精确绑定的 `model/cases/ai-validation/` 交叉验证记录。
- 历史 Phase 8-A Software RC 文件仍位于 `model/evaluation/phase8/software-rc-20260828/`，原 ZIP SHA-256 `6632228e553e36223c624b16d836b00d7ef55dd4cd270ce35b82505eee183b5e`，只可作为被替代版本的审计记录。病例双 AI 和安全语料证据仍可追溯到 `model/evaluation/phase8/c7-ai-20260828-r1/`；旧 C6 r6、C7 runtime r10、dialogue-live r5、runtime manifest r11 与 Software RC r9 均先于 AI-only/完整历史纠偏产生，现只作历史证据，不能声明为当前源码的发布通过。
- `model/evaluation/phase8/c7-runtime-release-20260829-r11/runtime-release-manifest.v1.json` 与 `model/evaluation/phase8/c7-software-rc-20260829-r9.zip` 的旧哈希继续保留在原制品中供审计，但当前源码修改后必须重新生成 runtime manifest、真实 AI 对话验收和 Software RC，才能恢复 C7 当前发布资格。
- `share/` 已实现独立 `@ahamed/doctor-game-share@1.0.0-rc.1` package：公共 TypeScript DTO、JSON Schema、36 项正反 fixture、会话状态机、错误/安全/事件、allowlist 投影、幂等 fingerprint 规则、版本清单和 contract tests；C5 在保留同一版本标签的前提下为 `TurnCompletedV1` 增加必填 `effects`，因此旧 RC producer/consumer 不兼容；`model/` 已同步 adapter，游戏侧 adapter 尚未实现
- 游戏层尚未实现 Tiled 像素地图、正式素材、IndexedDB 存档、模拟经营、`share/` mock adapter、病例数据、真实模型 API 和主站集成
- 前期采用游戏层与模型层并行开发：`game/` 和 `model/` 作为两个独立开发边界，`share/` 保存双方共同遵守的连接契约；达到共享层合并门槛后再进入统一 MVP 开发

## 目录约定

- `apps/game/` 是本项目的所有权边界；游戏相关代码、配置、素材、测试、构建文件和文档全部放在本目录内
- `AGENTS.md` + `.codex/skills/load-game-context/SKILL.md`：项目常驻上下文入口；在本目录及子目录工作前，必须先完整读取本文件和 `docx/baseknowledge/压缩上下文.md`，再按任务路由只完整读取相关长文档
- `.codex/skills/produce-s1-game-assets/SKILL.md`：S1 第一批游戏素材的单入口制作 skill；按地图/道具、角色、DOM UI、音频四条制作线自动路由，内置 H3 DRAFT 门禁、工具分工、来源许可、运行时交付和验收规则
- `docx/baseknowledge/压缩上下文.md`：默认必读的短摘要与文档路由；概括三份长文档，但不替代任务命中的详细设计
- `docx/baseknowledge/技术栈.md`：游戏层技术、二维世界、模拟经营、美术、客户端存档、测试与发布基线
- `docx/baseknowledge/开源资源与技术方案.md`：模型层病例、LLM 角色、检查、诊断、评分、评测、安全与开源参考基线
- `docx/baseknowledge/共享层基本内容.md`：共享契约、状态机、API、事件、稳定 ID、版本、安全边界、联调与合并门槛
- `game/`：前期游戏层独立项目边界；负责二维世界、NPC 表现、模拟经营、美术、输入、UI 与客户端存档
- `model/`：前期模型层独立 TypeScript package；负责病例生产、Patient Agent 患者模拟、检查事实、诊断评估、评分、安全与观测。`npm run headless` 保留离线脚本闭环；可玩入口使用 `npm run cli -- --user <id> --provider openai --model <modelId>`，必须配置真实 OpenAI-compatible Provider。`npm run cases:validate:dialogue` 验证五病例人格、检查别名、Schema 与 canonical hash。`createSqliteModelService` 是 SQLite v6 持久化入口，默认未配置真实 Provider 时直接拒绝问诊；`npm run ops:inspect` / `ops:recover` 用于脱敏检查和显式恢复，`npm run test:contract` 验证 share 与私有病例 Schema。deterministic provider 仅可作为自动化测试替身，不能进入可玩 CLI 或冒充当前发布证据。
- `share/`：已实现的连接层独立 package；负责跨项目 DTO、JSON Schema、事件协议、fixture、契约测试和版本管理，当前版本为 v1-rc1
- 当前根目录 `app/` 仍是 Next.js 15 初始化壳并暂作集成壳候选；`game/app/` 是现阶段独立游戏层入口，最终是否删除根壳留待 MVP 合并方案审核
- 游戏层和模型层不得直接引用对方内部模块，只能依赖 `share/` 中的版本化契约；开发期分别使用 mock server 与 headless client 验证
- LLM 密钥、隐藏病例事实、标准答案和评分规则必须保留在模型侧可信服务端，不得进入 `public/`、客户端 bundle、游戏素材或 IndexedDB
