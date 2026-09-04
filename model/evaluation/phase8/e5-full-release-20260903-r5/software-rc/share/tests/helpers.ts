import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonSchemaSubset } from "../testing/json-schema-subset.js";

export type PublicFixture = { schema: string; positive: unknown; negative: unknown };
export const schema = JSON.parse(readFileSync(resolve("schemas/v1-rc2/public-contracts.schema.json"), "utf8")) as JsonSchemaSubset;
export const schemaManifest = JSON.parse(readFileSync(resolve("schemas/v1-rc2/schema-manifest.json"), "utf8")) as { definitions: string[] };
export const fixtureDocument = JSON.parse(readFileSync(resolve("fixtures/v1-rc2/public-fixtures.json"), "utf8")) as { fixtures: PublicFixture[] };
