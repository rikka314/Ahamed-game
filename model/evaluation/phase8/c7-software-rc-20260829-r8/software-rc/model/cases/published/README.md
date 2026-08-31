# Published cases

只允许 `packageStatus: "published"`、`releaseValidation.decision: "approved"` 且带 `sha256:` 内容 hash 的冻结病例。发布记录必须包含临床安全与诊断质量两个独立 AI 验证角色，且六项检查全部通过。人工 `review` 可保持 `pending`，不参与发布判定。已发布文件不可原地修改或覆盖。

发布器会为同一 `publicCaseId + caseVersion` 创建 `.publish.lock`，锁内记录发布进程 PID。若进程异常退出留下锁，恢复人员必须先确认该 PID 已不存在，并确认同版本没有正在进行的发布，再只删除对应的单个锁文件后重试；PID 仍存活或状态无法确认时保持 fail-closed，不得自动破锁。

当前 C01–C05 共 5 个病例已发布，并由 `manifest.v1-rc1.json` 按 `publicCaseId + caseVersion + contentHash + releaseValidationMethod` 精确索引。不得把单纯结构校验、deterministic 回归或 Provider mock/live smoke 当作 AI 交叉验证批准。
