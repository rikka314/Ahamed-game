import type {
  CaseIdV1,
  CaseSummaryV1,
  CaseVersionV1,
  NpcIdV1,
  PatientRoleIdV1,
  SessionIdV1,
} from "@ahamed/doctor-game-share";
import { describe, expect, it } from "vitest";

import {
  createClinicFlowState,
  transitionClinicFlow,
  type ClinicFlowCommand,
  type ClinicFlowState,
  type PatientQueueEntry,
} from "@/src/game/domain/clinic-flow/clinicFlow";
import { GRAYBOX_PATIENT_SLOTS } from "@/src/game/domain/clinic-flow/grayboxClinicContent";
import {
  EXPECTED_LAUNCH_PATIENT_ROLE_COUNT,
  assertPublicPatientIdentityAssets,
  createPublicPatientIdentityIndex,
  listPublicPatientIdentities,
  resolvePublicPatientIdentity,
} from "@/src/game/domain/patients/publicPatientIdentityCatalog";
import {
  bindCaseSummaryToPatientSlot,
  createPatientQueueEntriesFromCaseSummaries,
} from "@/src/game/domain/patients/patientSessionBinding";

const npcSlots = GRAYBOX_PATIENT_SLOTS.map(({ npcId }) => npcId);

function opaque<T extends string>(value: string): T {
  return value as T;
}

function caseSummary(index: number, npcId: NpcIdV1): CaseSummaryV1 {
  const code = String(index + 1).padStart(2, "0");
  return {
    contractVersion: "1",
    sessionId: opaque<SessionIdV1>(`session.e4.${code}`),
    caseId: opaque<CaseIdV1>(`case.public-${code}`),
    caseVersion: opaque<CaseVersionV1>("case-v1"),
    patientNpcId: npcId,
    patientRoleId: opaque<PatientRoleIdV1>(`patient-role.public-c${code}`),
    chiefComplaint: "虚构主诉",
    patientDisplay: { displayName: `患者${code}` },
    allowedActions: ["ask_patient", "order_test", "submit_diagnosis"],
    sessionPhase: "active",
  };
}

function apply(state: ClinicFlowState, command: ClinicFlowCommand): ClinicFlowState {
  const result = transitionClinicFlow(state, command);
  expect(result.status).toBe("applied");
  return result.state;
}

function completeTwoPatientShift(
  state: ClinicFlowState,
  patients: PatientQueueEntry[],
  shiftIndex: number,
): ClinicFlowState {
  if (state.phase === "doctor_seated_intro") {
    state = apply(state, { type: "intro.complete", commandId: "intro.e4" });
    state = apply(state, { type: "computer.open", commandId: "computer.e4" });
  }
  state = apply(state, {
    type: "shift.start",
    commandId: `shift.start.${shiftIndex}`,
    shiftId: `shift.e4.${shiftIndex}`,
    patients,
  });
  state = apply(state, { type: "queue.form", commandId: `queue.form.${shiftIndex}` });
  state = apply(state, { type: "queue.formed", commandId: `queue.formed.${shiftIndex}` });

  for (const [patientIndex, patient] of patients.entries()) {
    state = apply(state, {
      type: "patient.call",
      commandId: `call.${shiftIndex}.${patientIndex}`,
      callId: `call.e4.${shiftIndex}.${patientIndex}`,
    });
    state = apply(state, {
      type: "patient.seated",
      commandId: `seat.${shiftIndex}.${patientIndex}`,
      arrivalId: patient.arrivalId,
    });
    state = apply(state, {
      type: "patient.departure.start",
      commandId: `dismiss.${patient.sessionId}`,
      npcId: patient.npcId,
      sessionId: patient.sessionId,
    });
    state = apply(state, {
      type: "patient.departure.complete",
      commandId: `departure-complete.${patient.sessionId}`,
      npcId: patient.npcId,
      sessionId: patient.sessionId,
    });
  }

  expect(state.phase).toBe("shift_completed");
  return state;
}

describe("public patient identity mapping", () => {
  it("contains exactly 30 unique, public-only patient roles", () => {
    const identities = listPublicPatientIdentities();
    expect(identities).toHaveLength(EXPECTED_LAUNCH_PATIENT_ROLE_COUNT);
    expect(new Set(identities.map(({ patientRoleId }) => patientRoleId)).size).toBe(
      EXPECTED_LAUNCH_PATIENT_ROLE_COUNT,
    );
    expect(new Set(identities.map(({ sprite }) => sprite.tint)).size).toBe(
      EXPECTED_LAUNCH_PATIENT_ROLE_COUNT,
    );
    expect(JSON.stringify(identities)).not.toMatch(
      /personaTemplateId|behaviorInstructions|answerKey|rubric|targetDiagnosis|patientFacts/u,
    );
  });

  it("fails explicitly for missing, duplicate, and incompatible mappings", () => {
    expect(() => resolvePublicPatientIdentity("patient-role.public-missing")).toThrow(
      /unknown patientRoleId/iu,
    );

    const first = listPublicPatientIdentities()[0];
    expect(() => createPublicPatientIdentityIndex([first, { ...first }])).toThrow(
      /duplicate patientRoleId/iu,
    );

    const summary = caseSummary(0, opaque<NpcIdV1>(npcSlots[0]));
    expect(() =>
      bindCaseSummaryToPatientSlot(summary, {
        npcId: opaque<NpcIdV1>(npcSlots[1]),
        queueAnchorId: "anchor.queue.01",
      }),
    ).toThrow(/patientNpcId.*slot/iu);

    summary.patientDisplay.portraitAssetId = "patient-placeholder-incompatible";
    expect(() =>
      bindCaseSummaryToPatientSlot(summary, {
        npcId: opaque<NpcIdV1>(npcSlots[0]),
        queueAnchorId: "anchor.queue.01",
      }),
    ).toThrow(/portraitAssetId.*identity catalog/iu);

    expect(() =>
      assertPublicPatientIdentityAssets(
        first,
        (assetId) => assetId !== first.sprite.seatedTextureKey,
      ),
    ).toThrow(/missing public patient asset/iu);

    const duplicateSession = caseSummary(1, opaque<NpcIdV1>(npcSlots[1]));
    duplicateSession.sessionId = summary.sessionId;
    expect(() =>
      createPatientQueueEntriesFromCaseSummaries(
        [caseSummary(0, opaque<NpcIdV1>(npcSlots[0])), duplicateSession],
        GRAYBOX_PATIENT_SLOTS,
      ),
    ).toThrow(/duplicate sessionId/iu);

    const duplicateRole = caseSummary(1, opaque<NpcIdV1>(npcSlots[1]));
    duplicateRole.patientRoleId = opaque<PatientRoleIdV1>("patient-role.public-c01");
    expect(() =>
      createPatientQueueEntriesFromCaseSummaries(
        [caseSummary(0, opaque<NpcIdV1>(npcSlots[0])), duplicateRole],
        GRAYBOX_PATIENT_SLOTS,
      ),
    ).toThrow(/duplicate patientRoleId/iu);
  });

  it("binds share summaries and rotates all 30 roles through two slots in one flow", () => {
    let state = createClinicFlowState();

    for (let pairIndex = 0; pairIndex < EXPECTED_LAUNCH_PATIENT_ROLE_COUNT / 2; pairIndex += 1) {
      const summaries = npcSlots.map((npcId, slotIndex) => {
        const patientIndex = pairIndex * 2 + slotIndex;
        return caseSummary(patientIndex, opaque<NpcIdV1>(npcId));
      });
      const patients = createPatientQueueEntriesFromCaseSummaries(
        summaries,
        GRAYBOX_PATIENT_SLOTS,
      );

      state = completeTwoPatientShift(state, patients, pairIndex);
    }

    expect(new Set(npcSlots).size).toBe(2);
    expect(state.completedSessionIds).toHaveLength(EXPECTED_LAUNCH_PATIENT_ROLE_COUNT);
    expect(new Set(state.completedSessionIds).size).toBe(EXPECTED_LAUNCH_PATIENT_ROLE_COUNT);
    expect(state.completedPatientRoleIds).toHaveLength(EXPECTED_LAUNCH_PATIENT_ROLE_COUNT);
    expect(new Set(state.completedPatientRoleIds).size).toBe(
      EXPECTED_LAUNCH_PATIENT_ROLE_COUNT,
    );
  });
});
