import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { ClinicHttpError } from "@/src/server/clinic-http";
import { enforceClinicRateLimit } from "@/src/server/clinic-rate-limit";

describe("clinic write rate limit", () => {
  it("limits session creation per anonymous browser profile", () => {
    const request = new NextRequest("http://127.0.0.1/api/clinic/sessions", {
      method: "POST",
    });
    const profileId = `test.profile.${crypto.randomUUID()}`;
    for (let index = 0; index < 6; index += 1) {
      expect(() => enforceClinicRateLimit(request, "create", profileId))
        .not.toThrow();
    }
    expect(() => enforceClinicRateLimit(request, "create", profileId))
      .toThrowError(ClinicHttpError);
    try {
      enforceClinicRateLimit(request, "create", profileId);
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        retryable: true,
      });
    }
  });

  it("does not let one profile consume a shared global request bucket", () => {
    const request = new NextRequest("http://127.0.0.1/api/clinic/sessions", {
      method: "POST",
    });
    for (let index = 0; index < 20; index += 1) {
      expect(() =>
        enforceClinicRateLimit(
          request,
          "create",
          `web.profile.00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        )
      ).not.toThrow();
    }
  });

  it("rejects an ambiguous forwarded client address in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AHAMED_TRUST_PROXY_HEADERS", "true");
    try {
      const request = new NextRequest("http://internal/api/clinic/sessions", {
        method: "POST",
        headers: {
          "X-Forwarded-For": "203.0.113.7, 198.51.100.4",
        },
      });
      expect(() => enforceClinicRateLimit(request, "create"))
        .toThrowError(ClinicHttpError);
      try {
        enforceClinicRateLimit(request, "create");
      } catch (error) {
        expect(error).toMatchObject({ status: 503 });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
