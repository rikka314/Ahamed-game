import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  validateJsonSchemaDocument,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";

export const RED_FLAG_POLICY_VERSION_V2 =
  "red-flag-policy-manifest-v2" as const;

export interface RedFlagDomainPolicyV2 {
  diseaseDomainId: string;
  displayName: string;
  requiredRedFlagIds: string[];
}

export interface RedFlagPolicyV2 {
  schemaVersion: typeof RED_FLAG_POLICY_VERSION_V2;
  policyVersion: typeof RED_FLAG_POLICY_VERSION_V2;
  commonRedFlagIds: string[];
  domains: RedFlagDomainPolicyV2[];
}

function readJson(relativePath: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../cases/${relativePath}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const RED_FLAG_POLICY_SCHEMA = readJson(
  "schemas/red-flag-policy-manifest-v2.schema.json",
) as JsonSchemaSubset;

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

export function assertRedFlagPolicyV2(
  value: unknown,
): asserts value is RedFlagPolicyV2 {
  const schemaResult = validateJsonSchemaDocument(RED_FLAG_POLICY_SCHEMA, value);
  if (!schemaResult.valid) {
    throw new Error(
      `red-flag policy schema is invalid: ${schemaResult.errors.join("; ")}`,
    );
  }
  const policy = value as RedFlagPolicyV2;
  const issues: string[] = [];
  for (const duplicate of duplicates(policy.commonRedFlagIds)) {
    issues.push(`common red-flag ID ${duplicate} is duplicated`);
  }
  for (const duplicate of duplicates(
    policy.domains.map(({ diseaseDomainId }) => diseaseDomainId),
  )) {
    issues.push(`disease domain ${duplicate} is duplicated`);
  }
  for (const domain of policy.domains) {
    for (const duplicate of duplicates(domain.requiredRedFlagIds)) {
      issues.push(
        `domain ${domain.diseaseDomainId} red-flag ID ${duplicate} is duplicated`,
      );
    }
  }
  if (issues.length > 0) {
    throw new Error(`red-flag policy is invalid: ${issues.join("; ")}`);
  }
}

export function loadRedFlagPolicyV2(): RedFlagPolicyV2 {
  const value = readJson("policy/red-flag-policy-manifest-v2.json");
  assertRedFlagPolicyV2(value);
  return value;
}

export function getRequiredRedFlagIds(
  policy: RedFlagPolicyV2,
  diseaseDomainId: string,
): string[] {
  const domain = policy.domains.find(
    (candidate) => candidate.diseaseDomainId === diseaseDomainId,
  );
  if (domain === undefined) {
    throw new Error(`unknown disease domain: ${diseaseDomainId}`);
  }
  return [...new Set([
    ...policy.commonRedFlagIds,
    ...domain.requiredRedFlagIds,
  ])];
}
