export type ClinicPhase =
  | "doctor_seated_intro"
  | "clinic_ready"
  | "computer_opened"
  | "business_opened"
  | "queue_forming"
  | "ready_to_call"
  | "patient_entering"
  | "patient_seated"
  | "patient_leaving"
  | "shift_completed";

export type PatientQueueEntry = {
  queueEntryId: string;
  npcId: string;
  patientRoleId: string;
  arrivalId: string;
  queueAnchorId: string;
  label: string;
};

export type ClinicFlowState = {
  phase: ClinicPhase;
  shiftId: string | null;
  queue: PatientQueueEntry[];
  currentPatient: PatientQueueEntry | null;
  activeCallId: string | null;
  seatOccupantNpcId: string | null;
  completedNpcIds: string[];
  processedCommandIds: string[];
};

export type ClinicFlowCommand =
  | { type: "intro.complete"; commandId: string }
  | { type: "computer.open"; commandId: string }
  | { type: "computer.close"; commandId: string }
  | {
      type: "shift.start";
      commandId: string;
      shiftId: string;
      patients: PatientQueueEntry[];
    }
  | { type: "queue.form"; commandId: string }
  | { type: "queue.formed"; commandId: string }
  | { type: "patient.call"; commandId: string; callId: string }
  | { type: "patient.seated"; commandId: string; arrivalId: string }
  | { type: "patient.departure.start"; commandId: string; npcId: string }
  | { type: "patient.departure.complete"; commandId: string; npcId: string };

export type ClinicTransitionResult = {
  state: ClinicFlowState;
  status: "applied" | "ignored" | "rejected";
  reason?: string;
};

export function createClinicFlowState(): ClinicFlowState {
  return {
    phase: "doctor_seated_intro",
    shiftId: null,
    queue: [],
    currentPatient: null,
    activeCallId: null,
    seatOccupantNpcId: null,
    completedNpcIds: [],
    processedCommandIds: [],
  };
}

export function transitionClinicFlow(
  state: ClinicFlowState,
  command: ClinicFlowCommand,
): ClinicTransitionResult {
  if (state.processedCommandIds.includes(command.commandId)) {
    return { state, status: "ignored", reason: "duplicate_command" };
  }

  switch (command.type) {
    case "intro.complete":
      return applyWhen(state, command.commandId, state.phase === "doctor_seated_intro", {
        phase: "clinic_ready",
      });

    case "computer.open":
      return applyWhen(state, command.commandId, state.phase === "clinic_ready", {
        phase: "computer_opened",
      });

    case "computer.close":
      return applyWhen(state, command.commandId, state.phase === "computer_opened", {
        phase: "clinic_ready",
      });

    case "shift.start": {
      if (state.phase !== "computer_opened") {
        return rejected(state, "shift_requires_open_computer");
      }

      if (command.patients.length < 2) {
        return rejected(state, "graybox_shift_requires_two_patients");
      }

      const duplicateNpcIds = findDuplicates(command.patients.map(({ npcId }) => npcId));
      const duplicateQueueEntryIds = findDuplicates(
        command.patients.map(({ queueEntryId }) => queueEntryId),
      );

      if (duplicateNpcIds.length > 0 || duplicateQueueEntryIds.length > 0) {
        return rejected(state, "queue_ids_must_be_unique");
      }

      return applied(state, command.commandId, {
        phase: "business_opened",
        shiftId: command.shiftId,
        queue: command.patients.map((patient) => ({ ...patient })),
      });
    }

    case "queue.form":
      return applyWhen(
        state,
        command.commandId,
        state.phase === "business_opened" && state.queue.length > 0,
        { phase: "queue_forming" },
      );

    case "queue.formed":
      return applyWhen(
        state,
        command.commandId,
        state.phase === "queue_forming" && state.queue.length > 0,
        { phase: "ready_to_call" },
      );

    case "patient.call": {
      if (
        state.phase !== "ready_to_call" ||
        state.currentPatient !== null ||
        state.seatOccupantNpcId !== null ||
        state.queue.length === 0
      ) {
        return rejected(state, "call_requires_free_seat_and_waiting_patient");
      }

      const [currentPatient, ...remainingQueue] = state.queue;

      return applied(state, command.commandId, {
        phase: "patient_entering",
        queue: remainingQueue,
        currentPatient,
        activeCallId: command.callId,
      });
    }

    case "patient.seated": {
      if (
        state.phase !== "patient_entering" ||
        state.currentPatient?.arrivalId !== command.arrivalId ||
        state.seatOccupantNpcId !== null
      ) {
        return rejected(state, "arrival_does_not_match_active_patient");
      }

      return applied(state, command.commandId, {
        phase: "patient_seated",
        seatOccupantNpcId: state.currentPatient.npcId,
      });
    }

    case "patient.departure.start": {
      if (
        state.phase !== "patient_seated" ||
        state.currentPatient?.npcId !== command.npcId ||
        state.seatOccupantNpcId !== command.npcId
      ) {
        return rejected(state, "departure_requires_seated_current_patient");
      }

      return applied(state, command.commandId, { phase: "patient_leaving" });
    }

    case "patient.departure.complete": {
      if (
        state.phase !== "patient_leaving" ||
        state.currentPatient?.npcId !== command.npcId
      ) {
        return rejected(state, "departure_completion_does_not_match_patient");
      }

      return applied(state, command.commandId, {
        phase: state.queue.length > 0 ? "ready_to_call" : "shift_completed",
        currentPatient: null,
        activeCallId: null,
        seatOccupantNpcId: null,
        completedNpcIds: [...state.completedNpcIds, command.npcId],
      });
    }
  }
}

function applyWhen(
  state: ClinicFlowState,
  commandId: string,
  condition: boolean,
  patch: Partial<ClinicFlowState>,
): ClinicTransitionResult {
  return condition ? applied(state, commandId, patch) : rejected(state, "invalid_phase");
}

function applied(
  state: ClinicFlowState,
  commandId: string,
  patch: Partial<ClinicFlowState>,
): ClinicTransitionResult {
  return {
    status: "applied",
    state: {
      ...state,
      ...patch,
      processedCommandIds: [...state.processedCommandIds, commandId],
    },
  };
}

function rejected(state: ClinicFlowState, reason: string): ClinicTransitionResult {
  return { state, status: "rejected", reason };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  });

  return [...duplicates];
}
