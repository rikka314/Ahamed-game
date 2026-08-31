# Phase 8-A Software RC 验收报告

日期：2026-08-28

结论：**Software RC ready；Formal MVP blocked by infrastructure**。Phase 8-A 已完成，Phase 8-B 因缺少已知目标服务器、部署目录/权限、secret 注入与备份恢复环境而未启动。

可复制 zip：`ahamed-model-software-rc-20260828.zip`，SHA-256 `6632228e553e36223c624b16d836b00d7ef55dd4cd270ce35b82505eee183b5e`，大小 697,057 bytes。

## 冻结身份与清单

- 批准 Provider：1 个第三方 OpenAI Responses-compatible Provider；endpoint 只保存 SHA-256，不保存 URL。
- 固定 configured/actual model：`gpt-5.6-sol`。
- Prompt：`v0.1.1`；structured-output schema：`phase8-v2`。
- share：明确保留 `v1-rc1`，未虚报 stable。
- runtime-release manifest：`7d993e78f26655b8a67efb881eb6a18a041da204850d0f9a5ac3c642f3a0acd0`，29 个制品，验证通过。

## 真实远程评测

候选前置：

- 5 病例 × 3 次 = 15/15 完成；operation success 100%。
- Controller fact-routing accuracy 100%。
- 总分平均 83，最低 80，最高 85。
- 60 条患者回复双角色独立 AI 审核 approved；严重事实/安全错误 0；自然且角色一致率 95%。
- candidate run-set SHA-256：`a9ffa509ce7d6f94938e1500364c82cf2937001d172012a3aa236fc59ae69dc4`。

最终 RC：

- 5 病例 × 5 次 = 25/25 完成；operation success 100%。
- Controller fact-routing accuracy 100%。
- 总分平均 82，最低 80。
- 100 条患者回复双角色独立 AI 审核 approved；严重事实/安全错误 0；自然且角色一致率 98%。
- RC run-set SHA-256：`f3885021b8a658f2a4bab92cd0b85aafd17703327c9561c6ec847280751dbf8d`。

## 工程验证

- `npm run typecheck`：通过。
- `npm test`：266/266 通过。
- `npm run test:coverage`：全部门通过；安全核心 98.84% line、97.31% branch、99.01% function。
- `npm run test:contract`：share 78/78、model 6/6 通过。
- `npm run headless`：完整 session → turn → test → diagnosis → evaluation 通过。
- `npm run cases:validate`：5/5 structurally ready、5/5 publishable。
- `npm run eval:phase7:offline`：`FULL_CANDIDATE_BENCHMARK_READY`，165/165 本地安全策略匹配，33 holdout 保持冻结。
- `npm run security:scan`：403 个文本文件、158 个公开证据文件，0 secret、0 hidden-field，HMAC 配置完整。

## 已修复的发布阻塞

- 初版 RC ZIP 未包含 runtime-release manifest 直接绑定的 3 个 TypeScript 源文件、runbook 入口依赖的 fixture/reference draft 及包内安全扫描所需的 `.gitignore`，导致离开工作区后无法独立验签、运行 headless 或完成 HMAC/数据库忽略规则检查；现已把这些最小必要文件纳入制品，并要求从全新解压目录复验。
- Patient Schema 与运行时 `newFactsClaimed=[]` 不一致；已用 Schema 与本地 gate 双重约束。
- `factsUsed` 未动态绑定本轮 allowlist；已使用端点兼容的 enum 子集并保持 fail-closed 解析。
- 旧 live-eval 问法不自然且缺少 Controller 路由准确率；已改为显式虚构上下文的自然中文，并新增 ≥95% 路由门。
- 大批量 AI 审核 sample ID 漂移；已把每批 ID 写入严格 Schema，并提供不覆盖既有会话证据的追加式审核恢复命令。
- 安全扫描跨行误报空 `.env.example`；已限制为单行赋值匹配。

## 本机解压预演

- 最终 ZIP SHA-256：`6632228e553e36223c624b16d836b00d7ef55dd4cd270ce35b82505eee183b5e`，697,057 bytes。
- 从全新 Windows 临时目录安装生产依赖后，runtime-release manifest 29/29、headless 闭环、89/89 SQLite/恢复/CLI 专项测试和包内安全扫描全部通过。
- 包内安全扫描覆盖 97 个文本文件和 40 个公开证据文件，0 secret、0 hidden-field、0 database artifact。
- 第三方 Provider C01 单例 smoke 两次均在 7-call workflow 后返回 `MODEL_UNAVAILABLE`，第二次前执行 15 秒冷却；没有发生 Provider failover。该结果记为目标服务器必须复验的稳定性风险，不覆盖既有最终 RC 25/25 远程通过证据。
- 详细证据见 `../local-smoke-20260828/LOCAL_SMOKE_REPORT.md`。本机预演不替代 Phase 8-B。

## 剩余风险

- 正式 MVP 的目标服务器验收未执行；这是当前唯一 release-state blocker。
- 历史废弃评测批次和本次本机单例 smoke 均记录了第三方端点间歇性 unavailable；最终 RC 发布评测使用 15 秒会话冷却后 25/25 通过。生产部署仍需在目标服务器验证独立 session、真实并发与限流配置。
- 当前制品未包含任何 secret；部署方必须安全注入稳定 HMAC Key 和 Provider Key。
- 游戏侧统一 adapter/端到端合并门未在模型层制品内完成，因此 share 仍为 `v1-rc1`。
- `ModelService` 兼容 façade 仍然偏大；当前行为已由恢复矩阵和 266 项回归测试锁定，后续应在不改变发布行为的前提下拆分 operation coordinator、recovery reconciler 与 safety journal/redaction。
