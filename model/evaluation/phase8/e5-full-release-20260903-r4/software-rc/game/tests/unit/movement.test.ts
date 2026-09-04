import { describe, expect, it } from "vitest";
import {
  combineMovementInputs,
  normalizeMovementInput,
} from "@/src/game/domain/player/movement";

describe("normalizeMovementInput", () => {
  it("keeps an axis-aligned input unchanged", () => {
    expect(normalizeMovementInput({ x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it("normalizes diagonal movement to prevent a speed boost", () => {
    const movement = normalizeMovementInput({ x: 1, y: 1 });

    expect(Math.hypot(movement.x, movement.y)).toBeCloseTo(1);
    expect(movement.x).toBeCloseTo(Math.SQRT1_2);
    expect(movement.y).toBeCloseTo(Math.SQRT1_2);
  });

  it("clamps invalid or out-of-range axes", () => {
    expect(normalizeMovementInput({ x: Number.NaN, y: 3 })).toEqual({ x: 0, y: 1 });
  });
});

describe("combineMovementInputs", () => {
  it("combines simultaneous pointers into normalized diagonal movement", () => {
    const movement = combineMovementInputs([
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ]);

    expect(movement.x).toBeCloseTo(Math.SQRT1_2);
    expect(movement.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("keeps the remaining direction when one pointer is released", () => {
    const activePointers = new Map([
      [2, { x: 1, y: 0 }],
    ]);

    expect(combineMovementInputs(activePointers.values())).toEqual({ x: 1, y: 0 });
  });
});
