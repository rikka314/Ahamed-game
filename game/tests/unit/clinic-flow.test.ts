import { describe, expect, it } from "vitest";
import {
  createClinicFlowState,
  transitionClinicFlow,
  type ClinicFlowCommand,
  type ClinicFlowState,
} from "@/src/game/domain/clinic-flow/clinicFlow";
import {
  GRAYBOX_PATIENTS,
  GRAYBOX_SHIFT_ID,
} from "@/src/game/domain/clinic-flow/grayboxClinicContent";

function apply(state: ClinicFlowState, command: ClinicFlowCommand): ClinicFlowState {
  const result = transitionClinicFlow(state, command);
  expect(result.status).toBe("applied");
  return result.state;
}

function reachReadyToCall(): ClinicFlowState {
  let state = createClinicFlowState();
  state = apply(state, { type: "intro.complete", commandId: "intro-01" });
  state = apply(state, { type: "computer.open", commandId: "computer-open-01" });
  state = apply(state, {
    type: "shift.start",
    commandId: "start-shift-01",
    shiftId: GRAYBOX_SHIFT_ID,
    patients: GRAYBOX_PATIENTS,
  });
  state = apply(state, { type: "queue.form", commandId: "queue-form-01" });
  return apply(state, { type: "queue.formed", commandId: "queue-formed-01" });
}

describe("clinic flow", () => {
  it("opens the clinic once and creates a deterministic two-patient queue", () => {
    const state = reachReadyToCall();

    expect(state.phase).toBe("ready_to_call");
    expect(state.shiftId).toBe(GRAYBOX_SHIFT_ID);
    expect(state.queue.map(({ npcId }) => npcId)).toEqual(
      GRAYBOX_PATIENTS.map(({ npcId }) => npcId),
    );
  });

  it("ignores an already applied command id without duplicating the queue", () => {
    const ready = reachReadyToCall();
    const duplicate = transitionClinicFlow(ready, {
      type: "queue.formed",
      commandId: "queue-formed-01",
    });

    expect(duplicate.status).toBe("ignored");
    expect(duplicate.state).toBe(ready);
    expect(duplicate.state.queue).toHaveLength(2);
  });

  it("allows the pre-shift computer to close and reopen with distinct intent ids", () => {
    let state = createClinicFlowState();
    state = apply(state, { type: "intro.complete", commandId: "intro-01" });
    state = apply(state, { type: "computer.open", commandId: "computer-open-01" });
    state = apply(state, { type: "computer.close", commandId: "computer-close-01" });
    state = apply(state, { type: "computer.open", commandId: "computer-open-02" });

    expect(state.phase).toBe("computer_opened");
  });

  it("keeps the seat exclusive and advances to the second patient only after departure", () => {
    let state = reachReadyToCall();
    state = apply(state, {
      type: "patient.call",
      commandId: "call-command-01",
      callId: "call.graybox.patient-01",
    });
    state = apply(state, {
      type: "patient.seated",
      commandId: "seat-command-01",
      arrivalId: GRAYBOX_PATIENTS[0].arrivalId,
    });

    const prematureCall = transitionClinicFlow(state, {
      type: "patient.call",
      commandId: "call-command-premature",
      callId: "call.graybox.patient-02",
    });
    expect(prematureCall.status).toBe("rejected");

    state = apply(state, {
      type: "patient.departure.start",
      commandId: "departure-start-01",
      npcId: GRAYBOX_PATIENTS[0].npcId,
    });
    state = apply(state, {
      type: "patient.departure.complete",
      commandId: "departure-complete-01",
      npcId: GRAYBOX_PATIENTS[0].npcId,
    });

    expect(state.phase).toBe("ready_to_call");
    expect(state.seatOccupantNpcId).toBeNull();
    expect(state.completedNpcIds).toEqual([GRAYBOX_PATIENTS[0].npcId]);

    state = apply(state, {
      type: "patient.call",
      commandId: "call-command-02",
      callId: "call.graybox.patient-02",
    });
    expect(state.currentPatient?.npcId).toBe(GRAYBOX_PATIENTS[1].npcId);
    expect(state.queue).toHaveLength(0);
  });

  it("rejects duplicate patient identifiers before opening a shift", () => {
    let state = createClinicFlowState();
    state = apply(state, { type: "intro.complete", commandId: "intro-01" });
    state = apply(state, { type: "computer.open", commandId: "computer-open-01" });

    const result = transitionClinicFlow(state, {
      type: "shift.start",
      commandId: "start-shift-01",
      shiftId: GRAYBOX_SHIFT_ID,
      patients: [GRAYBOX_PATIENTS[0], { ...GRAYBOX_PATIENTS[1], npcId: GRAYBOX_PATIENTS[0].npcId }],
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "queue_ids_must_be_unique",
    });
  });
});
