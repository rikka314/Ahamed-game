import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCasePackages } from "../cli/case-loader.js";
import { FilePromptRegistry } from "../prompts/prompt-registry.js";
import {
  OpenAICompatibleResponsesTransport,
  OfficialOpenAIResponsesTransport,
  OpenAIModelProvider,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import { runOpenAIC01LiveEval } from "./openai-live-eval.js";

const USAGE = `用法：npm run eval:live -- --model <modelId> [--output <report.json>]

官方 OpenAI：配置 OPENAI_API_KEY；第三方 OpenAI-compatible API：同时配置
MODEL_BASE_URL 与 MODEL_API_KEY。可在 model/.env 中填写。该命令只对 C01 reference
draft 执行工程纵切，不代表双 AI 病例发布验证、候选模型完整 benchmark 或发布验收。`;

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
    const runtime = resolveOpenAIRuntimeConfig(process.env);
    const modelRoot = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const [casePackage] = loadCasePackages([
      resolve(modelRoot, "cases/draft/c01-reference-draft.json"),
    ]);
    if (casePackage === undefined) throw new Error("C01 reference draft 不可用。");
    const promptVersion = process.env["AHAMED_PROMPT_VERSION"] ?? "v0.1.0";
    const transport = runtime.isOfficial
      ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
      : new OpenAICompatibleResponsesTransport({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseURL,
        });
    const provider = new OpenAIModelProvider({
      modelId: args.modelId,
      promptVersion,
      promptRegistry: new FilePromptRegistry(resolve(modelRoot, "prompts")),
      transport,
    });
    const report = await runOpenAIC01LiveEval({ casePackage, provider });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (args.outputPath !== undefined) {
      mkdirSync(dirname(args.outputPath), { recursive: true });
      writeFileSync(args.outputPath, serialized, { encoding: "utf8", flag: "wx" });
    }
    process.stdout.write(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 live eval 错误。";
    process.stderr.write(`模型 live eval 启动失败：${message}\n${USAGE}\n`);
    process.exitCode = 1;
  }
}

await main();
