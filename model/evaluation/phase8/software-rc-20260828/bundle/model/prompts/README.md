# Prompt 版本目录

这里保存服务端 prompt 模板。当前 `v0.1.0` 只定义角色权限和结构化输出边界，供真实 provider 实现前评审；它们没有经过医学、安全或生产效果审核。

规则：

- 每个角色独立上下文、独立权限、独立版本。
- Patient 永远不能看到 answer key、rubric、隐藏事实或未申请检查。
- Controller 不生成患者答案。
- Evaluator 不计算游戏奖励。
- 修改已使用的 prompt 必须创建新版本，不能覆盖历史版本。
- prompt、模型参数和输出 Schema 版本必须进入审计事件。
