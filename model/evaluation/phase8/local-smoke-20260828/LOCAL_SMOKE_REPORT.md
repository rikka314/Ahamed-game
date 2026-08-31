# Phase 8 Software RC 本机解压预演报告

日期：2026-08-28 17:39（China Standard Time）

结论：**LOCAL RC PREFLIGHT READY WITH PROVIDER STABILITY WARNING**。

本次测试从冻结 ZIP 解压到全新的系统临时目录，并在该目录安装生产依赖；没有复用工作区 `node_modules`。本机结果用于服务器部署前预演，不替代 Phase 8-B 的目标服务器验收。

## 测试对象与环境

- RC ZIP：`ahamed-model-software-rc-20260828.zip`
- ZIP SHA-256：`6632228e553e36223c624b16d836b00d7ef55dd4cd270ce35b82505eee183b5e`
- ZIP 大小：697,057 bytes
- 系统：Microsoft Windows 11 专业版 10.0.26200
- Node.js：v24.18.0
- npm：11.17.0
- 测试时工作盘可用空间：229,107,187,712 bytes

## 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 全新解压与生产依赖安装 | PASS | `share` 与 `model` 均使用 `npm ci --omit=dev --ignore-scripts`；模型安装 9 个生产 package |
| runtime-release manifest | PASS | SHA-256 `7d993e78f26655b8a67efb881eb6a18a041da204850d0f9a5ac3c642f3a0acd0`；29/29 制品、1 个 Provider；远程交互默认关闭 |
| headless 医学闭环 | PASS | session → turn → test → diagnosis → evaluation 完成，最终分 80，事件序列完整 |
| SQLite/CLI/恢复专项回归 | PASS | 89/89；覆盖 migration、WAL/事务、重启恢复、TTL、幂等、lease/fencing、显式 ops recovery 与 CLI |
| 包内安全扫描 | PASS | 97 个文本文件、40 个公开证据文件；0 secret、0 hidden-field、0 database artifact；HMAC 配置与忽略规则完整 |
| 第三方 Provider 单例连通 smoke | WARNING | 本机配置完整且未输出凭据；两次受控 C01 流程均在 7-call workflow 后返回 `MODEL_UNAVAILABLE`，第二次前执行 15 秒冷却；未自动切换 Provider |

## 本次发现并修复的制品问题

初版 ZIP 在工作区中可验签，但离开源码仓库后缺少运行时文件。已把以下最小必要文件加入最终 RC，并通过新的全新解压环境复验：

- runtime-release manifest 直接绑定的评分策略、SQLite migration、医疗安全策略 3 个 TypeScript 源文件；
- headless/ops 需要的固定 fixture；
- CLI/单例 Provider smoke 需要的 C01 reference draft；
- 包内安全扫描验证 HMAC/数据库忽略规则所需的 `.gitignore`。

reference draft 与 fixture 只服务于本机和运维 smoke；玩家运行时仍只能加载 published manifest 中的病例。

## 剩余事项

- Provider 已有最终 RC 25/25 的既有远程通过证据，但本次本机单例 smoke 暴露了端点间歇性 unavailable；目标服务器必须重新验证独立 session、真实并发和限流策略。
- Phase 8-B 仍需在同一 ZIP 上验证 Linux/目标 OS 权限、SQLite 持久目录、WAL、备份恢复、secret 注入、服务器时钟、7 天 TTL、优雅停止/重启和四阶段崩溃恢复。
- 完成目标服务器 smoke 前，状态仍是 **Software RC ready；Formal MVP blocked by infrastructure**。
