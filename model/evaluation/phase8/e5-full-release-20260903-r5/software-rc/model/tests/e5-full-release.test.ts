import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  E5_MINIMUM_TARGET_COUNTS,
  E5_REQUIRED_EVIDENCE_BINDING_NAMES,
  E5_REQUIRED_LOCAL_COMMAND_NAMES,
  buildE5AcceptanceReport,
  buildE5RuntimeReleaseManifest,
  verifyE5RuntimeReleaseManifest,
  type E5AcceptanceReportV1,
  type E5RuntimeReleaseManifestV1,
} from "../src/release/e5-full-release.js";
import { collectE5RuntimeArtifactPaths } from "../src/release/e5-full-release-runner.js";

const generatedAt = "2026-09-03T12:00:00.000Z";

function buildReport(overrides: {
  observedCases?: number;
  commandExitCode?: number;
  e3Status?: "passed" | "failed" | "not_run" | "stale";
  e4Status?: "passed" | "failed" | "not_run" | "stale";
  bindingStatus?: "current" | "missing" | "stale";
  staticStatus?: "passed" | "failed" | "not_run";
  sensitiveMatches?: number;
  providerStatus?: "passed" | "failed" | "not_run" | "stale";
} = {}): E5AcceptanceReportV1 {
  return buildE5AcceptanceReport({
    targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    observedCounts: {
      ...E5_MINIMUM_TARGET_COUNTS,
      cases: overrides.observedCases ?? E5_MINIMUM_TARGET_COUNTS.cases,
    },
    localCommandReports: E5_REQUIRED_LOCAL_COMMAND_NAMES.map((name) => ({
      name,
      command: `npm run ${name}`,
      exitCode: name === "model.test" ? overrides.commandExitCode ?? 0 : 0,
    })),
    provider: overrides.providerStatus ?? "passed",
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
      status: overrides.staticStatus ?? "passed",
      scannedFiles: 42,
      sensitiveMatches: overrides.sensitiveMatches ?? 0,
    },
    evidenceBindings: E5_REQUIRED_EVIDENCE_BINDING_NAMES.map((name, index) => ({
      name,
      path: `evidence/${name}.json`,
      sha256: (index + 1).toString(16).repeat(64),
      status: name === "case-ai-review-set"
        ? overrides.bindingStatus ?? "current"
        : "current",
    })),
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
      (finding) => finding.status === "failed" && finding.scope === "command:model.test",
    ),
  );
});

test("E5 cannot pass without provider, command, review, scan, and binding evidence", () => {
  const report = buildE5AcceptanceReport({
    targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    observedCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    localCommandReports: [],
    provider: "not_run",
    e3: { status: "passed", metrics: { committedTurns: 72 } },
    e4: { live: "passed", storage: "passed", aiReviews: [] },
    staticClientScan: { status: "passed", scannedFiles: 0, sensitiveMatches: 0 },
    evidenceBindings: [],
    generatedAt,
  });

  assert.equal(report.decision, "incomplete");
  assert.ok(report.findings.some(({ code }) => code === "E5_REQUIRED_LOCAL_COMMAND_MISSING"));
  assert.ok(report.findings.some(({ code }) => code === "E5_PROVIDER_NOT_RUN"));
  assert.ok(report.findings.some(({ code }) => code === "E5_E4_AI_REVIEW_COVERAGE_INCOMPLETE"));
  assert.ok(report.findings.some(({ code }) => code === "E5_STATIC_CLIENT_SCAN_EMPTY"));
  assert.ok(report.findings.some(({ code }) => code === "E5_REQUIRED_EVIDENCE_BINDING_MISSING"));
});

test("E5 preserves failed, stale, missing, and not-run quality observations", () => {
  const failed = buildReport({
    e3Status: "failed",
    e4Status: "stale",
    bindingStatus: "missing",
    staticStatus: "failed",
    sensitiveMatches: 2,
  });
  assert.equal(failed.decision, "reported_with_failures");
  assert.ok(failed.findings.some(({ code }) => code === "E5_E3_FAILED"));
  assert.ok(failed.findings.some(({ status }) => status === "stale"));
  assert.ok(failed.findings.some(({ code }) => code === "E5_EVIDENCE_BINDING_MISSING"));
  assert.ok(failed.findings.some(({ code }) => code === "E5_STATIC_CLIENT_SCAN_FAILED"));

  const notRunScan = buildReport({ staticStatus: "not_run" });
  assert.equal(notRunScan.decision, "incomplete");
  assert.ok(
    notRunScan.findings.some(({ code }) => code === "E5_STATIC_CLIENT_SCAN_NOT_RUN"),
  );
});

test("E5 acceptance construction rejects malformed technical evidence", () => {
  const validInput = {
    targetCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    observedCounts: { ...E5_MINIMUM_TARGET_COUNTS },
    localCommandReports: [{ name: "tests", command: "npm test", exitCode: 0 }],
    provider: "passed" as const,
    e3: { status: "passed" as const, metrics: { committedTurns: 72 } },
    e4: {
      live: "passed" as const,
      storage: "passed" as const,
      aiReviews: ["passed" as const, "passed" as const],
    },
    staticClientScan: {
      status: "passed" as const,
      scannedFiles: 1,
      sensitiveMatches: 0,
    },
    evidenceBindings: [{
      name: "current",
      path: "evidence/current.json",
      sha256: "d".repeat(64),
      status: "current" as const,
    }],
    generatedAt,
  };

  assert.throws(
    () => buildE5AcceptanceReport({ ...validInput, generatedAt: "not-a-date" }),
    /ISO date-time/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      targetCounts: { ...validInput.targetCounts, cases: 29 },
    }),
    /at least 30/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      observedCounts: { ...validInput.observedCounts, cases: -1 },
    }),
    /non-negative integer/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      localCommandReports: [{ name: "", command: "npm test", exitCode: 0 }],
    }),
    /command report/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      e3: { status: "passed", metrics: { committedTurns: Number.NaN } },
    }),
    /finite numeric/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      staticClientScan: { status: "passed", scannedFiles: -1, sensitiveMatches: 0 },
    }),
    /scan counts/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      evidenceBindings: [
        ...validInput.evidenceBindings,
        { ...validInput.evidenceBindings[0]! },
      ],
    }),
    /duplicated/u,
  );
  assert.throws(
    () => buildE5AcceptanceReport({
      ...validInput,
      e3: { status: "unexpected" as never, metrics: {} },
    }),
    /e3.status is invalid/u,
  );
});

test("E5 runtime manifest verifies artifacts and rejects artifact, acceptance, and self-hash drift", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-release-"));
  try {
    mkdirSync(join(root, "evidence"));
    writeFileSync(join(root, "evidence", "quality.json"), "{\"quality\":true}\n");
    for (const bindingName of E5_REQUIRED_EVIDENCE_BINDING_NAMES) {
      writeFileSync(join(root, "evidence", `${bindingName}.json`), `${bindingName}\n`);
    }
    const baseReport = buildReport();
    const report: E5AcceptanceReportV1 = {
      ...baseReport,
      evidenceBindings: baseReport.evidenceBindings.map((binding) => ({
        ...binding,
        sha256: createHash("sha256")
          .update(`${binding.name}\n`)
          .digest("hex"),
      })),
    };
    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify({ ...report, decision: "incomplete" }, null, 2)}\n`,
    );
    assert.throws(
      () => buildE5RuntimeReleaseManifest({
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
          status: "observed",
          providerName: "test-provider",
          configuredModelId: "test-model",
          actualModelId: "test-model",
          findings: [],
        },
        qualityFindings: report.findings,
        generatedAt,
      }),
      /internally inconsistent/u,
    );
    writeFileSync(
      join(root, "evidence", "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    const manifest = buildE5RuntimeReleaseManifest({
      rootDirectory: root,
      artifactPaths: [
        "evidence/quality.json",
        ...E5_REQUIRED_EVIDENCE_BINDING_NAMES.map((name) => `evidence/${name}.json`),
      ],
      acceptanceReportPath: "evidence/acceptance.json",
      sourceState: {
        headCommit: null,
        dirty: true,
        statusSha256: "b".repeat(64),
        trackedChanges: 2,
        untrackedChanges: 1,
      },
      providerObservation: {
        status: "observed",
        providerName: "test-provider",
        configuredModelId: "test-model",
        actualModelId: "test-model",
        findings: [],
      },
      qualityFindings: report.findings,
      generatedAt,
    });

    assert.equal(manifest.schemaVersion, "e5-runtime-release-manifest-v1");
    assert.equal("approvedProviders" in manifest, false);
    assert.equal(manifest.providerObservation.status, "observed");
    assert.equal(manifest.artifacts.length, 8);
    assert.equal(verifyE5RuntimeReleaseManifest(manifest, root).artifactCount, 8);
    assert.throws(
      () => buildE5RuntimeReleaseManifest({
        rootDirectory: root,
        artifactPaths: [
          "evidence/quality.json",
          ...E5_REQUIRED_EVIDENCE_BINDING_NAMES.slice(1).map(
            (name) => `evidence/${name}.json`,
          ),
        ],
        acceptanceReportPath: "evidence/acceptance.json",
        sourceState: manifest.sourceState,
        providerObservation: manifest.providerObservation,
        qualityFindings: report.findings,
        generatedAt,
      }),
      /not backed by a matching artifact/u,
    );
    assert.throws(
      () => buildE5RuntimeReleaseManifest({
        rootDirectory: root,
        artifactPaths: ["evidence/quality.json"],
        acceptanceReportPath: "evidence/acceptance.json",
        sourceState: manifest.sourceState,
        providerObservation: manifest.providerObservation,
        qualityFindings: [{
          code: "E5_FAKE_FINDING",
          status: "incomplete",
          scope: "test",
          message: "This finding is not present in the acceptance report.",
        }],
        generatedAt,
      }),
      /do not match acceptance/u,
    );

    assert.throws(
      () => buildE5RuntimeReleaseManifest({
        rootDirectory: root,
        artifactPaths: [
          "evidence/quality.json",
          ...E5_REQUIRED_EVIDENCE_BINDING_NAMES.map((name) => `evidence/${name}.json`),
        ],
        acceptanceReportPath: "evidence/acceptance.json",
        sourceState: manifest.sourceState,
        providerObservation: { status: "not_run", findings: ["not observed"] },
        qualityFindings: report.findings,
        generatedAt,
      }),
      /provider status does not match/u,
    );

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
          providerObservation: {
            status: "observed",
            providerName: "test-provider",
            configuredModelId: "test-model",
            actualModelId: "test-model",
            findings: [],
          },
          qualityFindings: [],
          generatedAt,
        }),
      /unsafe segment|must stay inside/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("E5 runtime artifact collection rejects Windows and POSIX traversal paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-e5-collection-"));
  try {
    assert.throws(
      () => collectE5RuntimeArtifactPaths(root, ["model/private/..\\..\\outside.json"]),
      /portable relative path/u,
    );
    assert.throws(
      () => collectE5RuntimeArtifactPaths(root, ["model/private/../../outside.json"]),
      /unsafe path segment/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
