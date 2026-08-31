import { resolve } from "node:path";

import { DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY } from "../providers/deterministic-model-provider.js";

export type CliProviderName = "deterministic" | "openai" | "anthropic";

export interface CliConfig {
  userId: string;
  providerName: CliProviderName;
  modelId: string;
  databasePath: string;
}

export class CliConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliConfigurationError";
  }
}

export const CLI_USAGE_ZH = `用法：npm run cli -- --user <模拟用户ID> [选项]

选项：
  --provider <deterministic|openai|anthropic>  默认 CLI 仅启用 deterministic；远程本机测试使用 cli:local-dev
  --model <modelId>                           模型标识；deterministic 默认为 deterministic-v1
  --database <path>                           SQLite 文件，默认 ./var/model-cli.sqlite
  --help                                      显示本帮助

这是内部工程与医学评测工具，仅处理虚构病例，不用于真实患者诊断、治疗或处方。`;

interface ParsedArguments {
  help: boolean;
  values: Map<string, string>;
}

const npmForwardedKeys = ["user", "provider", "model", "database"] as const;

function normalizeNpmForwardedArguments(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): string[] {
  const forwardedValues = new Set(
    npmForwardedKeys
      .map((key) => environment[`npm_config_${key}`])
      .filter((value): value is string => value !== undefined),
  );
  if (![...forwardedValues].some((value) => argv.includes(value))) {
    return [...argv];
  }
  return argv.filter(
    (argument) => argument.startsWith("--") || !forwardedValues.has(argument),
  );
}

function normalizeCanonicalPositionalArguments(
  argv: readonly string[],
): string[] {
  if (argv.length === 0 || argv.some((argument) => argument.startsWith("-"))) {
    return [...argv];
  }
  if (argv.length > npmForwardedKeys.length) return [...argv];
  return argv.flatMap((value, index) => [
    `--${npmForwardedKeys[index]}`,
    value,
  ]);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (
      argument !== "--user" &&
      argument !== "--provider" &&
      argument !== "--model" &&
      argument !== "--database"
    ) {
      throw new CliConfigurationError(`未知参数：${argument ?? ""}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliConfigurationError(`参数 ${argument} 缺少值。`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  return { help, values };
}

function requireSafeValue(value: string, name: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    /[\r\n\0]/u.test(normalized)
  ) {
    throw new CliConfigurationError(`${name} 必须是 1–256 个安全字符。`);
  }
  return normalized;
}

export function parseCliConfig(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): CliConfig | { help: true } {
  const parsed = parseArguments(
    normalizeCanonicalPositionalArguments(
      normalizeNpmForwardedArguments(argv, environment),
    ),
  );
  if (parsed.help) return { help: true };

  const npmForwarded = npmForwardedKeys.some((key) => {
    const value = environment[`npm_config_${key}`];
    return value !== undefined && argv.includes(value);
  });
  const rawUserId =
    parsed.values.get("user") ??
    environment["AHAMED_CLI_USER_ID"] ??
    (npmForwarded ? environment["npm_config_user"] : undefined);
  if (rawUserId === undefined) {
    throw new CliConfigurationError("必须提供 --user <模拟用户ID>。");
  }
  const userId = requireSafeValue(rawUserId, "userId");
  const rawProvider =
    parsed.values.get("provider") ??
    environment["AHAMED_MODEL_PROVIDER"] ??
    (npmForwarded ? environment["npm_config_provider"] : undefined) ??
    DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.providerName;
  if (
    rawProvider !== "deterministic" &&
    rawProvider !== "openai" &&
    rawProvider !== "anthropic"
  ) {
    throw new CliConfigurationError(`不支持的 provider：${rawProvider}`);
  }
  const providerName = rawProvider;
  const defaultModelId =
    providerName === "deterministic"
      ? DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.modelId
      : undefined;
  const rawModelId =
    parsed.values.get("model") ??
    environment["AHAMED_MODEL_ID"] ??
    (npmForwarded ? environment["npm_config_model"] : undefined) ??
    defaultModelId;
  if (rawModelId === undefined) {
    throw new CliConfigurationError("该 provider 必须显式配置 --model。");
  }
  const modelId = requireSafeValue(rawModelId, "modelId");
  const databasePath = resolve(
    parsed.values.get("database") ??
      environment["AHAMED_MODEL_DATABASE_PATH"] ??
      (npmForwarded ? environment["npm_config_database"] : undefined) ??
      "var/model-cli.sqlite",
  );
  return { userId, providerName, modelId, databasePath };
}
