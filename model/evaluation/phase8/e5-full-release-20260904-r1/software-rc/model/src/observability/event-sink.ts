export interface ModelEvent {
  eventId: string;
  eventType: string;
  sessionId: string;
  sequence: number;
  emittedAt: string;
  payload: Record<string, unknown>;
}

export interface EventSink {
  append(event: ModelEvent): void | Promise<void>;
}

export class MemoryEventSink implements EventSink {
  readonly events: ModelEvent[] = [];

  append(event: ModelEvent): void {
    this.events.push(structuredClone(event));
  }

  list(sessionId: string): ModelEvent[] {
    return this.events
      .filter((event) => event.sessionId === sessionId)
      .map((event) => structuredClone(event));
  }
}
