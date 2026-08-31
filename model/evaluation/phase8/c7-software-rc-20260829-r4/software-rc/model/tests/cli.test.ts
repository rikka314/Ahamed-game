import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadCasePackages } from "../src/cli/case-loader.js";
import {
  CliCommandError,
  parseCliCommand,
} from "../src/cli/command-parser.js";
import {
  CliConfigurationError,
  parseCliConfig,
  type CliConfig,
} from "../src/cli/config.js";
import {
  createCliProvider,
  runCli as runCliWithEnvironment,
  type CliIo,
  type RunCliOptions,
} from "../src/cli/runner.js";
import {
  createLocalDevOpenAIProvider,
  pinLocalDevActualModel,
} from "../src/cli/local-dev-provider.js";
import type {
  OpenAIResponsesTransport,
  OpenAITransportRequest,
} from "../src/providers/openai-model-provider.js";
import { ModelProviderRequestError } from "../src/providers/model-provider.js";

const TEST_SAFETY_AUDIT_HMAC_KEY =
  "phase7-cli-test-stable-hmac-key-000000000000";

function runCli(
  options: Omit<RunCliOptions, "environment"> & {
    environment?: NodeJS.ProcessEnv;
  },
) {
  return runCliWithEnvironment({
    ...options,
    environment: {
      ...options.environment,
      SAFETY_AUDIT_HMAC_KEY: TEST_SAFETY_AUDIT_HMAC_KEY,
    },
  });
}

class ScriptedCliIo implements CliIo {
  readonly output: string[] = [];
  readonly prompts: string[] = [];
  private index = 0;

  constructor(private readonly input: readonly string[]) {}

  async readLine(prompt: string): Promise<string | null> {
    this.prompts.push(prompt);
    const value = this.input[this.index];
    this.index += 1;
    return value ?? null;
  }

  write(line: string): void {
    this.output.push(line);
  }

  text(): string {
    return this.output.join("\n");
  }
}

function fixtureCases() {
  return loadCasePackages([
    resolve("cases/draft/c01-reference-draft.json"),
  ]);
}

function config(databasePath: string, userId = "student_demo_001"): CliConfig {
  return {
    userId,
    providerName: "deterministic",
    modelId: "deterministic-v1",
    databasePath,
  };
}

function requestIds(prefix: string): (kind: string) => string {
  let sequence = 0;
  return (kind) => `${prefix}.${kind}.${++sequence}`;
}

test("parses Chinese CLI workflow commands without implicit write actions", () => {
  assert.deepEqual(parseCliCommand("症状什么时候开始？"), {
    kind: "ask",
    text: "症状什么时候开始？",
  });
  assert.deepEqual(parseCliCommand("/test test.vital_signs"), {
    kind: "test",
    testId: "test.vital_signs",
  });
  assert.deepEqual(parseCliCommand("/differentials 流行性感冒；急性咽炎"), {
    kind: "differentials",
    differentials: ["流行性感冒", "急性咽炎"],
  });
  assert.throws(
    () => parseCliCommand("/status extra"),
    CliCommandError,
  );
  assert.throws(() => parseCliCommand("/unknown"), CliCommandError);
});

test("CLI fails fast when the stable safety-audit HMAC key is missing", async () => {
  const io = new ScriptedCliIo([]);
  await assert.rejects(
    runCliWithEnvironment({
      config: config(resolve("var/missing-safety-key.sqlite")),
      cases: fixtureCases(),
      io,
      environment: {},
    }),
    (error: unknown) =>
      error instanceof CliConfigurationError &&
      /SAFETY_AUDIT_HMAC_KEY/u.test(error.message),
  );
});

test("parses user, provider, model, and SQLite configuration", () => {
  const parsed = parseCliConfig(
    [
      "--user",
      "student_demo_001",
      "--provider",
      "deterministic",
      "--model",
      "deterministic-v1",
      "--database",
      "./var/test-cli.sqlite",
    ],
    {},
  );
  assert.ok(!("help" in parsed));
  assert.equal(parsed.userId, "student_demo_001");
  assert.equal(parsed.providerName, "deterministic");
  assert.equal(parsed.modelId, "deterministic-v1");
  assert.equal(parsed.databasePath, resolve("./var/test-cli.sqlite"));
  const npmForwarded = parseCliConfig(
    [
      "student_demo_001",
      "deterministic",
      "deterministic-v1",
      "./var/npm-forwarded.sqlite",
    ],
    {
      npm_lifecycle_event: "cli",
      npm_config_user: "student_demo_001",
      npm_config_provider: "deterministic",
      npm_config_model: "deterministic-v1",
      npm_config_database: "./var/npm-forwarded.sqlite",
    },
  );
  assert.ok(!("help" in npmForwarded));
  assert.equal(npmForwarded.userId, "student_demo_001");
  assert.equal(
    npmForwarded.databasePath,
    resolve("./var/npm-forwarded.sqlite"),
  );
  assert.throws(() => parseCliConfig([], {}), CliConfigurationError);
  assert.deepEqual(parseCliConfig(["--help"], {}), { help: true });
});

test("deterministic C01 completes the full Chinese CLI flow through share v1 mappings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-cli-flow-"));
  try {
    const io = new ScriptedCliIo([
      "/help",
      "/unknown",
      "/cases",
      "/start case_c01_reference",
      "你好",
      "我跟你说你好，你都不回我，一点礼貌都没有",
      "你平时忙吗？",
      "有什么症状呀",
      "症状什么时候开始的？",
      "量一下体温",
      "/tests",
      "/test test.vital_signs",
      "/differentials 流行性感冒;急性咽炎",
      "/diagnose 急性病毒性上呼吸道感染",
      "/result",
      "/exit",
    ]);
    const result = await runCli({
      config: config(join(directory, "model.sqlite")),
      cases: fixtureCases(),
      io,
      requestId: requestIds("flow"),
    });

    assert.equal(result.exitReason, "command");
    assert.ok(result.currentSessionId?.startsWith("session_"));
    const text = io.text();
    assert.match(text, /公开病例入口/u);
    assert.match(text, /本工具只用于虚构病例/u);
    assert.match(text, /错误 \[INVALID_REQUEST\]：未知命令/u);
    assert.match(text, /患者：你好，医生。/u);
    assert.match(text, /患者：不好意思，医生，刚才没及时回应您。你好。/u);
    assert.match(text, /患者：我主要是鼻塞、流涕伴咽部不适2天。/u);
    assert.match(text, /大约两天前开始的。/u);
    assert.match(text, /检查 test\.vital_signs：体温37\.3℃/u);
    const chatTestReplyIndex = text.indexOf("患者：好的，我配合做生命体征。");
    const chatTestReportIndex = text.indexOf("检查 test.vital_signs：体温37.3℃");
    assert.ok(chatTestReplyIndex >= 0);
    assert.ok(chatTestReportIndex > chatTestReplyIndex);
    assert.match(text, /诊断判断：正确/u);
    assert.equal(text.match(/总分：\d+\/100/gu)?.length, 2);
    const resultIndex = text.indexOf("诊断判断：正确");
    assert.ok(resultIndex > 0);
    const beforeResult = text.slice(0, resultIndex);
    assert.doesNotMatch(beforeResult, /普通感冒|急性病毒性上呼吸道感染/u);
    assert.doesNotMatch(
      text,
      /internal_c01|answerKey|rubric|fact\.teaching_note|仅供服务端评分/u,
    );
    assert.ok(io.prompts.every((prompt) => prompt === "ahamed> "));

    const restoredIo = new ScriptedCliIo([
      `/resume ${result.currentSessionId}`,
      "/result",
      "/exit",
    ]);
    const restored = await runCli({
      config: config(join(directory, "model.sqlite")),
      cases: fixtureCases(),
      io: restoredIo,
      requestId: requestIds("flow-restored"),
    });
    assert.equal(restored.currentSessionId, result.currentSessionId);
    assert.match(restoredIo.text(), /状态：completed/u);
    assert.match(restoredIo.text(), /总分：\d+\/100/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI resumes the same SQLite projection only for the owning simulated user", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-cli-resume-"));
  const databasePath = join(directory, "model.sqlite");
  try {
    const firstIo = new ScriptedCliIo([
      "/start case_c01_reference",
      "什么时候开始？",
      "/exit",
    ]);
    const first = await runCli({
      config: config(databasePath),
      cases: fixtureCases(),
      io: firstIo,
      requestId: requestIds("first"),
    });
    assert.ok(first.currentSessionId);

    const resumedIo = new ScriptedCliIo([
      `/resume ${first.currentSessionId}`,
      "/status",
      "/exit",
    ]);
    const resumed = await runCli({
      config: config(databasePath),
      cases: fixtureCases(),
      io: resumedIo,
      requestId: requestIds("resumed"),
    });
    assert.equal(resumed.currentSessionId, first.currentSessionId);
    assert.match(resumedIo.text(), /会话已恢复/u);
    assert.match(resumedIo.text(), /问诊回合：1；病例建议回合：8/u);

    const otherUserIo = new ScriptedCliIo([
      `/resume ${first.currentSessionId}`,
      "/exit",
    ]);
    const otherUser = await runCli({
      config: config(databasePath, "student_demo_002"),
      cases: fixtureCases(),
      io: otherUserIo,
      requestId: requestIds("other"),
    });
    assert.equal(otherUser.currentSessionId, undefined);
    assert.match(otherUserIo.text(), /错误 \[SESSION_NOT_FOUND\]/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI cancellation is persisted and restored as a terminal projection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-cli-cancel-"));
  const databasePath = join(directory, "model.sqlite");
  try {
    const firstIo = new ScriptedCliIo([
      "/start case_c01_reference",
      "/cancel",
      "/exit",
    ]);
    const first = await runCli({
      config: config(databasePath),
      cases: fixtureCases(),
      io: firstIo,
      requestId: requestIds("cancel"),
    });
    assert.ok(first.currentSessionId);
    assert.match(firstIo.text(), /已于 .* 取消/u);

    const secondIo = new ScriptedCliIo([
      `/resume ${first.currentSessionId}`,
      "/status",
      "/exit",
    ]);
    await runCli({
      config: config(databasePath),
      cases: fixtureCases(),
      io: secondIo,
      requestId: requestIds("cancel-resume"),
    });
    assert.match(secondIo.text(), /状态：cancelled/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI blocks a twenty-first question before creating another provider operation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-cli-limit-"));
  try {
    const io = new ScriptedCliIo([
      "/start case_c01_reference",
      ...Array.from({ length: 21 }, () => "什么时候开始？"),
      "/status",
      "/exit",
    ]);
    await runCli({
      config: config(join(directory, "model.sqlite")),
      cases: fixtureCases(),
      io,
      requestId: requestIds("limit"),
    });
    assert.equal(io.text().match(/患者：大约两天前开始的。/gu)?.length, 20);
    assert.match(io.text(), /错误 \[TURN_LIMIT_REACHED\]/u);
    assert.match(io.text(), /问诊回合：20；/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release CLI keeps remote closed and local-dev requires explicit third-party opt-in", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-cli-provider-"));
  try {
    const openAIConfig = {
      userId: "student_demo_001",
      providerName: "openai" as const,
      modelId: "gpt-5.6-sol",
      databasePath: join(directory, "model.sqlite"),
    };
    assert.throws(
      () => createCliProvider(openAIConfig, { OPENAI_API_KEY: "test-only-key" }),
      /发布清单|cli:local-dev/u,
    );
    assert.throws(
      () => createLocalDevOpenAIProvider(openAIConfig, {
        OPENAI_API_KEY: "test-only-key",
      }),
      /AHAMED_CLI_LOCAL_DEV_REMOTE/u,
    );
    assert.throws(
      () => createLocalDevOpenAIProvider(openAIConfig, {
        AHAMED_CLI_LOCAL_DEV_REMOTE: "1",
        OPENAI_API_KEY: "test-only-key",
      }),
      /第三方/u,
    );
    const driftingTransport: OpenAIResponsesTransport = {
      protocol: "openai-responses",
      providerName: "openai-compatible.test",
      endpointSha256: "a".repeat(64),
      async create() {
        return {
          status: "completed",
          outputText: "{}",
          responseId: "resp_model_drift",
          requestId: "req_model_drift",
          modelId: "unexpected-model",
        };
      },
    };
    await assert.rejects(
      pinLocalDevActualModel(driftingTransport, "gpt-5.6-sol").create(
        {} as OpenAITransportRequest,
      ),
      (error: unknown) =>
        error instanceof ModelProviderRequestError &&
        error.code === "OPENAI_MODEL_ID_MISMATCH" &&
        !error.retryable,
    );
    assert.throws(
      () => createCliProvider({
        userId: "student_demo_001",
        providerName: "anthropic",
        modelId: "configured-later",
        databasePath: join(directory, "model.sqlite"),
      }, {}),
      /Phase 5/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
