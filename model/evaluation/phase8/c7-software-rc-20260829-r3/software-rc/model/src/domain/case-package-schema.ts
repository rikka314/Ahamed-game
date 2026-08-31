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

const casePackageSchema = readSchema("case-package-v1-rc1.schema.json");
const schemaDocuments: JsonSchemaDocumentRegistry = {
  "rubric-v1.schema.json": readSchema("rubric-v1.schema.json"),
  "review-record-v1.schema.json": readSchema("review-record-v1.schema.json"),
  "ai-case-cross-validation-v1.schema.json": readSchema(
    "ai-case-cross-validation-v1.schema.json",
  ),
  "provenance-record-v1.schema.json": readSchema(
    "provenance-record-v1.schema.json",
  ),
  "red-flag-exclusion-matrix-v1.schema.json": readSchema(
    "red-flag-exclusion-matrix-v1.schema.json",
  ),
};

export function assertCasePackageJsonSchema(value: unknown): void {
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
