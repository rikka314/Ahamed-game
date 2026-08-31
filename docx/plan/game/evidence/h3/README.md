# 任务卡 1：H3 诊所地图与 Tileset 对比证据

> 状态：`DRAFT`；`contentBuildId=dev`。本目录不代表静态审批、游戏内审批或 H3 冻结已通过。

## 交付结果

- 默认无查询参数时继续加载既有程序灰盒，不覆盖默认运行路径。
- `?h3Candidate=16`：16×16 tile，26×16 tile 坐标，416×256 世界，320×180 逻辑视口。
- `?h3Candidate=32`：32×32 tile，保持相同 26×16 tile 坐标，832×512 世界，640×360 逻辑视口。
- 两套地图都使用 `Ground`、`Decoration`、`Collision`、`AbovePlayer`、`Objects` 五层；视觉为 tile layer，碰撞与稳定锚点为 object layer。
- 运行包分别发布到 `game/public/game-assets/dev/h3-16/` 与 `game/public/game-assets/dev/h3-32/`，使用独立 manifest，并保留 `map.clinic.graybox-01` 与 `tileset.clinic.community-01`。
- 32px 是独立原生细节绘制，不是 16px PNG 的最近邻放大；生成器验证其 22.9% 像素不同于 16px 最近邻放大结果，自动测试同时验证两套坐标严格为 2:1。
- `dev` / `build` 只从现有 Tiled source 扁平化运行包，不会重写 `.tmj/.tsj` 人工源；仅显式运行 `npm run maps:source:h3` 才会再生成源地图。

## 来源与制作

- `clinic-direction-ai-draft.png` 是无人物、无文字、无品牌的 AI 方向参考，运行时不直接使用。
- 运行 tileset 为项目原创网格重绘，由项目脚本逐像素生成硬边 PNG，再用 LibreSprite 1.1-dev 编码为可编辑 `.aseprite` 源。当前环境未发现 Aseprite 可执行文件，因此没有虚构 Aseprite 工具记录。
- 未引入 CC0、CC BY 或其他外部素材。每个候选的生成提示词、工具链、人工清理说明与许可状态记录在相邻 provenance JSON 中。

## 对照指标

| 指标 | H3 16px | H3 32px |
|---|---:|---:|
| tileset PNG | 128×64 | 256×128 |
| tileset 文件大小 | 911 B | 1,535 B |
| 解码 RGBA 内存 | 32,768 B | 131,072 B |
| runtime map | 35,184 B | 35,199 B |
| 逻辑视口 | 320×180 | 640×360 |
| 世界尺寸 | 416×256 | 832×512 |
| margin / spacing / extrusion | 0 / 0 / 0 | 0 / 0 / 0 |

32px tileset 的解码像素内存为 16px 的 4 倍；地图 JSON 大小基本相同。详细机器可读数据（含 PNG SHA-256）见 `h3-artifact-metrics.json` 和 `h3-visual-metrics.json`。

## 视觉证据

- `clinic-h3-16-desktop.png`
- `clinic-h3-16-mobile-landscape.png`
- `clinic-h3-32-desktop.png`
- `clinic-h3-32-mobile-landscape.png`
- `clinic-h3-comparison-2x2.png`

四张截图均处于 `ready_to_call`、两名患者已排队的同一状态。移动端截图覆盖队列、入口、接诊区与锁定区；自动移动端模拟不能替代真实 Android 横屏验收。

## 技术验证

- Tiled 1.12.2 可重新导出两套 source map 与两套 runtime map。
- 发布脚本验证正交地图、未压缩数据、恰好五层、唯一稳定 ID、单张连续 PNG、候选尺寸、运行 tileset 扁平化和独立 manifest。
- Vitest 覆盖默认灰盒、两套 H3 解析、16/32 坐标比例、关键锚点、碰撞、前景层、路径、provenance 与非法像素密度。
- Playwright 覆盖默认灰盒、两个候选、移动端五个关键区域的几何可见性、前景层高于玩家的渲染合同、两套右侧设备碰撞、资源失败回退、错误密度部署回退与既有输入回归。

## 待负责人确认

- 静态审批：pending。
- 游戏内审批：pending。
- 真实 Android 横屏验收：pending。
- 最终 tile、逻辑视口、padding/extrusion 与 H3 冻结：pending。
- 若真实设备或 WebGL 采样出现接缝，记录为 H3 缺陷后再决定 extrusion，不在本轮静默改变规格。
