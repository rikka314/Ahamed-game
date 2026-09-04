import { describe, expect, it } from "vitest";

import * as diagnosisRoute from "@/app/api/clinic/sessions/[sessionId]/diagnosis/route";

describe("clinic diagnosis result route", () => {
  it("exposes result recovery without a client-controlled diagnosis write", () => {
    expect(diagnosisRoute.GET).toBeTypeOf("function");
    expect("POST" in diagnosisRoute).toBe(false);
  });
});
