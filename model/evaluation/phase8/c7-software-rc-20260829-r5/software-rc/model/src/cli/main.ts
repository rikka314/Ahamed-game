import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { loadDialogueCandidateCasePackages } from "./case-loader.js";
import {
  CLI_USAGE_ZH,
  CliConfigurationError,
  parseCliConfig,
} from "./config.js";
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
    const io = new ReadlineCliIo();
    try {
      await runCli({ config, cases, io });
    } finally {
      io.close();
    }
  } catch (error) {
    const message =
      error instanceof CliConfigurationError || error instanceof Error
        ? error.message
        : "未知 CLI 启动错误。";
    process.stderr.write(`CLI 启动失败：${message}\n`);
    process.stderr.write(`${CLI_USAGE_ZH}\n`);
    process.exitCode = 1;
  }
}

await main();
