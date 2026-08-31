# Prompt 版本目录

这里保存服务端 prompt 模板。`v0.2.0` 是 C2–C7 单一 Patient Agent 当前批准版本；`v0.1.x` 与 `controller/v0.2.0.md` 只读保留为历史兼容记录。C7 真实基准绑定 `v0.2.0+set.4cd38f5801b7b4a4`，覆盖 5 病例、3 人格、60 轮及双角色回复审计；发布门会校验 Patient prompt SHA-256，任何模板漂移都必须重新验收。

规则：

- Patient Agent 与 Evaluator 使用独立上下文、权限和版本；在线问诊不调用 Controller。
- Patient 永远不能看到 answer key、rubric、隐藏事实或未申请检查。
- 历史 Controller 不生成患者答案，也不得重新接入在线逐轮路由。
- Evaluator 不计算游戏奖励。
- 修改已使用的 prompt 必须创建新版本，不能覆盖历史版本。
- prompt、模型参数和输出 Schema 版本必须进入审计事件。
