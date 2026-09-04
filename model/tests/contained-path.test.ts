import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  resolveContainedPathForCreate,
  resolveContainedRegularFile,
} from "../src/security/contained-path.js";

describe("contained evidence paths", () => {
  it("accepts regular in-root files and rejects lexical traversal", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "ahamed-contained-path-"));
    try {
      const root = join(sandbox, "root");
      mkdirSync(root);
      const artifact = join(root, "artifact.json");
      writeFileSync(artifact, "{}\n", "utf8");
      assert.equal(
        resolveContainedRegularFile(root, "artifact.json", "artifact"),
        realpathSync(artifact),
      );
      assert.throws(
        () => resolveContainedPathForCreate(root, "../escape.json", "output"),
        /unsafe path segment/u,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects an output parent junction whose realpath leaves the root", (context) => {
    const sandbox = mkdtempSync(join(tmpdir(), "ahamed-contained-junction-"));
    try {
      const root = join(sandbox, "root");
      const outside = join(sandbox, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      try {
        symlinkSync(outside, join(root, "redirect"), "junction");
      } catch (error) {
        const code = error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
        if (["EPERM", "EACCES", "ENOTSUP"].includes(code)) {
          context.skip(`junction creation unavailable: ${code}`);
          return;
        }
        throw error;
      }
      assert.throws(
        () => resolveContainedPathForCreate(root, "redirect/evidence.json", "output"),
        /realpath escapes/u,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
