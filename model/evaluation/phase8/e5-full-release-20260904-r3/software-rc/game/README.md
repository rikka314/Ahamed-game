# AhaMed 游戏层

`game/` 是前期并行开发阶段可独立运行的游戏层 package。它拥有 Next/React 网页壳、Phaser 世界、输入与表现、纯 TypeScript 游戏规则、客户端存档和游戏侧模型 adapter；它只允许通过 `../share/` 的版本化契约连接模型层。

## 当前初始化内容

- Next.js 16 + React 19 + TypeScript 独立应用；本地端口为 `3020`。
- 根路由是首发标准病人对话工作台：开放 r9 清单中 30 个 `published + approved` 病例，进入页面和完成一例后随机分诊，不显示病例目录、固定患者信息栏、诊断侧栏或手动选例/提交入口。玩家在同一输入框自由问诊并明确说出最终诊断，Patient Agent 的诊断意图提取通过服务端门禁后自动结算；结果以模态悬浮窗展示总分、六项分数和“再来一局”。工作台支持刷新恢复，自动评分重试键由服务端根据持久化失败状态限次派生且每个 HTTP 请求至多启动一次评分，创建请求在未知结果后跨刷新复用；旧 Phaser 世界保留在 `/world-preview`。
- 同源 Route Handler 只在服务端调用 `@ahamed/doctor-game-model@0.2.7`，并通过公开 DTO 向浏览器投影。匿名会话使用 HttpOnly SameSite=Strict cookie，请求具备同源校验、16 KiB 正文上限、限流和 no-store 响应头。
- 明确的最终诊断声明在服务端先转成结构化数据，原始声明不进入 Patient Provider；SQLite 崩溃恢复后提交的会话与评分轨迹仍只使用固定脱敏文本。构建、类型检查和测试前都会在跨进程锁内重建、原子替换并校验本地 model 物理副本，失败恢复只处理当前进程拥有的副本并保留无法恢复的备份，避免 `file:` 依赖残留旧代码或并发互删。
- Phaser 4.2.1 client-only 启动，React Strict Mode 下可安全创建和销毁实例。
- `BootScene -> WorldScene` 最小场景链路。
- 键盘和触摸方向控制、Arcade Physics、患者交互点。
- React/DOM 与 Phaser 之间的 typed event bridge。
- `@ahamed/doctor-game-share@1.0.0-rc.2` 患者身份 adapter、30 项公开视觉目录，以及 `sessionId + patientRoleId + npcId` 严格绑定；typed `clinic.start-shift` 命令可接收共享病例摘要，`WorldScene` 按 `patientRoleId` 选取并验证 sprite/tint 资源。
- 纯 TypeScript 移动规则和 Vitest 单元测试。
- Playwright 浏览器 smoke test。
- 带 `contentBuildId` 的静态资源 manifest。

`/world-preview` 场景使用程序生成的占位纹理，只用于验证运行时边界。Tiled 地图、正式像素素材、IndexedDB 存档和经营系统仍需按技术 PoC 顺序逐步实现，不阻塞纯对话首发。

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

`predev` 会先构建本地 `../share/` 依赖，因此全新 checkout 无需手工预构建共享包。访问 `http://localhost:3020`。

生产环境至少需要配置 `AHAMED_MODEL_ID`、`SAFETY_AUDIT_HMAC_KEY`、Provider 密钥和位于私有可写卷上的绝对 `AHAMED_WEB_MODEL_DATABASE_PATH`。`AHAMED_WEB_EXPIRED_SESSION_RETENTION_HOURS` 默认 168。生产还必须在会把 `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto` 覆盖为单一可信值的反向代理之后启用 `AHAMED_TRUST_PROXY_HEADERS=true`，并在平台层配置共享限流与成本预算；多值或缺失的转发来源会被拒绝。

常用验证：

```bash
npm run lint
npm run typecheck
npm test
npm run test:contract
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
