import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  createPhase7OfflineDevelopmentReport,
  loadPhase7PublishedCases,
  runPhase7OfflineDevelopmentReport,
} from "../src/evaluation/phase7-offline-runner.js";

interface PublishedManifestEntry {
  publicCaseId: string;
  caseVersion: string;
  path: string;
  contentHash: string;
  releaseValidationMethod: "ai_cross_validation";
  validationRecordPath: string;
}

interface PublishedManifest {
  manifestVersion: string;
  casePackageSchemaVersion: string;
  evaluationVersion: string;
  rubricSchema: string;
  casePackageSchema: string;
  reviewRecordSchema: string;
  aiCrossValidationSchema: string;
  provenanceRecordSchema: string;
  redFlagExclusionMatrixSchema: string;
  regressionTrajectoriesSchema: string;
  contentHashPolicyVersion: string;
  directories: Record<string, string>;
  draftCases: unknown[];
  publishedCases: PublishedManifestEntry[];
}

function writeManifest(path: string, manifest: unknown): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function createPublishedWorkspace(): {
  directory: string;
  manifest: PublishedManifest;
  manifestPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-phase7-published-"));
  cpSync("cases/published", join(directory, "published"), {
    recursive: true,
  });
  const manifest = JSON.parse(
    readFileSync("cases/manifest.v1-rc1.json", "utf8"),
  ) as PublishedManifest;
  const manifestPath = join(directory, "manifest.json");
  writeManifest(manifestPath, manifest);
  return { directory, manifest, manifestPath };
}

test("Phase 7 offline report is provider-free and blocks until all launch cases are artifact-verified", () => {
  const report = runPhase7OfflineDevelopmentReport();

  assert.equal(report.evidenceStatus, "development_only");
  assert.equal(report.releaseValidationMethod, "ai_cross_validation");
  assert.equal(report.providerCalls, 0);
  assert.equal(report.evaluationCorpus.status, "development_corpus_ready");
  assert.equal(report.safetyCorpus.totalSamples, 165);
  assert.equal(report.safetyCorpus.runtimeContext, "fictional_case_session");
  assert.equal(report.safetyCorpus.holdoutSamples, 33);
  assert.equal(report.safetyCorpus.validatedSamples, 165);
  assert.equal(report.safetyCorpus.decisionMismatches, 0);
  assert.equal(report.safetyCorpus.templateMismatches, 0);
  assert.equal(report.safetyCorpus.urgentFalseNegatives, 0);
  assert.equal(report.safetyCorpus.selfHarmFalseNegatives, 0);
  assert.equal(report.safetyCorpus.untrustedDecisionMismatches, 0);
  assert.equal(report.fullCandidateBenchmarkGate.status, "blocked");
  assert.equal(
    report.fullCandidateBenchmarkGate.gate.code,
    "PHASE6_PUBLISHED_CASES_REQUIRED",
  );
  assert.equal(report.fullCandidateBenchmarkGate.gate.publishedCases, 5);
  assert.equal(report.fullCandidateBenchmarkGate.gate.requiredPublishedCases, 30);
  assert.equal(report.fullCandidateBenchmarkGate.gate.providerCalls, 0);

  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "askableFactIds",
    "expectedFactIds",
    "patientFacts",
    "answerKey",
    "targetDiagnosis",
    "rubric",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("Phase 7 refuses manifest claims when published packages and validation sidecars are missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-phase7-missing-artifacts-"));
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(
    readFileSync("cases/manifest.v1-rc1.json", "utf8"),
  ) as PublishedManifest;
  manifest.publishedCases = manifest.publishedCases.map((entry, index) => ({
    ...entry,
    path: `published/missing-${index + 1}.json`,
    validationRecordPath: `published/missing-${index + 1}.ai-validation.json`,
  }));
  writeManifest(manifestPath, manifest);

  try {
    assert.throws(
      () => runPhase7OfflineDevelopmentReport(pathToFileURL(manifestPath)),
      /published case artifact/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Phase 7 rejects tampered packages, mismatched sidecars, and manifest drift", () => {
  for (const scenario of ["package", "sidecar", "manifest"] as const) {
    const workspace = createPublishedWorkspace();
    const entry = workspace.manifest.publishedCases[0]!;
    try {
      if (scenario === "package") {
        const path = join(workspace.directory, entry.path);
        const packageValue = JSON.parse(readFileSync(path, "utf8")) as {
          playerVisible: { chiefComplaint: string };
        };
        packageValue.playerVisible.chiefComplaint = "篡改后的主诉";
        writeManifest(path, packageValue);
      } else if (scenario === "sidecar") {
        const path = join(workspace.directory, entry.validationRecordPath);
        const validation = JSON.parse(readFileSync(path, "utf8")) as {
          caseId: string;
        };
        validation.caseId = "different_case";
        writeManifest(path, validation);
      } else {
        entry.contentHash = `sha256:${"f".repeat(64)}`;
        writeManifest(workspace.manifestPath, workspace.manifest);
      }

      assert.throws(
        () => loadPhase7PublishedCases(pathToFileURL(workspace.manifestPath)),
        /canonical content hash|validation sidecar|manifest binding/u,
        scenario,
      );
    } finally {
      rmSync(workspace.directory, { recursive: true, force: true });
    }
  }
});

test("Phase 7 rejects malformed, duplicate, and path-escaping publication manifests", () => {
  const directory = mkdtempSync(join(tmpdir(), "ahamed-phase7-invalid-manifest-"));
  const manifestPath = join(directory, "manifest.json");
  const load = (manifest: unknown) => {
    writeManifest(manifestPath, manifest);
    return () => loadPhase7PublishedCases(pathToFileURL(manifestPath));
  };
  const validManifest = JSON.parse(
    readFileSync("cases/manifest.v1-rc1.json", "utf8"),
  ) as PublishedManifest;

  try {
    assert.throws(load({}), /manifest contract/u);
    const entry: PublishedManifestEntry = {
      publicCaseId: "published-case-1",
      caseVersion: "1.0.0",
      path: "published/case.json",
      contentHash: `sha256:${"a".repeat(64)}`,
      releaseValidationMethod: "ai_cross_validation",
      validationRecordPath: "published/case.ai-validation.json",
    };
    assert.throws(
      load({ ...validManifest, publishedCases: [entry, { ...entry }] }),
      /unique AI-cross-validated publicCaseId/u,
    );
    assert.throws(
      load({
        ...validManifest,
        publishedCases: [{ ...entry, path: "../outside.json" }],
      }),
      /manifest contract.*pattern mismatch|must stay inside cases\/published/u,
    );
    assert.throws(
      load({
        ...validManifest,
        publishedCases: [{ ...entry, contentHash: "sha256:invalid" }],
      }),
      /manifest contract.*contentHash.*pattern mismatch|AI-cross-validated.*caseVersion and sha256 contentHash bindings/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Phase 7 rejects missing, drifted, or unknown manifest contract fields", () => {
  for (const mutate of [
    (manifest: Record<string, unknown>) => {
      delete manifest["manifestVersion"];
    },
    (manifest: Record<string, unknown>) => {
      manifest["evaluationVersion"] = "scoring-policy-v999";
    },
    (manifest: Record<string, unknown>) => {
      manifest["unknownVersion"] = "future-contract";
    },
    (manifest: Record<string, unknown>) => {
      manifest["casePackageSchema"] = "schemas/future-case-package.json";
    },
    (manifest: Record<string, unknown>) => {
      (manifest["directories"] as Record<string, unknown>)["published"] =
        "other-published";
    },
    (manifest: Record<string, unknown>) => {
      const draftCases = manifest["draftCases"] as Array<Record<string, unknown>>;
      draftCases[0]!["contentHash"] = "sha256:invalid";
    },
    (manifest: Record<string, unknown>) => {
      const publishedCases = manifest["publishedCases"] as Array<Record<string, unknown>>;
      publishedCases[0]!["unknownField"] = true;
    },
    (manifest: Record<string, unknown>) => {
      const draftCases = manifest["draftCases"] as Array<Record<string, unknown>>;
      draftCases[0]!["path"] = "draft/../outside.json";
    },
    (manifest: Record<string, unknown>) => {
      const draftCases = manifest["draftCases"] as Array<Record<string, unknown>>;
      draftCases[0]!["path"] = "draft\\..\\outside.json";
    },
    (manifest: Record<string, unknown>) => {
      const publishedCases = manifest["publishedCases"] as Array<Record<string, unknown>>;
      publishedCases[0]!["path"] = "published/../outside.json";
    },
    (manifest: Record<string, unknown>) => {
      const publishedCases = manifest["publishedCases"] as Array<Record<string, unknown>>;
      publishedCases[0]!["path"] = "published\\..\\outside.json";
    },
    (manifest: Record<string, unknown>) => {
      const publishedCases = manifest["publishedCases"] as Array<Record<string, unknown>>;
      publishedCases[0]!["validationRecordPath"] =
        "published/../outside.ai-validation.json";
    },
    (manifest: Record<string, unknown>) => {
      const publishedCases = manifest["publishedCases"] as Array<Record<string, unknown>>;
      publishedCases[0]!["validationRecordPath"] =
        "published\\..\\outside.ai-validation.json";
    },
  ]) {
    const workspace = createPublishedWorkspace();
    try {
      const manifest = workspace.manifest as unknown as Record<string, unknown>;
      mutate(manifest);
      writeManifest(workspace.manifestPath, manifest);
      assert.throws(
        () => loadPhase7PublishedCases(pathToFileURL(workspace.manifestPath)),
        /manifest contract/u,
      );
    } finally {
      rmSync(workspace.directory, { recursive: true, force: true });
    }
  }
});

test("Phase 7 report creation rejects structurally forged unverified references", () => {
  assert.throws(
    () => createPhase7OfflineDevelopmentReport({ cases: [] }),
    /artifact-verified published cases/u,
  );
});

test("artifact-verified Phase 7 references cannot be mutated after verification", () => {
  const workspace = createPublishedWorkspace();
  try {
    const verified = loadPhase7PublishedCases(
      pathToFileURL(workspace.manifestPath),
    );
    const first = verified.cases[0]! as {
      packageStatus: string;
      releaseValidationMethod: string;
    };

    assert.equal(Object.isFrozen(verified), true);
    assert.equal(Object.isFrozen(verified.cases), true);
    assert.equal(Object.isFrozen(first), true);
    assert.throws(() => {
      first.packageStatus = "draft";
    }, TypeError);
    assert.throws(() => {
      first.releaseValidationMethod = "forged";
    }, TypeError);

    assert.equal(
      createPhase7OfflineDevelopmentReport(verified).fullCandidateBenchmarkGate
        .gate.code,
      "PHASE6_PUBLISHED_CASES_REQUIRED",
    );
  } finally {
    rmSync(workspace.directory, { recursive: true, force: true });
  }
});
