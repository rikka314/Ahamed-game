type Listener<Payload> = (payload: Payload) => void;

export class TypedEventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<Events[keyof Events]>>>();

  on<EventName extends keyof Events>(
    eventName: EventName,
    listener: Listener<Events[EventName]>,
  ): () => void {
    const eventListeners =
      (this.listeners.get(eventName) as Set<Listener<Events[EventName]>> | undefined) ?? new Set();

    eventListeners.add(listener);
    this.listeners.set(eventName, eventListeners as Set<Listener<Events[keyof Events]>>);

    return () => {
      eventListeners.delete(listener);

      if (eventListeners.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  emit<EventName extends keyof Events>(eventName: EventName, payload: Events[EventName]): void {
    const eventListeners = this.listeners.get(eventName) as
      | Set<Listener<Events[EventName]>>
      | undefined;

    eventListeners?.forEach((listener) => listener(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}

export type InteractionDetails = {
  interactionId: string;
  kind: "computer" | "call-button";
  label: string;
};

export type ClinicFlowSnapshot = {
  phase:
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
  shiftId: string | null;
  waitingCount: number;
  currentPatientNpcId: string | null;
  currentPatientLabel: string | null;
  completedCount: number;
};

export type ScreenAnchor = {
  anchorId: string;
  xRatio: number;
  yRatio: number;
  visible: boolean;
};

export type SpeechBubbleMessage = {
  messageId: string;
  speakerId: string;
  speakerRole: "doctor" | "patient";
  text: string;
};

export type PatientVisualState = {
  npcId: string;
  pose: "standing" | "seated";
  visible: boolean;
};

type WorldEventMap = {
  "world.ready": {
    locationId: string;
    mapId: string;
    contentBuildId: string;
    h3Candidate: "16" | "32" | null;
    compositionCoverage: string[];
    renderContract: {
      abovePlayerDepth: number;
      playerDepth: number;
      collisionCount: number;
    };
    renderer: "webgl" | "fallback";
  };
  "world.error": { message: string };
  "world.warning": { message: string };
  "player.position": { x: number; y: number };
  "world.anchor.updated": ScreenAnchor;
  "speech.show": SpeechBubbleMessage;
  "patient.visual.updated": PatientVisualState;
  "clinic.flow.updated": ClinicFlowSnapshot;
  "interaction.available": InteractionDetails | null;
  "interaction.opened": InteractionDetails;
  "interaction.closed": undefined;
};

type GameCommandMap = {
  "movement.set": { x: number; y: number };
  "interaction.confirm": undefined;
  "interaction.activate": { interactionId: string };
  "interaction.close": undefined;
  "clinic.intro-complete": { commandId: string };
  "clinic.start-shift": { commandId: string; shiftId: string };
  "clinic.dismiss-current": { commandId: string };
  "world.set-suspended": { suspended: boolean };
};

export const worldEvents = new TypedEventBus<WorldEventMap>();
export const gameCommands = new TypedEventBus<GameCommandMap>();
