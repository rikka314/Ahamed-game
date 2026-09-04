import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  E5_MINIMUM_TARGET_COUNTS,
  buildE5AcceptanceReport,
  buildE5RuntimeReleaseManifest,
  verifyE5RuntimeReleaseManifest,
  type E5AcceptanceReportV1,
  type E5RuntimeReleaseManifestV1,
} from "../src/release/e5-full-release.js";

const generatedAt = "2026-09-03T12:00:00.000Z";

function buildReport(overrides: {
  observedCases?: number;
  commandExitCode?: number;
  e3Status?: "passed" | "failed" | "not_run" | "stale";
  e4Status?: "passed" | "failed" | "not_run" | "stale";
  bindingStatus?: "current" | "missing" | "stale";
} = {}): E5AcceptanceReportV1 {
  return buildE5AcceptanceReport({
    targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    observedCounts: {
      ...E5_MINIMUM_TARGET_COUNTS,
      cases: overrides.observedCases ?? E5_MINIMUM_TARGET_COUNTS.cases,
    },
    localCommandReports: [
      {
        name: "model tests",
        command: "npm test",
        exitCode: overrides.commandExitCode ?? 0,
      },
    ],
    e3: {
      status: overrides.e3Status ?? "passed",
      metrics: { personaConsistencyRate: 0.98, committedTurns: 72 },
    },
    e4: {
      live: overrides.e4Status ?? "passed",
      storage: overrides.e4Status ?? "passed",
      aiReviews: [overrides.e4Status ?? "passed", overrides.e4Status ?? "passed"],
    },
    staticClientScan: {
      status: "passed",
      scannedFiles: 42,
      sensitiveMatches: 0,
    },
    evidenceBindings: [
      {
        name: "case-cross-reviews",
        path: "evidence/case-cross-reviews.json",
        sha256: "a".repeat(64),
        status: overrides.bindingStatus ?? "current",
      },
    ],
    generatedAt,
  });
}

test("E5 reports 5/30 coverage plus stale and not-run observations as incomplete", () => {
  const report = buildReport({
    observedCases: 5,
    e3Status: "not_run",
    e4Status: "not_run",
    bindingStatus: "stale",
  });

  assert.equal(report.schemaVersion, "e5-full-acceptance-report-v1");
  assert.equal(report.reviewPolicy, "non_blocking");
  assert.equal(report.decision, "incomplete");
  assert.equal(report.observedCounts.cases, 5);
  assert.ok(report.findings.some((finding) => finding.status === "incomplete"));
  assert.ok(report.findings.some((finding) => finding.status === "stale"));
  assert.ok(report.findings.some((finding) => finding.status === "not_run"));
});

test("E5 reports passed only when targets, commands, observations, scan, and bindings pass", () => {
  const report = buildReport();
  assert.equal(report.decision, "passed");
  assert.deepEqual(report.findings, []);
});

test("E5 reports a nonzero local command as reported_with_failures", () => {
  const report = buildReport({ commandExitCode: 1 });
  assert.equal(report.decision, "reported_with_failures");
  assert.ok(
    report.findings.some(
      (finding) => finding.status === "failed" && finding.scope === "command:model tests",
    ),
  );
});

test("E5 runtime manifest verifies artifacts and rejects artifact, acceptance, and self-hash drift", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-release-"));
  try {
    mkdirSync(join(root, "evidence"));
    const report = buildReport();
    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(join(root, "evidence", "quality.json"), "{\"quality\":true}\n");

    const manifest = buildE5RuntimeReleaseManifest({
      rootDirectory: root,
      artifactPaths: ["evidence/quality.json"],
      acceptanceReportPath: "evidence/acceptance.json",
      sourceState: {
        headCommit: null,
        dirty: true,
        statusSha256: "b".repeat(64),
        trackedChanges: 2,
        untrackedChanges: 1,
      },
      providerObservation: {
        status: "not_run",
        findings: ["Provider observation was not run for this local evidence build."],
      },
      qualityFindings: report.findings,
      generatedAt,
    });

    assert.equal(manifest.schemaVersion, "e5-runtime-release-manifest-v1");
    assert.equal("approvedProviders" in manifest, false);
    assert.equal(manifest.providerObservation.status, "not_run");
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(verifyE5RuntimeReleaseManifest(manifest, root).artifactCount, 2);

    writeFileSync(join(root, "evidence", "quality.json"), "{\"quality\":false}\n");
    assert.throws(
      () => verifyE5RuntimeReleaseManifest(manifest, root),
      /artifact hash mismatch/u,
    );

    writeFileSync(join(root, "evidence", "quality.json"), "{\"quality\":true}\n");
    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify({ ...report, decision: "incomplete" }, null, 2)}\n`,
    );
    assert.throws(
      () => verifyE5RuntimeReleaseManifest(manifest, root),
      /acceptance report binding mismatch/u,
    );

    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const selfHashDrift: E5RuntimeReleaseManifestV1 = {
      ...manifest,
      generatedAt: "2026-09-03T12:01:00.000Z",
    };
    assert.throws(
      () => verifyE5RuntimeReleaseManifest(selfHashDrift, root),
      /self hash mismatch/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("E5 runtime manifest rejects unsafe artifact paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-path-"));
  try {
    writeFileSync(join(root, "acceptance.json"), `${JSON.stringify(buildReport())}\n`);
    assert.throws(
      () =>
        buildE5RuntimeReleaseManifest({
          rootDirectory: root,
          artifactPaths: ["../outside.json"],
          acceptanceReportPath: "acceptance.json",
          sourceState: {
            headCommit: null,
            dirty: false,
            statusSha256: "c".repeat(64),
            trackedChanges: 0,
            untrackedChanges: 0,
          },
          providerObservation: { status: "not_run", findings: [] },
          qualityFindings: [],
          generatedAt,
        }),
      /must stay inside/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
