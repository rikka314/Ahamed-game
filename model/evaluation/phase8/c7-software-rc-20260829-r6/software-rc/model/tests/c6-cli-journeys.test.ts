import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadCasePackages } from "../src/cli/case-loader.js";
import {
  runCli,
  type CliIo,
} from "../src/cli/runner.js";
import {
  DeterministicModelProvider,
} from "../src/providers/deterministic-model-provider.js";
import {
  ModelProviderRequestError,
  type PatientInput,
} from "../src/providers/model-provider.js";

const SAFETY_AUDIT_HMAC_KEY =
  "c6-cli-journey-stable-hmac-key-000000000000";

const BASELINE_TURNS = [
  "你好",
  "请问有什么症状么",
  "现在还这样么",
  "今天天气不错",
  "你平时喜欢做什么",
  "我们先聊会儿别的吧",
  "最近忙不忙",
  "现在还是有这样的症状么",
  "量一下体温",
  "你的CT结果怎么样",
  "好，那去做吧",
  "CT现在是什么结果",
] as const;

const JOURNEYS = [
  {
    casePath: "cases/draft/c01-common-cold-v1.json",
    caseId: "case_c01_respiratory_001",
    personaReminder: "不好意思，医生",
  },
  {
    casePath: "cases/draft/c02-influenza-v1.json",
    caseId: "case_c02_respiratory_002",
    personaReminder: "医生，我有点担心",
  },
  {
    casePath: "cases/draft/c03-acute-pharyngitis-v1.json",
    caseId: "case_c03_respiratory_003",
    personaReminder: "医生，还是继续问我的病情吧",
  },
] as const;

class ScriptedCliIo implements CliIo {
  readonly output: string[] = [];
  private index = 0;

  constructor(private readonly input: readonly string[]) {}

  async readLine(): Promise<string | null> {
    const value = this.input[this.index];
    this.index += 1;
    return value ?? null;
  }

  write(line: string): void {
    this.output.push(line);
  }
}

function requestIds(prefix: string): (kind: string) => string {
  let sequence = 0;
  return (kind) => `${prefix}.${kind}.${++sequence}`;
}

for (const journey of JOURNEYS) {
  test(`C6 ${journey.caseId} completes a 12-turn persona and test-state CLI journey`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "ahamed-c6-cli-"));
    try {
      const cases = loadCasePackages([resolve(journey.casePath)]);
      const io = new ScriptedCliIo([
        `/start ${journey.caseId}`,
        ...BASELINE_TURNS,
        "/status",
        "/exit",
      ]);
      await runCli({
        config: {
          userId: `c6_${journey.caseId}`,
          providerName: "deterministic",
          modelId: "deterministic-v1",
          databasePath: join(directory, "model.sqlite"),
        },
        cases,
        io,
        requestId: requestIds(journey.caseId),
        environment: { SAFETY_AUDIT_HMAC_KEY },
      });

      const patientReplies = io.output
        .filter(
          (line) =>
            line.startsWith("患者：") &&
            line !== `患者：${cases[0]!.playerVisible.patientDisplayName}`,
        )
        .map((line) => line.slice("患者：".length));
      const transcript = io.output.join("\n");

      assert.equal(patientReplies.length, BASELINE_TURNS.length, transcript);
      assert.notEqual(patientReplies[1], "你好，医生。");
      assert.equal(patientReplies[2], patientReplies[1]);
      assert.match(transcript, new RegExp(journey.personaReminder, "u"));
      assert.match(transcript, /检查 test\.vital_signs：体温/u);
      assert.match(patientReplies[9] ?? "", /胸部CT还没有做/u);
      assert.match(patientReplies[10] ?? "", /现在去做胸部CT/u);
      assert.match(transcript, /检查 test\.chest_ct：/u);
      assert.equal(patientReplies[11], transcript.match(/检查 test\.chest_ct：([^\n]+)/u)?.[1]);
      assert.match(transcript, /状态：active/u);
      assert.doesNotMatch(transcript, /普通感冒|流行性感冒|急性咽炎/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("C6 Provider failure shows MODEL_UNAVAILABLE without a fake patient turn or state mutation", async () => {
  class FailingPatientProvider extends DeterministicModelProvider {
    override async generatePatientReply(_input: PatientInput): Promise<never> {
      throw new ModelProviderRequestError(
        "C6_PROVIDER_FAILURE",
        "C6 forced provider failure",
        { retryable: true },
      );
    }
  }

  const directory = mkdtempSync(join(tmpdir(), "ahamed-c6-failure-"));
  try {
    const io = new ScriptedCliIo([
      "/start case_c01_respiratory_001",
      "量一下体温",
      "/status",
      "/exit",
    ]);
    await runCli({
      config: {
        userId: "c6_failure_user",
        providerName: "deterministic",
        modelId: "deterministic-v1",
        databasePath: join(directory, "model.sqlite"),
      },
      cases: loadCasePackages([
        resolve("cases/draft/c01-common-cold-v1.json"),
      ]),
      io,
      provider: new FailingPatientProvider(),
      requestId: requestIds("failure"),
      environment: { SAFETY_AUDIT_HMAC_KEY },
    });

    const transcript = io.output.join("\n");
    assert.match(transcript, /错误 \[MODEL_UNAVAILABLE\]/u);
    assert.equal(
      io.output.filter(
        (line) =>
          line.startsWith("患者：") && line !== "患者：林同学",
      ).length,
      0,
    );
    assert.doesNotMatch(transcript, /检查 test\.vital_signs：/u);
    assert.match(transcript, /问诊回合：0；/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
