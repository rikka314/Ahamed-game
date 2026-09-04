import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanE5StaticClientArtifacts } from "../src/release/e5-static-client-security.js";

test("E5 static scan includes prerendered RSC output", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-client-scan-"));
  try {
    const prerenderRoot = join(root, ".next", "server", "app");
    mkdirSync(prerenderRoot, { recursive: true });
    writeFileSync(
      join(prerenderRoot, "index.rsc"),
      '{"behaviorInstructions":{"tone":"hidden"}}\n',
    );

    const result = scanE5StaticClientArtifacts(root);

    assert.equal(result.status, "failed");
    assert.equal(result.scannedFiles, 1);
    assert.ok(
      result.matches.some(
        ({ path, token }) => path === ".next/server/app/index.rsc" && token === "behaviorInstructions",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("E5 static scan accepts clean static, prerendered, and public artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-client-clean-"));
  try {
    const staticRoot = join(root, ".next", "static", "chunks");
    const prerenderRoot = join(root, ".next", "server", "app");
    const publicRoot = join(root, "public");
    mkdirSync(staticRoot, { recursive: true });
    mkdirSync(prerenderRoot, { recursive: true });
    mkdirSync(publicRoot, { recursive: true });
    writeFileSync(join(staticRoot, "app.js"), "console.log('ready');\n");
    writeFileSync(join(prerenderRoot, "index.html"), "<main>Clinic ready</main>\n");
    writeFileSync(join(prerenderRoot, "index.rsc"), "public patient view\n");
    writeFileSync(join(publicRoot, "metadata.json"), '{"status":"ready"}\n');

    const result = scanE5StaticClientArtifacts(root);

    assert.equal(result.status, "passed");
    assert.equal(result.scannedFiles, 4);
    assert.equal(result.sensitiveMatches, 0);
    assert.deepEqual(result.matches, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
