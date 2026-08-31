# 模型层规划索引

本目录保存 AhaMed Doctor Game 模型层的实施规划，不保存病例真相、生产 Prompt、API Key 或运行数据。

当前主计划：

- [模型层 MVP 实施计划](./模型层MVP实施计划.md)

计划状态：已根据项目负责人两轮确认形成实施基线，尚未授权修改业务代码。

运行边界：本计划中的 CLI 仅供受控服务器上的内部工程与医学评测，不向学生分发。病例真相、SQLite、Prompt、评分规则和 API Key 必须保留在可信服务端。

发布边界：基础设施尚未明确时只能交付 Software RC；同一制品通过目标服务器 smoke 后才可标记正式 MVP。

实施前应再次确认：

1. 项目负责人明确批准进入实现；
2. GPT 与 Claude 的候选模型 ID 已通过小规模 benchmark 后获得批准；
3. 临床安全与诊断质量两个独立 AI validator 的 ID、模型、提示版本、六项检查和内容 hash 绑定规则已经冻结；
4. 安装 OpenAI、Anthropic、SQLite 或 JSON Schema 相关依赖前，完成依赖审查。

批准主计划也表示确认其第 2.1 节五项补充决策：沟通评分失败不生成最终总分、双 AI 病例发布门、Software RC/正式 MVP 分界、现实健康输入 fail-closed，以及新增独立自伤危机退出分支。
