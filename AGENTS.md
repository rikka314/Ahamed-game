# AhaMed Doctor Game — Project Instructions

本文件补充上级 `D:\Learn\20_Projects\AGENTS.md`。上级规则继续有效；本文件只增加当前游戏项目的强制上下文装载流程。

## 常驻项目上下文

对 `D:\Learn\20_Projects\MedicalAI\apps\game\` 及其所有子目录内的任何工作，无论任务大小，在规划、分析、修改文件或运行项目命令前，必须使用项目本地 skill：

```text
.codex/skills/load-game-context/SKILL.md
```

执行该 skill 时，项目内容的读取顺序固定为：

1. 完整读取项目根 `AI_CONTEXT.md`；
2. 完整读取 `docx/baseknowledge/压缩上下文.md`；
3. 根据当前任务判断属于游戏层、模型层、共享层还是跨层工作；
4. 按 skill 的路由规则，只完整读取与任务直接相关的 baseknowledge 长文档；
5. 完成必要上下文装载后再开始当前任务。

默认不再全量读取 `docx/baseknowledge/` 中的三份长文档。单层任务只读取对应层全文；跨层任务先读取共享层全文，再读取受影响层全文；只有全局架构复核、三层重划、全量一致性/安全审计、真实文档冲突或用户明确要求时，才读取全部长文档。不要用历史会话记忆代替当前磁盘中的 `AI_CONTEXT.md` 和压缩上下文。

如果 `AI_CONTEXT.md`、`docx/baseknowledge/压缩上下文.md` 或当前任务命中的长文档缺失、无法读取或格式不受支持，应先说明具体缺口，再基于能够读取的内容继续安全工作。

## 分层边界

- `game/`：游戏层独立开发边界。
- `model/`：模型层独立开发边界。
- `share/`：双方唯一共享连接面。
- 游戏层和模型层不得直接依赖对方内部实现；跨层工作以 `share/` 契约和 `docx/baseknowledge/共享层基本内容.md` 为准。
