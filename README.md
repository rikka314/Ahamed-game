# AhaMed Doctor Game

独立的 Web 单人模拟医生游戏。目标是俯视 2D 像素风体验：玩家可以在诊所等场景中自由走动、与 NPC 和环境交互，并完成问诊、检查、诊断和复盘。

游戏层独立 package 已在 `game/` 初始化，并完成可运行的 Phaser 4 浏览器 PoC。当前可以在占位诊所场景中使用键盘或触摸移动、接近患者 NPC，并通过 React/Phaser typed bridge 打开 DOM 交互界面。

## 技术栈

- 当前游戏层：Next.js 16.3.2、React 19.2.8、TypeScript 5.9.3、Phaser 4.2.1
- 根目录遗留壳：Next.js 15，仅暂作未来集成壳候选
- 地图与碰撞：Tiled 1.12.2 JSON、Phaser Arcade Physics
- 单机存档：IndexedDB
- 测试：Vitest、Playwright

完整选型、浏览器边界、素材管线与实施顺序见 [技术栈.md](docx/baseknowledge/技术栈.md)。

## 前期并行开发结构

- `game/`：游戏层独立项目边界，负责二维世界、模拟经营、美术表现和客户端体验。
- `model/`：模型层独立项目边界，负责病例、LLM 编排、患者模拟、检查、诊断与评测。
- `share/`：共享连接层，负责契约、Schema、fixture、跨层测试和最终合并规则。
- 当前根目录的 Next.js 初始化壳暂时保留；`game/` 已作为现阶段独立游戏开发和运行入口，根壳最终是否保留留待 MVP 合并方案审核。

三层之间的职责、接口和合并门槛见 [共享层基本内容.md](docx/baseknowledge/共享层基本内容.md)。

## 本地运行

```bash
cd game
npm install
npm run dev
```

访问 `http://localhost:3020`。

## 当前边界

- `game/package.json` 已精确锁定 Phaser 4.2.1，并使用官方 npm registry 生成 lockfile
- 当前场景是程序生成的运行时占位 PoC，不是正式 Tiled 地图或像素素材
- 尚未接入 `share/` contract、病例 mock、IndexedDB 存档、经营系统、AhaMed 主站、数据库或真实模型 API
- 不修改知识库和最短学习路径项目
