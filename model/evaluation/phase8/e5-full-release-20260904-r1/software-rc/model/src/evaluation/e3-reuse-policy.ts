import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { sha256Canonical } from "../release/phase8-release.js";

const E3_REQUIRED_TEST_PATHS = ["tests/e3-persona-benchmark.test.ts"] as const;

export interface E3ReuseSourceBinding {
  sourceFileCount: number;
  sourceTreeSha256: string;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildE3ReuseSourceBinding(modelRoot: string): E3ReuseSourceBinding {
  const sourceRoot = resolve(modelRoot, "src");
  const sourcePaths: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`E3 reuse source tree contains a symlink: ${path}`);
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) sourcePaths.push(path);
    }
  };
  walk(sourceRoot);
  for (const path of E3_REQUIRED_TEST_PATHS) {
    const absolutePath = resolve(modelRoot, ...path.split("/"));
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`E3 reuse test binding must be a regular file: ${path}`);
    }
    sourcePaths.push(absolutePath);
  }
  const bindings = sourcePaths
    .map((path) => ({
      path: relative(modelRoot, path).replaceAll("\\", "/"),
      sha256: sha256File(path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    sourceFileCount: bindings.length,
    sourceTreeSha256: sha256Canonical(bindings),
  };
}
