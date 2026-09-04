# ScoringPolicy v1

版本：`scoring-policy-v1`

六个整数分项按 `45/25/10/10/5/5` 加权，权重和 `evaluationVersion` 的唯一事实源是 `share/contracts/v1/evaluation.ts`。只在最终总分执行一次 `Math.round`。history、differential 和 testSelection 按规范各自在分项边界取整；所有集合按稳定 ID 去重。

- diagnosis：审核词表映射到 target concept 得 100，否则 0；模糊语义只记 `needs_review`。
- historyCoverage：已披露 must-ask / 全部 must-ask。
- differentialReasoning：排除主要诊断和重复 concept 后，命中 0/1/2 个分别为 0/50/100。
- testSelection：required coverage 减去每个 unnecessary 20 分；useful 不加不扣。
- efficiency：`100 - 10*excess - 10*repeat - 5*other`，clamp 到 0–100。
- communication：只接受 0、50、100 和当前 session/rubric 中存在的证据 ID。

communication 不可用时保留五个确定性分项，但 `communication=null`、`total=null`，禁止补默认分。测试和 headless 的沟通分必须由显式的 labeled fixture reviewer 提供，不得从“存在回合”推断。实现位于 `src/evaluation/scoring-policy-v1.ts`；30 个黄金向量位于 `tests/scoring-policy-v1.test.ts`。
