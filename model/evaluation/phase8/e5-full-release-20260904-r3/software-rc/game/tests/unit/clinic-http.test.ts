import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  assertClinicWriteOrigin,
  clinicProfileId,
  clinicErrorResponse,
  ClinicHttpError,
  MAX_CLINIC_REQUEST_BYTES,
  readJsonObject,
} from "@/src/server/clinic-http";

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://127.0.0.1/api/clinic/test", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

describe("clinic HTTP request boundary", () => {
  it("accepts a bounded JSON object", async () => {
    await expect(readJsonObject(jsonRequest('{"text":"你好"}'))).resolves.toEqual({
      text: "你好",
    });
  });

  it("rejects non-JSON media types", async () => {
    await expect(
      readJsonObject(jsonRequest('{"text":"你好"}', "text/plain")),
    ).rejects.toMatchObject({ status: 415 } satisfies Partial<ClinicHttpError>);
  });

  it("rejects streamed bodies beyond the byte limit", async () => {
    const oversized = JSON.stringify({ text: "a".repeat(MAX_CLINIC_REQUEST_BYTES) });
    await expect(readJsonObject(jsonRequest(oversized))).rejects.toMatchObject(
      { status: 413 } satisfies Partial<ClinicHttpError>,
    );
  });

  it("rejects cross-origin writes", () => {
    const request = new NextRequest("https://clinic.example/api/clinic/test", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(() => assertClinicWriteOrigin(request)).toThrowError(ClinicHttpError);
  });

  it("rejects writes without an Origin header", () => {
    const request = new NextRequest("https://clinic.example/api/clinic/test", {
      method: "POST",
      headers: { Host: "clinic.example" },
    });
    expect(() => assertClinicWriteOrigin(request)).toThrowError(ClinicHttpError);
  });

  it("accepts the browser-facing host when Next dev normalizes the request URL", () => {
    const request = new NextRequest("http://localhost:3020/api/clinic/test", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3020",
        Origin: "http://127.0.0.1:3020",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(() => assertClinicWriteOrigin(request)).not.toThrow();
  });

  it("normalizes host casing and default ports using URL origin semantics", () => {
    const request = new NextRequest("https://clinic.example/api/clinic/test", {
      method: "POST",
      headers: {
        Host: "CLINIC.EXAMPLE:443",
        Origin: "https://clinic.example",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    expect(() => assertClinicWriteOrigin(request)).not.toThrow();
  });

  it("rejects ambiguous forwarded origin headers from a trusted proxy", () => {
    const previous = process.env.AHAMED_TRUST_PROXY_HEADERS;
    process.env.AHAMED_TRUST_PROXY_HEADERS = "true";
    try {
      const request = new NextRequest("http://internal:3020/api/clinic/test", {
        method: "POST",
        headers: {
          Origin: "https://clinic.example",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "attacker.example, clinic.example",
          "X-Forwarded-Proto": "https",
        },
      });
      expect(() => assertClinicWriteOrigin(request)).toThrowError(ClinicHttpError);
    } finally {
      if (previous === undefined) delete process.env.AHAMED_TRUST_PROXY_HEADERS;
      else process.env.AHAMED_TRUST_PROXY_HEADERS = previous;
    }
  });

  it("accepts one normalized forwarded origin from a trusted proxy", () => {
    const previous = process.env.AHAMED_TRUST_PROXY_HEADERS;
    process.env.AHAMED_TRUST_PROXY_HEADERS = "true";
    try {
      const request = new NextRequest("http://internal:3020/api/clinic/test", {
        method: "POST",
        headers: {
          Origin: "https://clinic.example",
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": "CLINIC.EXAMPLE:443",
          "X-Forwarded-Proto": "https",
        },
      });
      expect(() => assertClinicWriteOrigin(request)).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.AHAMED_TRUST_PROXY_HEADERS;
      else process.env.AHAMED_TRUST_PROXY_HEADERS = previous;
    }
  });

  it("does not expose arbitrary internal error messages", async () => {
    const response = clinicErrorResponse(
      new TypeError("database-password=must-not-leak"),
    );
    expect(JSON.stringify(await response.json())).not.toContain("must-not-leak");
  });

  it("ignores forged profile cookie values", () => {
    const request = new NextRequest("https://clinic.example/api/clinic/test", {
      headers: {
        Cookie: "ahamed-clinic-profile=attacker-controlled-unbounded-value",
      },
    });
    expect(clinicProfileId(request)).toBeUndefined();
  });
});
