# 病例目录

病例包是模型层的服务端事实源，不得复制到 `game/`、`public/`、浏览器存档或客户端 bundle。

当前仅有 `fixtures/`：其中数据完全合成，只用于测试 headless 闭环、三态事实、检查读取、评分和泄露保护。它不是生产病例，也不需要医学解释。

后续病例生命周期应逐步增加：

```text
draft → validated → medically_reviewed → published → withdrawn
```

进入 `published` 前至少需要记录来源、病例版本、审核人、审核时间、答案键、rubric、许可证/授权和变更记录。已发布版本不得原地覆盖。
