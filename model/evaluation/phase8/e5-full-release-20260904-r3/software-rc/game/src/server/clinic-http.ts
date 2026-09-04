import "server-only";

import { randomUUID } from "node:crypto";

import { toSharedErrorV1 } from "@ahamed/doctor-game-model";
import type { SharedErrorV1 } from "@ahamed/doctor-game-share";
import { NextRequest, NextResponse } from "next/server";

export const CLINIC_PROFILE_COOKIE = "ahamed-clinic-profile";
export const MAX_CLINIC_REQUEST_BYTES = 16 * 1024;
const CLINIC_PROFILE_ID_PATTERN =
  /^web\.profile\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ClinicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: SharedErrorV1["code"],
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ClinicHttpError";
  }
}

export function clinicProfileId(request: NextRequest): string | undefined {
  const value = request.cookies.get(CLINIC_PROFILE_COOKIE)?.value;
  return value && CLINIC_PROFILE_ID_PATTERN.test(value) ? value : undefined;
}

export function newClinicProfileId(): string {
  return `web.profile.${randomUUID()}`;
}

export function setClinicProfileCookie(
  response: NextResponse,
  profileId: string,
): void {
  response.cookies.set(CLINIC_PROFILE_COOKIE, profileId, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function assertClinicWriteOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "不允许跨站提交问诊请求。");
  }
  const trustProxyHeaders = process.env.AHAMED_TRUST_PROXY_HEADERS === "true";
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.trim();
  if (
    trustProxyHeaders &&
    (!forwardedHost || forwardedHost.includes(",") ||
      !forwardedProtocol || forwardedProtocol.includes(","))
  ) {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求来源无效。");
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求缺少来源信息。");
  }
  const expectedHost = trustProxyHeaders
    ? forwardedHost
    : request.headers.get("host")?.trim() || request.nextUrl.host;
  const expectedProtocol = trustProxyHeaders
    ? forwardedProtocol
    : request.nextUrl.protocol.replace(/:$/u, "");

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求来源无效。");
  }

  if (
    originUrl.username || originUrl.password || originUrl.pathname !== "/" ||
    originUrl.search || originUrl.hash ||
    !expectedHost || !expectedProtocol ||
    !["http", "https"].includes(expectedProtocol.toLowerCase()) ||
    /[\s/@?#]/u.test(expectedHost)
  ) {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求来源无效。");
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(
      `${expectedProtocol.toLowerCase()}://${expectedHost}`,
    ).origin;
  } catch {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求来源无效。");
  }
  if (originUrl.origin !== expectedOrigin) {
    throw new ClinicHttpError(403, "INVALID_REQUEST", "请求来源无效。");
  }
}

export function clinicJsonResponse<T>(value: T, status = 200): NextResponse<T> {
  const response = NextResponse.json(value, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ClinicHttpError(
      415,
      "INVALID_REQUEST",
      "请求 Content-Type 必须为 application/json。",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CLINIC_REQUEST_BYTES) {
    throw new ClinicHttpError(
      413,
      "INVALID_REQUEST",
      "请求正文过大。",
    );
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new ClinicHttpError(400, "INVALID_REQUEST", "请求正文不能为空。");
  }
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_CLINIC_REQUEST_BYTES) {
      await reader.cancel();
      throw new ClinicHttpError(
        413,
        "INVALID_REQUEST",
        "请求正文过大。",
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ClinicHttpError(
      400,
      "INVALID_REQUEST",
      "请求正文必须是有效 JSON。",
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ClinicHttpError(
      400,
      "INVALID_REQUEST",
      "请求正文必须是 JSON object。",
    );
  }
  return value as Record<string, unknown>;
}

function errorStatus(error: SharedErrorV1): number {
  switch (error.code) {
    case "INVALID_REQUEST":
      return 400;
    case "SESSION_NOT_FOUND":
      return 404;
    case "SESSION_EXPIRED":
      return 410;
    case "IDEMPOTENCY_CONFLICT":
    case "INVALID_SESSION_STATE":
    case "OPERATION_IN_PROGRESS":
    case "TURN_LIMIT_REACHED":
    case "SESSION_CANCELLED":
    case "DIAGNOSIS_ALREADY_SUBMITTED":
      return 409;
    case "SAFETY_PROMPT_INJECTION":
    case "SAFETY_REAL_HEALTH_INPUT":
    case "SAFETY_INTERRUPTED":
      return 422;
    case "MODEL_UNAVAILABLE":
    case "MODEL_TIMEOUT":
    case "EVALUATION_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

export function clinicErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClinicHttpError) {
    const response = clinicJsonResponse(
      {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      } satisfies SharedErrorV1,
      error.status,
    );
    if (error.retryAfterSeconds !== undefined) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  const sharedError = toSharedErrorV1(error);
  return clinicJsonResponse(sharedError, errorStatus(sharedError));
}

export function missingClinicProfileResponse(): NextResponse {
  return clinicJsonResponse(
    {
      code: "SESSION_NOT_FOUND",
      message: "当前浏览器中没有可恢复的问诊身份，请重新开始病例。",
      retryable: false,
    } satisfies SharedErrorV1,
    401,
  );
}
