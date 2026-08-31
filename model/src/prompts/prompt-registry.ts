import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptRole = "controller" | "patient" | "review";

export interface PromptTemplate {
  role: PromptRole;
  version: string;
  content: string;
  sha256: string;
}

export interface PromptRegistry {
  load(role: PromptRole, version: string): PromptTemplate;
}

export class PromptRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptRegistryError";
  }
}

const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;
const ROLE_DIRECTORIES: Record<PromptRole, string> = {
  controller: "controller",
  patient: "patient",
  review: "evaluator",
};

export class FilePromptRegistry implements PromptRegistry {
  private readonly cache = new Map<string, PromptTemplate>();

  constructor(private readonly rootDirectory: string) {}

  load(role: PromptRole, version: string): PromptTemplate {
    if (!VERSION_PATTERN.test(version)) {
      throw new PromptRegistryError(`Invalid prompt version: ${version}`);
    }
    const cacheKey = `${role}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return structuredClone(cached);

    const path = join(
      this.rootDirectory,
      ROLE_DIRECTORIES[role],
      `${version}.md`,
    );
    let content: string;
    try {
      content = readFileSync(path, "utf8").trim();
    } catch {
      throw new PromptRegistryError(
        `Prompt template is unavailable for ${role} ${version}.`,
      );
    }
    if (content.length === 0) {
      throw new PromptRegistryError(
        `Prompt template is empty for ${role} ${version}.`,
      );
    }
    const template: PromptTemplate = Object.freeze({
      role,
      version,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    this.cache.set(cacheKey, template);
    return structuredClone(template);
  }
}
