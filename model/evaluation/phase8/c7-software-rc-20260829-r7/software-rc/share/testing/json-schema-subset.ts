export type JsonSchemaSubset = {
  $id?: string;
  $ref?: string;
  allOf?: JsonSchemaSubset[];
  anyOf?: JsonSchemaSubset[];
  oneOf?: JsonSchemaSubset[];
  if?: JsonSchemaSubset;
  then?: JsonSchemaSubset;
  else?: JsonSchemaSubset;
  const?: unknown;
  enum?: unknown[];
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  required?: string[];
  properties?: Record<string, JsonSchemaSubset>;
  additionalProperties?: boolean | JsonSchemaSubset;
  minProperties?: number;
  maxProperties?: number;
  items?: JsonSchemaSubset;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: "date-time";
  $defs?: Record<string, JsonSchemaSubset>;
};

export type ValidationResult = { valid: boolean; errors: string[] };
export type JsonSchemaDocumentRegistry = Readonly<Record<string, JsonSchemaSubset>>;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolvePointer(root: JsonSchemaSubset, pointer: string): JsonSchemaSubset | undefined {
  if (pointer === "" || pointer === "#") return root;
  if (!pointer.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const token of pointer.slice(2).split("/")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[token.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return current as JsonSchemaSubset | undefined;
}

function resolveReference(
  root: JsonSchemaSubset,
  reference: string,
  documents: JsonSchemaDocumentRegistry,
): { schema: JsonSchemaSubset; root: JsonSchemaSubset } | undefined {
  if (reference.startsWith("#")) {
    const schema = resolvePointer(root, reference);
    return schema === undefined ? undefined : { schema, root };
  }

  const [documentName, fragment = ""] = reference.split("#", 2);
  if (documentName === undefined || documentName.length === 0) return undefined;
  const externalRoot = documents[documentName];
  if (externalRoot === undefined) return undefined;
  const schema = resolvePointer(externalRoot, fragment === "" ? "#" : `#${fragment}`);
  return schema === undefined ? undefined : { schema, root: externalRoot };
}

function matchesType(value: unknown, type: NonNullable<JsonSchemaSubset["type"]>): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function visit(
  schema: JsonSchemaSubset,
  value: unknown,
  root: JsonSchemaSubset,
  documents: JsonSchemaDocumentRegistry,
  path: string,
  errors: string[],
): void {
  if (schema.$ref !== undefined) {
    const referenced = resolveReference(root, schema.$ref, documents);
    if (referenced === undefined) errors.push(`${path}: unresolved reference ${schema.$ref}`);
    else visit(referenced.schema, value, referenced.root, documents, path, errors);
    return;
  }
  if (schema.allOf !== undefined) schema.allOf.forEach((candidate) => visit(candidate, value, root, documents, path, errors));
  if (schema.anyOf !== undefined && !schema.anyOf.some((candidate) => validateAgainst(candidate, value, root, documents).valid)) errors.push(`${path}: no anyOf branch matched`);
  if (schema.oneOf !== undefined && schema.oneOf.filter((candidate) => validateAgainst(candidate, value, root, documents).valid).length !== 1) errors.push(`${path}: expected exactly one oneOf match`);
  if (schema.if !== undefined) {
    const conditionMatches = validateAgainst(schema.if, value, root, documents).valid;
    if (conditionMatches && schema.then !== undefined) visit(schema.then, value, root, documents, path, errors);
    if (!conditionMatches && schema.else !== undefined) visit(schema.else, value, root, documents, path, errors);
  }
  if ("const" in schema && !sameValue(value, schema.const)) errors.push(`${path}: value does not match const`);
  if (schema.enum !== undefined && !schema.enum.some((candidate) => sameValue(candidate, value))) errors.push(`${path}: value is not in enum`);
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}`);
    return;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: pattern mismatch`);
    if (schema.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) errors.push(`${path}: invalid date-time`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than maxItems`);
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path}: items are not unique`);
    if (schema.items !== undefined) value.forEach((item, index) => visit(schema.items!, item, root, documents, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const propertyCount = Object.keys(record).length;
    if (schema.minProperties !== undefined && propertyCount < schema.minProperties) errors.push(`${path}: fewer than minProperties`);
    if (schema.maxProperties !== undefined && propertyCount > schema.maxProperties) errors.push(`${path}: more than maxProperties`);
    schema.required?.forEach((key) => {
      if (!(key in record)) errors.push(`${path}.${key}: required property missing`);
    });
    for (const [key, child] of Object.entries(record)) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema !== undefined) visit(propertySchema, child, root, documents, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional property not allowed`);
      else if (typeof schema.additionalProperties === "object") visit(schema.additionalProperties, child, root, documents, `${path}.${key}`, errors);
    }
  }
}

function validateAgainst(
  schema: JsonSchemaSubset,
  value: unknown,
  root: JsonSchemaSubset,
  documents: JsonSchemaDocumentRegistry,
): ValidationResult {
  const errors: string[] = [];
  visit(schema, value, root, documents, "$", errors);
  return { valid: errors.length === 0, errors };
}

export function validateJsonSchemaDocument(
  root: JsonSchemaSubset,
  value: unknown,
  documents: JsonSchemaDocumentRegistry = {},
): ValidationResult {
  return validateAgainst(root, value, root, documents);
}

export function validateJsonSchemaSubset(
  root: JsonSchemaSubset,
  definitionName: string,
  value: unknown,
  documents: JsonSchemaDocumentRegistry = {},
): ValidationResult {
  const definition = root.$defs?.[definitionName];
  if (definition === undefined) return { valid: false, errors: [`Unknown schema definition: ${definitionName}`] };
  return validateAgainst(definition, value, root, documents);
}
