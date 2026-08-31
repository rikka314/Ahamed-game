export type CliCommand =
  | { kind: "cases" }
  | { kind: "start"; caseId: string }
  | { kind: "resume"; sessionId: string }
  | { kind: "status" }
  | { kind: "ask"; text: string }
  | { kind: "tests" }
  | { kind: "test"; testId: string }
  | { kind: "diagnose"; primaryDiagnosis: string }
  | { kind: "differentials"; differentials: string[] }
  | { kind: "result" }
  | { kind: "cancel" }
  | { kind: "help" }
  | { kind: "exit" };

export class CliCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliCommandError";
  }
}

const NO_ARGUMENT_COMMANDS = new Map<string, CliCommand>([
  ["/cases", { kind: "cases" }],
  ["/status", { kind: "status" }],
  ["/tests", { kind: "tests" }],
  ["/result", { kind: "result" }],
  ["/cancel", { kind: "cancel" }],
  ["/help", { kind: "help" }],
  ["/exit", { kind: "exit" }],
]);

function requireArgument(argument: string, usage: string): string {
  if (argument.length === 0) throw new CliCommandError(`用法：${usage}`);
  return argument;
}

export function parseCliCommand(line: string): CliCommand | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  if (!trimmed.startsWith("/")) return { kind: "ask", text: trimmed };

  const separator = trimmed.search(/\s/u);
  const name = separator < 0 ? trimmed : trimmed.slice(0, separator);
  const argument = separator < 0 ? "" : trimmed.slice(separator).trim();
  const noArgument = NO_ARGUMENT_COMMANDS.get(name);
  if (noArgument !== undefined) {
    if (argument.length > 0) {
      throw new CliCommandError(`${name} 不接受额外参数。`);
    }
    return noArgument;
  }

  switch (name) {
    case "/start":
      return {
        kind: "start",
        caseId: requireArgument(argument, "/start <caseId>"),
      };
    case "/resume":
      return {
        kind: "resume",
        sessionId: requireArgument(argument, "/resume <sessionId>"),
      };
    case "/test":
      return {
        kind: "test",
        testId: requireArgument(argument, "/test <testId>"),
      };
    case "/diagnose":
      return {
        kind: "diagnose",
        primaryDiagnosis: requireArgument(
          argument,
          "/diagnose <主要诊断>",
        ),
      };
    case "/differentials": {
      const values = requireArgument(
        argument,
        "/differentials <诊断1;诊断2>",
      )
        .split(/[;；]/u)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length === 0) {
        throw new CliCommandError("至少提供一个鉴别诊断。");
      }
      return { kind: "differentials", differentials: values };
    }
    default:
      throw new CliCommandError(`未知命令：${name}。输入 /help 查看帮助。`);
  }
}
