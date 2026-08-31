import { createHash } from "node:crypto";

import type { CasePackage } from "./case-package.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function contentHashPayload(casePackage: CasePackage): unknown {
  const value = structuredClone(casePackage);
  value.packageStatus = "draft";
  delete value.releaseValidation;
  delete value.provenance.contentHash;
  value.review = {
    status: "pending",
    author: value.review.author,
    ...(value.review.notes === undefined ? {} : { notes: value.review.notes }),
  };
  value.redFlagExclusionMatrix.entries =
    value.redFlagExclusionMatrix.entries.map((entry) => ({
      ...entry,
      reviewDecision: "pending",
    }));
  value.redFlagExclusionMatrix.review = { status: "pending" };
  return stableValue(value);
}

export function computeCaseContentHash(casePackage: CasePackage): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(contentHashPayload(casePackage)))
    .digest("hex")}`;
}
