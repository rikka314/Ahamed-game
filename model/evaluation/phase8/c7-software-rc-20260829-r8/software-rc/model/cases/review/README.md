# Optional human review records

本目录用于保存可选的人工内容反馈。记录通过 `internalCaseId + caseVersion + contentHash` 关联，不复制病例全文，不保存真实患者信息。

人工反馈和旧版资格记录不再是 Phase 6 发布前置条件，也不会改变 `releaseValidation` 的批准结果。正式发布门只读取 `../ai-validation/` 中由两个独立 AI 角色生成、且与病例版本和内容 hash 精确绑定的交叉验证记录。若未来仍收集人工反馈，完整证号、证照图片和真实患者资料不得进入 Git。
