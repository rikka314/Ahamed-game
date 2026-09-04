export type MovementVector = Readonly<{
  x: number;
  y: number;
}>;

export function normalizeMovementInput(input: MovementVector): MovementVector {
  const x = clampAxis(input.x);
  const y = clampAxis(input.y);
  const length = Math.hypot(x, y);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  if (length <= 1) {
    return { x, y };
  }

  return {
    x: x / length,
    y: y / length,
  };
}

export function combineMovementInputs(inputs: Iterable<MovementVector>): MovementVector {
  let x = 0;
  let y = 0;

  for (const input of inputs) {
    x += input.x;
    y += input.y;
  }

  return normalizeMovementInput({ x, y });
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}
