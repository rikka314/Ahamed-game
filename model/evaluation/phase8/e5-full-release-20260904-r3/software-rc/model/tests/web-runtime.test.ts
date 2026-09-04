import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  createWebModelRuntime,
  loadWebPublicCases,
  WEB_CASE_MANIFEST,
} from "../src/web-runtime.js";

test("web case catalogue follows the pinned launch manifest and exposes only public fields", () => {
  const modelRoot = resolve(process.cwd());
  assert.equal(WEB_CASE_MANIFEST, "manifest.launch-release-20260904-r9.json");
  const cases = loadWebPublicCases(modelRoot);
  const manifestBytes = readFileSync(
    resolve(modelRoot, "cases", WEB_CASE_MANIFEST),
  );
  assert.equal(
    createHash("sha256").update(manifestBytes).digest("hex"),
    "cc30922dd330d1fbb3535725703d18d487abd6908b9522c8a524b962a01897b2",
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    cases: Array<{
      publicCaseId: string;
      caseVersion: string;
      packageStatus: string;
      reviewStatus: string;
    }>;
  };

  const approvedManifestCases = manifest.cases.filter((item) =>
    item.packageStatus === "published" && item.reviewStatus === "approved"
  );

  assert.equal(cases.length, 30);
  assert.equal(new Set(cases.map(({ publicCaseId }) => publicCaseId)).size, 30);
  assert.deepEqual(
    cases.map(({ publicCaseId, caseVersion }) => ({ publicCaseId, caseVersion })),
    approvedManifestCases.map(({ publicCaseId, caseVersion }) => ({
      publicCaseId,
      caseVersion,
    })),
  );
  for (const item of cases) {
    assert.deepEqual(Object.keys(item).sort(), [
      "ageBand",
      "caseVersion",
      "chiefComplaint",
      "displayName",
      "genderDisplay",
      "patientRoleId",
      "publicCaseId",
    ]);
    assert.match(item.publicCaseId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    assert.match(item.patientRoleId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    assert.ok(item.displayName.length > 0);
    assert.ok(item.chiefComplaint.length > 0);
  }
});

test("web runtime requires an absolute database path in production", () => {
  const productionOptions = {
    modelRoot: resolve(process.cwd()),
    environment: {
      NODE_ENV: "production",
      AHAMED_MODEL_ID: "test-model",
    },
    loadEnvironmentFile: false,
  } as const;
  for (const databasePath of [undefined, "relative/model-web.sqlite"]) {
    assert.throws(
      () => createWebModelRuntime({
        ...productionOptions,
        ...(databasePath === undefined ? {} : { databasePath }),
      }),
      /必须配置绝对路径 AHAMED_WEB_MODEL_DATABASE_PATH/u,
    );
  }
  assert.throws(
    () => createWebModelRuntime({
      ...productionOptions,
      environment: {
        ...productionOptions.environment,
        AHAMED_WEB_MODEL_DATABASE_PATH: "relative/from-environment.sqlite",
      },
    }),
    /必须配置绝对路径 AHAMED_WEB_MODEL_DATABASE_PATH/u,
  );
});
