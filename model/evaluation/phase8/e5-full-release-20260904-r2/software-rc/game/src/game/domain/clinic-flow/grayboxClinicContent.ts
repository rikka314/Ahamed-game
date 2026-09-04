import type { NpcIdV1, PatientRoleIdV1, SessionIdV1 } from "@ahamed/doctor-game-share";

import type { PatientQueueEntry } from "@/src/game/domain/clinic-flow/clinicFlow";
import type { PatientActorSlot } from "@/src/game/domain/patients/patientSessionBinding";

export const GRAYBOX_SHIFT_ID = "shift.graybox.day-01";

export const GRAYBOX_PATIENT_SLOTS = [
  {
    npcId: "npc.patient.graybox-01" as NpcIdV1,
    queueAnchorId: "anchor.queue.01",
  },
  {
    npcId: "npc.patient.graybox-02" as NpcIdV1,
    queueAnchorId: "anchor.queue.02",
  },
] as const satisfies readonly PatientActorSlot[];

export const GRAYBOX_PATIENTS: PatientQueueEntry[] = [
  {
    queueEntryId: "queue-entry.graybox.patient-01",
    sessionId: "session.graybox.patient-01" as SessionIdV1,
    npcId: GRAYBOX_PATIENT_SLOTS[0].npcId,
    patientRoleId: "patient-role.public-c01" as PatientRoleIdV1,
    arrivalId: "arrival.graybox.patient-01",
    queueAnchorId: GRAYBOX_PATIENT_SLOTS[0].queueAnchorId,
    label: "一号候诊患者",
  },
  {
    queueEntryId: "queue-entry.graybox.patient-02",
    sessionId: "session.graybox.patient-02" as SessionIdV1,
    npcId: GRAYBOX_PATIENT_SLOTS[1].npcId,
    patientRoleId: "patient-role.public-c02" as PatientRoleIdV1,
    arrivalId: "arrival.graybox.patient-02",
    queueAnchorId: GRAYBOX_PATIENT_SLOTS[1].queueAnchorId,
    label: "二号候诊患者",
  },
];
