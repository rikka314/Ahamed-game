import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCasePackages } from "../cli/case-loader.js";
import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  AnthropicModelProvider,
  OfficialAnthropicMessagesTransport,
} from "../providers/anthropic-model-provider.js";
import { resolveAnthropicRuntimeConfig } from "../providers/anthropic-runtime-config.js";
import { runAnthropicC01LiveEval } from "./anthropic-live-eval.js";

const USAGE = `用法：npm run eval:live:anthropic -- --model <modelId> [--output <report.json>]

配置 ANTHROPIC_API_KEY。该命令只对 C01 reference draft 执行 Claude Messages
工程纵切，不代表医学审核、候选模型完整 benchmark、最终型号确认或发布验收。`;

function parseArguments(argv: readonly string[]): {
  modelId: string;
  outputPath?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== "--model" && key !== "--output") {
      throw new Error(`未知参数：${key ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key, value);
    index += 1;
  }
  const modelId = values.get("--model") ?? process.env["AHAMED_MODEL_ID"];
  if (modelId === undefined || modelId.trim().length === 0) {
    throw new Error("必须提供 --model <modelId>。");
  }
  const outputPath = values.get("--output");
  return {
    modelId: modelId.trim(),
    ...(outputPath === undefined ? {} : { outputPath: resolve(outputPath) }),
  };
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const runtime = resolveAnthropicRuntimeConfig(process.env);
    const modelRoot = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const [casePackage] = loadCasePackages([
      resolve(modelRoot, "cases/draft/c01-reference-draft.json"),
    ]);
    if (casePackage === undefined) throw new Error("C01 reference draft 不可用。");
    const promptVersion = process.env["AHAMED_PROMPT_VERSION"] ?? "v0.1.0";
    const provider = new AnthropicModelProvider({
      modelId: args.modelId,
      promptVersion,
      promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
      transport: new OfficialAnthropicMessagesTransport({
        apiKey: runtime.apiKey,
      }),
    });
    const report = await runAnthropicC01LiveEval({ casePackage, provider });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (args.outputPath !== undefined) {
      mkdirSync(dirname(args.outputPath), { recursive: true });
      writeFileSync(args.outputPath, serialized, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    process.stdout.write(serialized);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "未知 Claude live eval 错误。";
    process.stderr.write(`Claude live eval 启动失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
