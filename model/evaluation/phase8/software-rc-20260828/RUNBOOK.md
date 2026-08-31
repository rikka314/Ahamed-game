# AhaMed Doctor Game Model Software RC Runbook

状态：Software RC（不是正式 MVP）。目标服务器信息尚未提供，因此 Phase 8-B 服务器验收未执行。

## 制品结构

- `model/`：已编译模型层、病例、提示词、公开 Phase 8 证据、runtime-release manifest，以及该 manifest 直接绑定的 3 个策略/迁移源文件。
- `share/`：保留的 `share v1-rc1` 编译产物、Schema 与版本文件。
- 制品不包含 `.env`、API Key、HMAC Key、数据库、WAL/SHM 或私有患者审核样本。
- `cases/fixtures/case-fixture-001.json` 与 `cases/draft/c01-reference-draft.json` 只供 headless、ops、CLI 和单例 Provider 连通 smoke 使用；玩家运行时仍只能加载 published manifest 中的病例。

## 环境要求

- Node.js `>=22.18`。
- 可写的 SQLite 持久目录。
- 至少 32 字符、跨重启稳定的 `SAFETY_AUDIT_HMAC_KEY`。
- 当前批准且唯一进入清单的第三方 OpenAI Responses-compatible Provider，以及固定模型 `gpt-5.6-sol`。

## 安装与启动

在 ZIP 解压目录执行：

```powershell
Set-Location .\share
npm ci --omit=dev --ignore-scripts
Set-Location ..\model
npm ci --omit=dev --ignore-scripts
Copy-Item .env.example .env
```

随后在 `model/.env` 设置实际运行值；不得提交该文件。至少设置：

- `AHAMED_MODEL_PROVIDER`
- `AHAMED_MODEL_ID=gpt-5.6-sol`
- `AHAMED_MODEL_DATABASE_PATH`
- `SAFETY_AUDIT_HMAC_KEY`
- `MODEL_BASE_URL` 与 `MODEL_API_KEY`

启动前验证冻结清单：

```powershell
node dist/src/release/phase8-verify-runner.js --manifest evaluation/phase8/runtime-release-20260828-r2/runtime-release-manifest.v1.json
node dist/src/release/phase8-security-scan-runner.js
```

本地非交互 smoke：

```powershell
node dist/src/headless/runner.js
```

受控 CLI：

```powershell
node dist/src/cli/main.js --user student_demo_001
```

该 CLI 使用包内 C01 reference draft 做本机/运维 smoke，不构成 published 病例或正式远程候选证据。

## 运维约束

- Provider 失败不得自动切换到另一 Provider。
- 远程交互默认开关保持关闭，只有显式受控入口可以启用。
- SQLite、WAL、备份与恢复目录不得放入 Web 可访问路径。
- 日志只能保留允许字段；不得记录病例隐藏真相、原始密钥、Base URL 或私有审核样本。
- 恢复操作使用显式 `inspect` / `recover` 流程，不能按 JSON 形状自动提交旧 buffer。

## Phase 8-B 待办

在已知目标服务器上使用同一制品验证启动/停止/重启、目录权限、WAL、磁盘、备份恢复、secret 注入、时钟与 7 天 TTL、四个崩溃阶段和 Provider 独立 session 连通。完成前只能称 Software RC。
