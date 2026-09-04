import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { loadDialogueCandidateCasePackages } from "./case-loader.js";
import {
  CLI_USAGE_ZH,
  CliConfigurationError,
  parseCliConfig,
} from "./config.js";
import { createLocalDevOpenAIProvider } from "./local-dev-provider.js";
import { runCli, type CliIo } from "./runner.js";

class ReadlineCliIo implements CliIo {
  private readonly readline = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  private readonly lines = this.readline[Symbol.asyncIterator]();

  async readLine(prompt: string): Promise<string | null> {
    process.stdout.write(prompt);
    const next = await this.lines.next();
    return next.done ? null : next.value;
  }

  write(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  close(): void {
    this.readline.close();
  }
}

async function main(): Promise<void> {
  try {
    const config = parseCliConfig(process.argv.slice(2));
    if ("help" in config) {
      process.stdout.write(`${CLI_USAGE_ZH}\n`);
      return;
    }
    const modelRoot = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const cases = loadDialogueCandidateCasePackages(modelRoot);
    const provider = createLocalDevOpenAIProvider(
      config,
      process.env,
      modelRoot,
    );
    const io = new ReadlineCliIo();
    io.write("警告：当前为本机开发测试入口，不代表远程交互已通过发布门。\n");
    try {
      await runCli({ config, cases, io, provider });
    } finally {
      io.close();
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "未知本机开发 CLI 启动错误。";
    process.stderr.write(`本机开发 CLI 启动失败：${message}\n`);
    process.stderr.write(`${CLI_USAGE_ZH}\n`);
    process.exitCode = 1;
  }
}

await main();
