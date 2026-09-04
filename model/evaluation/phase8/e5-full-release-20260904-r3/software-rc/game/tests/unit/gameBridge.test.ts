import { describe, expect, it, vi } from "vitest";
import { TypedEventBus } from "@/src/game/bridge/gameBridge";

type TestEvents = {
  ready: { locationId: string };
};

describe("TypedEventBus", () => {
  it("delivers typed payloads and supports unsubscribe", () => {
    const eventBus = new TypedEventBus<TestEvents>();
    const listener = vi.fn();
    const unsubscribe = eventBus.on("ready", listener);

    eventBus.emit("ready", { locationId: "location.clinic.reception" });
    unsubscribe();
    eventBus.emit("ready", { locationId: "location.clinic.other" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ locationId: "location.clinic.reception" });
  });
});
