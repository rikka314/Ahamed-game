import type { PatientQueueEntry } from "@/src/game/domain/clinic-flow/clinicFlow";

export const GRAYBOX_SHIFT_ID = "shift.graybox.day-01";

export const GRAYBOX_PATIENTS: PatientQueueEntry[] = [
  {
    queueEntryId: "queue-entry.graybox.patient-01",
    npcId: "npc.patient.graybox-01",
    patientRoleId: "patient-role.public-graybox-01",
    arrivalId: "arrival.graybox.patient-01",
    queueAnchorId: "anchor.queue.01",
    label: "一号候诊患者",
  },
  {
    queueEntryId: "queue-entry.graybox.patient-02",
    npcId: "npc.patient.graybox-02",
    patientRoleId: "patient-role.public-graybox-02",
    arrivalId: "arrival.graybox.patient-02",
    queueAnchorId: "anchor.queue.02",
    label: "二号候诊患者",
  },
];
