import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  validateJsonSchemaDocument,
  type JsonSchemaDocumentRegistry,
  type JsonSchemaSubset,
} from "@ahamed/doctor-game-share/schema-validation";

import { CasePackageValidationError } from "./case-package.js";

function readSchema(name: string): JsonSchemaSubset {
  const path = fileURLToPath(
    new URL(`../../../cases/schemas/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchemaSubset;
}

const casePackageSchemas: Record<string, JsonSchemaSubset> = {
  "case-package-v1-rc1": readSchema("case-package-v1-rc1.schema.json"),
  "case-package-v2-rc1": readSchema("case-package-v2-rc1.schema.json"),
};
const caseManifestV2Schema = readSchema("case-manifest-v2-rc1.schema.json");
const schemaDocuments: JsonSchemaDocumentRegistry = {
  "rubric-v1.schema.json": readSchema("rubric-v1.schema.json"),
  "review-record-v1.schema.json": readSchema("review-record-v1.schema.json"),
  "ai-case-cross-validation-v1.schema.json": readSchema(
    "ai-case-cross-validation-v1.schema.json",
  ),
  "provenance-record-v1.schema.json": readSchema(
    "provenance-record-v1.schema.json",
  ),
  "provenance-record-v2.schema.json": readSchema(
    "provenance-record-v2.schema.json",
  ),
  "ai-case-cross-review-v3.schema.json": readSchema(
    "ai-case-cross-review-v3.schema.json",
  ),
  "red-flag-exclusion-matrix-v1.schema.json": readSchema(
    "red-flag-exclusion-matrix-v1.schema.json",
  ),
};

export function assertCasePackageJsonSchema(value: unknown): void {
  const schemaVersion = value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ? (value as Record<string, unknown>)["schemaVersion"]
    : undefined;
  const casePackageSchema = typeof schemaVersion === "string"
    ? casePackageSchemas[schemaVersion]
    : undefined;
  if (casePackageSchema === undefined) {
    throw new CasePackageValidationError([
      `JSON Schema: unsupported schemaVersion ${String(schemaVersion)}`,
    ]);
  }
  const result = validateJsonSchemaDocument(
    casePackageSchema,
    value,
    schemaDocuments,
  );
  if (!result.valid) {
    throw new CasePackageValidationError(
      result.errors.map((issue) => `JSON Schema: ${issue}`),
    );
  }
}

export function assertCaseManifestV2JsonSchema(value: unknown): void {
  const result = validateJsonSchemaDocument(
    caseManifestV2Schema,
    value,
    schemaDocuments,
  );
  if (!result.valid) {
    throw new CasePackageValidationError(
      result.errors.map((issue) => `JSON Schema: ${issue}`),
    );
  }
}
