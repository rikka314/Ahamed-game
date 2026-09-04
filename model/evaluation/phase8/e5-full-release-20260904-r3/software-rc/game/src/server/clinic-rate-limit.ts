import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

import type { NextRequest } from "next/server";

import { ClinicHttpError } from "./clinic-http";

type ClinicWriteAction = "create" | "turn" | "diagnosis";

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateRule {
  key: string;
  limit: number;
  windowMs: number;
}

const MINUTE_MS = 60_000;
const MAX_BUCKETS = 5_000;
const bucketsGlobal = globalThis as typeof globalThis & {
  __ahamedClinicRateBuckets?: Map<string, RateBucket>;
};
const buckets = bucketsGlobal.__ahamedClinicRateBuckets ??= new Map();

const actionLimits: Record<ClinicWriteAction, { network: number; profile: number }> = {
  create: { network: 12, profile: 6 },
  turn: { network: 40, profile: 12 },
  diagnosis: { network: 16, profile: 4 },
};

function trustedNetworkKey(request: NextRequest): string | undefined {
  if (process.env["AHAMED_TRUST_PROXY_HEADERS"] !== "true") return undefined;
  const forwarded = request.headers.get("x-forwarded-for")?.trim();
  const address = forwarded && !forwarded.includes(",") ? forwarded : undefined;
  if (!address || address.length > 64 || isIP(address) === 0) return undefined;
  const digest = createHash("sha256").update(address, "utf8").digest("hex");
  return `network:${digest}`;
}

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function enforceClinicRateLimit(
  request: NextRequest,
  action: ClinicWriteAction,
  profileId?: string,
): void {
  const now = Date.now();
  pruneExpiredBuckets(now);
  const limits = actionLimits[action];
  const rules: RateRule[] = [];
  const networkKey = trustedNetworkKey(request);
  if (process.env.NODE_ENV === "production" && networkKey === undefined) {
    throw new ClinicHttpError(
      503,
      "MODEL_UNAVAILABLE",
      "问诊入口缺少可信代理限流配置。",
      true,
      60,
    );
  }
  if (networkKey) {
    rules.push({
      key: `${networkKey}:${action}`,
      limit: limits.network,
      windowMs: MINUTE_MS,
    });
  }
  if (profileId) {
    rules.push({
      key: `profile:${profileId}:${action}`,
      limit: limits.profile,
      windowMs: MINUTE_MS,
    });
  }

  const inspected = rules.map((rule) => ({
    rule,
    bucket: buckets.get(rule.key) ?? {
      count: 0,
      resetAt: now + rule.windowMs,
    },
  }));
  const blocked = inspected.find(({ rule, bucket }) => bucket.count >= rule.limit);
  if (blocked) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((blocked.bucket.resetAt - now) / 1000),
    );
    throw new ClinicHttpError(
      429,
      "OPERATION_IN_PROGRESS",
      "请求过于频繁，请稍后再试。",
      true,
      retryAfterSeconds,
    );
  }
  const newBucketCount = inspected.filter(({ rule }) => !buckets.has(rule.key)).length;
  if (buckets.size + newBucketCount > MAX_BUCKETS) {
    throw new ClinicHttpError(
      503,
      "MODEL_UNAVAILABLE",
      "问诊流量保护暂时繁忙，请稍后再试。",
      true,
      60,
    );
  }
  for (const { rule, bucket } of inspected) {
    bucket.count += 1;
    buckets.set(rule.key, bucket);
  }
}
