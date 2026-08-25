# AhaMed 游戏层

`game/` 是前期并行开发阶段可独立运行的游戏层 package。它拥有 Next/React 网页壳、Phaser 世界、输入与表现、纯 TypeScript 游戏规则、客户端存档和游戏侧模型 adapter；它只允许通过 `../share/` 的版本化契约连接模型层。

## 当前初始化内容

- Next.js 16 + React 19 + TypeScript 独立应用；本地端口为 `3020`。
- Phaser 4.2.1 client-only 启动，React Strict Mode 下可安全创建和销毁实例。
- `BootScene -> WorldScene` 最小场景链路。
- 键盘和触摸方向控制、Arcade Physics、患者交互点。
- React/DOM 与 Phaser 之间的 typed event bridge。
- 纯 TypeScript 移动规则和 Vitest 单元测试。
- Playwright 浏览器 smoke test。
- 带 `contentBuildId` 的静态资源 manifest。

当前场景使用程序生成的占位纹理，只用于验证运行时边界。Tiled 地图、正式像素素材、病例 mock adapter、IndexedDB 存档和经营系统仍需按技术 PoC 顺序逐步实现。

## 目录

```text
game/
├─ app/                       Next 游戏入口
├─ components/                React/DOM 游戏壳与交互层
├─ src/game/
│  ├─ bootstrap.ts            client-only Phaser 启动
│  ├─ bridge/                 React <-> Phaser typed events
│  ├─ domain/player/          不依赖 Phaser 的玩家规则
│  └─ scenes/                 Phaser Scene
├─ assets/source/             可编辑素材入口说明
├─ public/game-assets/        带 build ID 的运行时资源
└─ tests/                     unit 与 e2e
```

子目录只在有实际代码、测试或说明时创建，不预生成空层级。

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3020`。

常用验证：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright 首次运行前如缺少浏览器，可执行 `npx playwright install chromium`。

## 边界

- 禁止 import `../model/` 的任何内部代码。
- 浏览器端不得包含完整病例、隐藏事实、答案、rubric、prompt 或模型密钥。
- 医学评分只作为结构化输入；金钱、经验、声望和解锁由游戏层纯规则计算。
- 正式地图使用 Tiled JSON；场景、存档和跨层引用只保存稳定 ID。
- 根目录现有 Next.js 壳暂时保留为集成壳候选，本次初始化不删除或迁移它。

完整技术基线见 [`../docx/baseknowledge/技术栈.md`](../docx/baseknowledge/技术栈.md)，跨层规则见 [`../docx/baseknowledge/共享层基本内容.md`](../docx/baseknowledge/共享层基本内容.md)。
