import type {
  CaseSummaryV1,
  NpcIdV1,
  PatientRoleIdV1,
  SessionIdV1,
} from "@ahamed/doctor-game-share";

import { resolvePublicPatientIdentity } from "@/src/game/domain/patients/publicPatientIdentityCatalog";
import type { PatientQueueEntry } from "@/src/game/domain/clinic-flow/clinicFlow";

export type PatientActorSlot = {
  npcId: NpcIdV1;
  queueAnchorId: string;
};

export type PatientSessionBinding = {
  sessionId: SessionIdV1;
  npcId: NpcIdV1;
  patientRoleId: PatientRoleIdV1;
  queueAnchorId: string;
};

export function bindCaseSummaryToPatientSlot(
  summary: CaseSummaryV1,
  slot: PatientActorSlot,
): PatientSessionBinding {
  if (summary.patientNpcId !== slot.npcId) {
    throw new Error(
      `CaseSummary patientNpcId ${summary.patientNpcId} does not match actor slot ${slot.npcId}.`,
    );
  }

  const identity = resolvePublicPatientIdentity(summary.patientRoleId);
  if (
    summary.patientDisplay.portraitAssetId !== undefined &&
    summary.patientDisplay.portraitAssetId !== identity.portraitAssetId
  ) {
    throw new Error(
      `CaseSummary portraitAssetId ${summary.patientDisplay.portraitAssetId} does not match the identity catalog for ${summary.patientRoleId}.`,
    );
  }

  return {
    sessionId: summary.sessionId,
    npcId: slot.npcId,
    patientRoleId: summary.patientRoleId,
    queueAnchorId: slot.queueAnchorId,
  };
}

export function createPatientQueueEntriesFromCaseSummaries(
  summaries: readonly CaseSummaryV1[],
  slots: readonly PatientActorSlot[],
): PatientQueueEntry[] {
  if (summaries.length === 0) {
    throw new Error("At least one CaseSummary is required to create a patient queue.");
  }

  const slotIndex = new Map<NpcIdV1, PatientActorSlot>();
  for (const slot of slots) {
    if (slotIndex.has(slot.npcId)) {
      throw new Error(`Duplicate npcId in patient actor slots: ${slot.npcId}`);
    }
    slotIndex.set(slot.npcId, { ...slot });
  }

  const seenSessions = new Set<SessionIdV1>();
  const seenRoles = new Set<PatientRoleIdV1>();

  return summaries.map((summary) => {
    if (seenSessions.has(summary.sessionId)) {
      throw new Error(`Duplicate sessionId in CaseSummary queue: ${summary.sessionId}`);
    }
    if (seenRoles.has(summary.patientRoleId)) {
      throw new Error(`Duplicate patientRoleId in CaseSummary queue: ${summary.patientRoleId}`);
    }

    const slot = slotIndex.get(summary.patientNpcId);
    if (!slot) {
      throw new Error(`Unknown patientNpcId actor slot: ${summary.patientNpcId}`);
    }

    seenSessions.add(summary.sessionId);
    seenRoles.add(summary.patientRoleId);
    const binding = bindCaseSummaryToPatientSlot(summary, slot);
    return {
      ...binding,
      queueEntryId: `queue-entry.${summary.sessionId}`,
      arrivalId: `arrival.${summary.sessionId}`,
      label: summary.patientDisplay.displayName,
    };
  });
}
