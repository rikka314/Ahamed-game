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
  npcId: string;
  label: string;
};

type WorldEventMap = {
  "world.ready": { locationId: string };
  "world.error": { message: string };
  "interaction.available": InteractionDetails | null;
  "interaction.opened": InteractionDetails;
  "interaction.closed": undefined;
};

type GameCommandMap = {
  "movement.set": { x: number; y: number };
  "interaction.confirm": undefined;
  "interaction.close": undefined;
};

export const worldEvents = new TypedEventBus<WorldEventMap>();
export const gameCommands = new TypedEventBus<GameCommandMap>();
