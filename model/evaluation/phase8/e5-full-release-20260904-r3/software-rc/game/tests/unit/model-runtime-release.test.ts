import {
  loadWebPublicCases,
  resolvePackagedWebModelRoot,
  WEB_CASE_MANIFEST,
} from "@ahamed/doctor-game-model";
import { describe, expect, it } from "vitest";

describe("installed model runtime release", () => {
  it("exposes the approved r9 30-case release from the package consumed by the game", () => {
    expect(WEB_CASE_MANIFEST).toBe("manifest.launch-release-20260904-r9.json");

    const cases = loadWebPublicCases(resolvePackagedWebModelRoot());
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map(({ publicCaseId }) => publicCaseId)).size).toBe(30);
  });
});
