import type {
  ClientTurnIdV1,
  FactIdV1,
  SessionIdV1,
  TestIdV1,
  TurnIdV1,
} from "./ids.js";
import type { SessionPhaseV1 } from "./sessions.js";
import type { TestResultV1 } from "./tests.js";

export type TurnRequestV1 = { clientTurnId: ClientTurnIdV1; text: string; locale: string };
export type TurnAcceptedV1 = { sessionId: SessionIdV1; clientTurnId: ClientTurnIdV1; turnNumber: number };
export type CompletedTestResultV1 = TestResultV1 & { status: "completed" };
export type TurnEffectV1 =
  | { type: "test_completed"; result: CompletedTestResultV1 }
  | { type: "test_unavailable"; testId: TestIdV1; reasonCode: string };
export type TurnCompletedV1 = {
  sessionId: SessionIdV1;
  turnId: TurnIdV1;
  reply: string;
  disclosedFactIds: FactIdV1[];
  effects: TurnEffectV1[];
  turnNumber: number;
  sessionPhase: SessionPhaseV1;
};
