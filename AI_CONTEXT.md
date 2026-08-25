# AhaMed Doctor Game Context

## 项目定位

面向 AhaMed 网站引流的 Web-first 单人模拟医生游戏。采用俯视 2D 像素风，玩家可在诊所等场景中自由走动、与 NPC 和环境交互，并进入问诊、检查、诊断和结果流程。同时还会加入升级、购买新设备等养成经营内容。

## 当前状态

- 游戏层独立 package 已在 `game/` 初始化：Next.js 16.3.2、React 19.2.8、TypeScript 5.9.3、Phaser 4.2.1、idb 8.0.3、Vitest 4.1.11、Playwright 1.62.1
- `game/` 已有 client-only Phaser 启动、`BootScene -> WorldScene`、Arcade Physics、键盘/触摸移动、患者 NPC 交互、React/Phaser typed bridge、纯 TypeScript 移动规则和基础 unit/e2e 测试
- 当前游戏场景只使用程序生成的公开占位纹理，用于验证运行时与边界，不代表正式地图或美术已经落地
- 根目录 Next.js 15 初始化壳暂时保留为未来集成壳候选；游戏层开发和本地运行以 `game/` 为当前入口
- 目标技术栈仍包括 Tiled 1.12.2 JSON 地图、版本化 IndexedDB 存档和 `share/` contract v1；完整审核与约束见 `docx/baseknowledge/技术栈.md`
- 原 Godot 3D 技术基线已撤销；正式平台改为桌面与移动浏览器，完整体验以 WebGL 为验收目标
- 本地端口：3020
- 三层边界设计已完成；`model/` 已完成 Phase 0 TypeScript 初始化，可用纯合成 fixture 和确定性 provider 独立跑通创建会话、问诊、检查、诊断、评分与审计事件；真实 LLM provider、正式审核病例、持久化、共享 contract adapter 和主站集成仍未实现
- 游戏层尚未实现 Tiled 像素地图、正式素材、IndexedDB 存档、模拟经营、`share/` mock adapter、病例数据、真实模型 API 和主站集成
- 前期采用游戏层与模型层并行开发：`game/` 和 `model/` 作为两个独立开发边界，`share/` 保存双方共同遵守的连接契约；达到共享层合并门槛后再进入统一 MVP 开发

## 目录约定

- `apps/game/` 是本项目的所有权边界；游戏相关代码、配置、素材、测试、构建文件和文档全部放在本目录内
- `AGENTS.md` + `.codex/skills/load-game-context/SKILL.md`：项目常驻上下文入口；在本目录及子目录工作前，必须先完整读取本文件和 `docx/baseknowledge/压缩上下文.md`，再按任务路由只完整读取相关长文档
- `docx/baseknowledge/压缩上下文.md`：默认必读的短摘要与文档路由；概括三份长文档，但不替代任务命中的详细设计
- `docx/baseknowledge/技术栈.md`：游戏层技术、二维世界、模拟经营、美术、客户端存档、测试与发布基线
- `docx/baseknowledge/开源资源与技术方案.md`：模型层病例、LLM 角色、检查、诊断、评分、评测、安全与开源参考基线
- `docx/baseknowledge/共享层基本内容.md`：共享契约、状态机、API、事件、稳定 ID、版本、安全边界、联调与合并门槛
- `game/`：前期游戏层独立项目边界；负责二维世界、NPC 表现、模拟经营、美术、输入、UI 与客户端存档
- `model/`：前期模型层独立 TypeScript package；负责病例生产、患者模拟、检查事实、诊断评估、评分、模型安全与观测；`npm run headless` 是当前独立闭环入口，确定性 provider 仅用于开发测试
- `share/`：连接层；负责跨项目 DTO、JSON Schema、事件协议、fixture、契约测试和版本管理
- 当前根目录 `app/` 仍是 Next.js 15 初始化壳并暂作集成壳候选；`game/app/` 是现阶段独立游戏层入口，最终是否删除根壳留待 MVP 合并方案审核
- 游戏层和模型层不得直接引用对方内部模块，只能依赖 `share/` 中的版本化契约；开发期分别使用 mock server 与 headless client 验证
- LLM 密钥、隐藏病例事实、标准答案和评分规则必须保留在模型侧可信服务端，不得进入 `public/`、客户端 bundle、游戏素材或 IndexedDB
