import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  CreateSessionResponseV1,
  EvaluationResultV1,
} from "@ahamed/doctor-game-share";

import {
  toCancelSessionResponseV1,
  toCreateSessionResponseV1,
  toEvaluationResultV1,
  toSharedErrorV1,
  toTestResultV1,
  toTurnCompletedV1,
} from "../adapters/share-v1-adapter.js";
import { createSqliteModelService } from "../application/create-sqlite-model-service.js";
import type { CasePackage } from "../domain/case-package.js";
import type { CommunicationAssessment } from "../evaluation/scoring-policy-v1.js";
import type {
  CommunicationReviewInput,
  CommunicationReviewProvider,
} from "../providers/communication-review-provider.js";
import {
  DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY,
  DeterministicModelProvider,
} from "../providers/deterministic-model-provider.js";
import type { ModelProviderIdentity } from "../providers/model-provider.js";
import type { ModelProvider } from "../providers/model-provider.js";
import {
  CliCommandError,
  parseCliCommand,
  type CliCommand,
} from "./command-parser.js";
import {
  CliConfigurationError,
  type CliConfig,
} from "./config.js";

export interface CliIo {
  readLine(prompt: string): Promise<string | null>;
  write(line: string): void;
}

export interface CliRunResult {
  exitReason: "command" | "eof";
  currentSessionId?: string;
}

export interface RunCliOptions {
  config: CliConfig;
  cases: CasePackage[];
  io: CliIo;
  requestId?: (kind: string) => string;
  provider?: ModelProvider;
  environment?: NodeJS.ProcessEnv;
}

const CLI_HELP_ZH = `命令：
  /cases                         列出公开病例入口
  /start <caseId>                创建会话
  /resume <sessionId>            恢复当前模拟用户的会话
  /status                        查看阶段、回合和已完成检查
  直接输入中文                   询问虚构患者
  /tests                         列出公共检查目录
  /test <testId>                 申请检查
  /differentials <诊断1;诊断2>   设置鉴别诊断
  /diagnose <主要诊断>           提交最终诊断并评分
  /result                        查看已完成结果
  /cancel                        取消当前会话
  /help                          显示帮助与边界
  /exit                          退出但保留会话

边界：本工具只用于虚构病例的内部工程与医学评测，不提供真实个人诊断、治疗、处方或急诊分流。`;

const MAX_CLI_TURNS = 20;

class Phase3FixtureCommunicationReviewer
  implements CommunicationReviewProvider
{
  readonly identity: ModelProviderIdentity = Object.freeze({
    providerName: "phase3-fixture-communication-review",
    modelId: "phase3-fixture-v1",
    promptVersion: "phase3-fixture-label-v1",
  });

  async review(
    input: CommunicationReviewInput,
  ): Promise<CommunicationAssessment> {
    const turnId = input.turnIds[0];
    const rubricCriterionId = input.rubricCriterionIds[0];
    if (turnId === undefined || rubricCriterionId === undefined) {
      return {
        status: "unavailable",
        failureCode: "PHASE3_FIXTURE_REQUIRES_ONE_TURN",
      };
    }
    return {
      status: "available",
      score: 50,
      supportingTurnIds: [turnId],
      rubricCriterionIds: [rubricCriterionId],
    };
  }
}

export function createCliProvider(
  config: CliConfig,
  environment: NodeJS.ProcessEnv = process.env,
): ModelProvider {
  if (config.providerName === "anthropic") {
    throw new CliConfigurationError(
      "anthropic adapter 尚未实现；请在 Phase 5 完成后使用。",
    );
  }
  if (config.providerName === "openai") {
    throw new CliConfigurationError(
      "Phase 8 发布清单仍关闭远程交互；本机开发测试请使用 cli:local-dev。",
    );
  }
  if (config.modelId !== DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.modelId) {
    throw new CliConfigurationError(
      `deterministic provider 仅支持模型 ${DETERMINISTIC_MODEL_PROVIDER_BASE_IDENTITY.modelId}。`,
    );
  }
  return new DeterministicModelProvider(
    new Phase3FixtureCommunicationReviewer(),
  );
}

function writeSession(
  io: CliIo,
  response: CreateSessionResponseV1,
): void {
  io.write(`会话：${response.session.sessionId}`);
  io.write(`患者：${response.session.patientDisplay.displayName}`);
  io.write(`主诉：${response.session.chiefComplaint}`);
  io.write(`状态：${response.projection.sessionPhase}`);
  io.write(
    `问诊回合：${response.projection.turnCount}；病例建议回合：${response.projection.turnLimit ?? "未设置"}；CLI 最大回合：${MAX_CLI_TURNS}`,
  );
  const completed = response.projection.completedTests.map(
    ({ testId }) => testId,
  );
  io.write(`已完成检查：${completed.length === 0 ? "无" : completed.join("、")}`);
}

function patientNpcId(caseId: string): string {
  const readable = `npc.${caseId}`;
  if (readable.length <= 128) return readable;
  return `npc.${createHash("sha256").update(caseId).digest("hex")}`;
}

function writeEvaluation(io: CliIo, result: EvaluationResultV1): void {
  io.write(`诊断判断：${result.diagnosis.correct ? "正确" : "未命中"}`);
  io.write(`总分：${result.scores.total}/100`);
  io.write(
    `分项：诊断 ${result.scores.diagnosis}；病史 ${result.scores.historyCoverage}；鉴别 ${result.scores.differentialReasoning}；检查 ${result.scores.testSelection}；效率 ${result.scores.efficiency}；沟通 ${result.scores.communication}`,
  );
  io.write(`复盘：${result.summary}`);
}

function requireCurrentSession(
  current: CreateSessionResponseV1 | undefined,
): CreateSessionResponseV1 {
  if (current === undefined) {
    throw new CliCommandError("请先使用 /start 或 /resume 选择会话。");
  }
  return current;
}

export async function runCli(options: RunCliOptions): Promise<CliRunResult> {
  if (options.cases.length === 0) {
    throw new CliConfigurationError("CLI 至少需要一个病例包。");
  }
  const environment = options.environment ?? process.env;
  const safetyAuditHmacKey =
    environment["SAFETY_AUDIT_HMAC_KEY"]?.trim();
  if (safetyAuditHmacKey === undefined || safetyAuditHmacKey.length === 0) {
    throw new CliConfigurationError(
      "必须通过 SAFETY_AUDIT_HMAC_KEY 配置稳定的安全审计 HMAC 密钥。",
    );
  }
  mkdirSync(dirname(options.config.databasePath), { recursive: true });
  const provider = options.provider ??
    createCliProvider(options.config, environment);
  const service = createSqliteModelService({
    databasePath: options.config.databasePath,
    cases: options.cases,
    provider,
    safetyAuditHmacKey,
  });
  const nextRequestId =
    options.requestId ?? ((kind: string) => `cli.${kind}.${randomUUID()}`);
  const publicCases = options.cases.map((casePackage) => ({
    caseId: casePackage.publicCaseId,
    caseVersion: casePackage.caseVersion,
    displayName: casePackage.playerVisible.patientDisplayName,
    chiefComplaint: casePackage.playerVisible.chiefComplaint,
  }));
  const publicTestIds = [
    ...new Set(
      options.cases.flatMap((casePackage) =>
        Object.keys(casePackage.medicalTests),
      ),
    ),
  ].sort();
  let current: CreateSessionResponseV1 | undefined;
  let differentials: string[] = [];

  options.io.write("AhaMed Doctor Game 模型层 CLI（C6）");
  options.io.write(
    `用户：${options.config.userId}；Provider：${options.config.providerName}；Model：${options.config.modelId}`,
  );
  options.io.write("输入 /help 查看命令。仅限虚构病例内部评测。");

  try {
    while (true) {
      const line = await options.io.readLine("ahamed> ");
      if (line === null) {
        return {
          exitReason: "eof",
          ...(current === undefined
            ? {}
            : { currentSessionId: current.session.sessionId }),
        };
      }
      let command: CliCommand | undefined;
      try {
        command = parseCliCommand(line);
        if (command === undefined) continue;

        switch (command.kind) {
          case "help":
            options.io.write(CLI_HELP_ZH);
            break;
          case "cases":
            options.io.write("公开病例入口：");
            for (const item of publicCases) {
              options.io.write(
                `- ${item.caseId}（${item.caseVersion}）｜${item.displayName}｜${item.chiefComplaint}`,
              );
            }
            break;
          case "start": {
            const caseId = command.caseId;
            const listed = publicCases.some(
              (item) => item.caseId === caseId,
            );
            if (!listed) throw new CliCommandError("未找到该公开病例入口。");
            const created = await service.createSession({
              clientRequestId: nextRequestId("create"),
              idempotencyScopeId: options.config.userId,
              publicCaseId: caseId,
              patientNpcId: patientNpcId(caseId),
            });
            current = toCreateSessionResponseV1(created);
            differentials = [];
            options.io.write("会话已创建。");
            writeSession(options.io, current);
            break;
          }
          case "resume": {
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                command.sessionId,
                options.config.userId,
              ),
            );
            differentials = [];
            options.io.write("会话已恢复。");
            writeSession(options.io, current);
            break;
          }
          case "status": {
            const selected = requireCurrentSession(current);
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                selected.session.sessionId,
                options.config.userId,
              ),
            );
            writeSession(options.io, current);
            break;
          }
          case "ask": {
            const selected = requireCurrentSession(current);
            if (selected.projection.turnCount >= MAX_CLI_TURNS) {
              options.io.write(
                "错误 [TURN_LIMIT_REACHED]：已达到 20 个 CLI 问诊回合，请提交诊断。",
              );
              break;
            }
            const turn = toTurnCompletedV1(
              await service.askPatient({
                sessionId: selected.session.sessionId,
                clientTurnId: nextRequestId("turn"),
                text: command.text,
              }),
            );
            options.io.write(`患者：${turn.reply}`);
            for (const effect of turn.effects) {
              options.io.write(
                effect.type === "test_completed"
                  ? `检查 ${effect.result.testId}：${effect.result.report ?? "已完成"}`
                  : `检查 ${effect.testId}：不可用（${effect.reasonCode}）`,
              );
            }
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                selected.session.sessionId,
                options.config.userId,
              ),
            );
            break;
          }
          case "tests":
            options.io.write("公共检查目录：");
            for (const testId of publicTestIds) options.io.write(`- ${testId}`);
            break;
          case "test": {
            const selected = requireCurrentSession(current);
            const result = toTestResultV1(
              await service.orderTest({
                sessionId: selected.session.sessionId,
                clientRequestId: nextRequestId("test"),
                testId: command.testId,
              }),
            );
            options.io.write(
              result.status === "completed"
                ? `检查 ${result.testId}：${result.report ?? "已完成"}`
                : `检查 ${result.testId}：不可用（${result.reasonCode ?? "未说明"}）`,
            );
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                selected.session.sessionId,
                options.config.userId,
              ),
            );
            break;
          }
          case "differentials":
            requireCurrentSession(current);
            differentials = [...command.differentials];
            options.io.write(`已设置鉴别诊断：${differentials.join("、")}`);
            break;
          case "diagnose": {
            const selected = requireCurrentSession(current);
            const result = toEvaluationResultV1(
              await service.submitDiagnosis({
                sessionId: selected.session.sessionId,
                clientRequestId: nextRequestId("diagnosis"),
                primaryDiagnosis: command.primaryDiagnosis,
                differentials,
              }),
            );
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                selected.session.sessionId,
                options.config.userId,
              ),
            );
            writeEvaluation(options.io, result);
            break;
          }
          case "result": {
            const selected = requireCurrentSession(current);
            writeEvaluation(
              options.io,
              toEvaluationResultV1(
                service.getResult(
                  selected.session.sessionId,
                  options.config.userId,
                ),
              ),
            );
            break;
          }
          case "cancel": {
            const selected = requireCurrentSession(current);
            const cancelled = toCancelSessionResponseV1(
              await service.cancelSession({
                sessionId: selected.session.sessionId,
                clientRequestId: nextRequestId("cancel"),
              }),
            );
            options.io.write(
              `会话 ${cancelled.sessionId} 已于 ${cancelled.cancelledAt} 取消。`,
            );
            current = toCreateSessionResponseV1(
              service.getSessionSnapshot(
                selected.session.sessionId,
                options.config.userId,
              ),
            );
            break;
          }
          case "exit":
            options.io.write("已退出；SQLite 会话已保留。");
            return {
              exitReason: "command",
              ...(current === undefined
                ? {}
                : { currentSessionId: current.session.sessionId }),
            };
        }
      } catch (error) {
        if (error instanceof CliCommandError) {
          options.io.write(`错误 [INVALID_REQUEST]：${error.message}`);
          continue;
        }
        const shared = toSharedErrorV1(error);
        options.io.write(`错误 [${shared.code}]：${shared.message}`);
      }
    }
  } finally {
    service.close();
  }
}
