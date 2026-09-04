import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPhase8CaseValidation,
  buildRuntimeReleaseManifest,
  verifyRuntimeReleaseManifest,
  type Phase8CaseValidationV2,
} from "../src/release/phase8-release.js";

function approvedValidation(): Phase8CaseValidationV2 {
  return {
    schemaVersion: "ai-case-cross-validation-v2",
    caseId: "internal_case_001",
    caseVersion: "1.0.0",
    contentHash: `sha256:${"a".repeat(64)}`,
    decision: "approved",
    validations: [
      {
        validatorId: "validator.clinical-safety.v2",
        role: "clinical_safety",
        modelId: "gpt-test-snapshot",
        promptVersion: "clinical-safety-case-validation-v2",
        validationRunId: "run.clinical.case-001.001",
        isolation: {
          independentInvocation: true,
          counterpartOutputVisible: false,
        },
        decision: "approved",
        validatedAt: "2026-08-28T10:00:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: ["临床安全检查通过。"],
      },
      {
        validatorId: "validator.diagnostic-quality.v2",
        role: "diagnostic_quality",
        modelId: "gpt-test-snapshot",
        promptVersion: "diagnostic-quality-case-validation-v2",
        validationRunId: "run.diagnostic.case-001.001",
        isolation: {
          independentInvocation: true,
          counterpartOutputVisible: false,
        },
        decision: "approved",
        validatedAt: "2026-08-28T10:01:00.000Z",
        checks: {
          clinicalConsistency: "pass",
          diagnosisSolvability: "pass",
          redFlagExclusions: "pass",
          rubricConsistency: "pass",
          regressionCoverage: "pass",
          hiddenTruthSafety: "pass",
        },
        findings: ["诊断质量检查通过。"],
      },
    ],
  };
}

test("Phase 8 requires role-specific prompts, distinct runs, and blind independent case validation", () => {
  const validation = approvedValidation();
  assert.doesNotThrow(() =>
    assertPhase8CaseValidation(validation, {
      caseId: validation.caseId,
      caseVersion: validation.caseVersion,
      contentHash: validation.contentHash,
    }),
  );

  for (const mutate of [
    (candidate: Phase8CaseValidationV2) => {
      candidate.validations[1]!.promptVersion =
        candidate.validations[0]!.promptVersion;
    },
    (candidate: Phase8CaseValidationV2) => {
      candidate.validations[1]!.validationRunId =
        candidate.validations[0]!.validationRunId;
    },
    (candidate: Phase8CaseValidationV2) => {
      candidate.validations[0]!.isolation.counterpartOutputVisible = true;
    },
    (candidate: Phase8CaseValidationV2) => {
      candidate.validations[1]!.checks.hiddenTruthSafety = "fail";
    },
  ]) {
    const candidate = structuredClone(validation);
    mutate(candidate);
    assert.throws(
      () =>
        assertPhase8CaseValidation(candidate, {
          caseId: candidate.caseId,
          caseVersion: candidate.caseVersion,
          contentHash: candidate.contentHash,
        }),
      /Phase 8 case validation/u,
    );
  }
});

test("runtime release manifest verifies every bound artifact and fails closed on drift", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-phase8-release-"));
  try {
    mkdirSync(join(root, "artifacts"));
    writeFileSync(join(root, "artifacts", "case.json"), "{\"case\":1}\n");
    writeFileSync(
      join(root, "artifacts", "validation.json"),
      `${JSON.stringify(approvedValidation())}\n`,
    );
    writeFileSync(join(root, "artifacts", "candidate.json"), "{\"runs\":15}\n");
    writeFileSync(join(root, "artifacts", "safety.json"), "{\"samples\":165}\n");
    writeFileSync(join(root, "artifacts", "prompt.md"), "prompt-v1\n");
    writeFileSync(join(root, "artifacts", "contract.json"), "{\"release\":\"v1-rc1\"}\n");
    writeFileSync(join(root, "artifacts", "migration.ts"), "export const version = 5;\n");

    const manifest = buildRuntimeReleaseManifest({
      rootDirectory: root,
      buildVersion: "0.1.0-rc.1",
      goNoGoDecisionRef: "decision.phase8.openai-compatible.gpt-test",
      provider: {
        providerName: "openai-compatible.test",
        protocol: "openai-responses",
        endpointSha256: "b".repeat(64),
        configuredModelId: "gpt-test",
        actualModelId: "gpt-test-snapshot",
        approvedAt: "2026-08-28T11:00:00.000Z",
      },
      remoteInteractiveEnabled: false,
      shareDecision: {
        release: "v1-rc1",
        status: "retained_release_candidate",
        reason: "游戏侧 adapter 尚未实现，因此 Phase 8-A 明确保留 RC。",
      },
      artifactPaths: [
        "artifacts/case.json",
        "artifacts/validation.json",
        "artifacts/candidate.json",
        "artifacts/safety.json",
        "artifacts/prompt.md",
        "artifacts/contract.json",
        "artifacts/migration.ts",
      ],
    });

    const verified = verifyRuntimeReleaseManifest(manifest, root);
    assert.equal(verified.artifactCount, 7);
    assert.equal(verified.providerCount, 1);
    assert.equal(verified.remoteInteractiveEnabled, false);

    writeFileSync(join(root, "artifacts", "case.json"), "{\"case\":2}\n");
    assert.throws(
      () => verifyRuntimeReleaseManifest(manifest, root),
      /artifact hash mismatch/u,
    );

    const serialized = JSON.stringify(manifest);
    assert.doesNotMatch(serialized, /MODEL_API_KEY|api[_-]?key|baseURL/iu);
    assert.equal(
      readFileSync(join(root, "artifacts", "validation.json"), "utf8").length > 0,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime release manifest records a fully unavailable Provider without inventing an actual model id", () => {
  const root = mkdtempSync(join(tmpdir(), "ahamed-phase8-provider-outage-"));
  try {
    writeFileSync(join(root, "artifact.json"), "{\"status\":\"failed_to_run\"}\n");
    const provider = {
      providerName: "openai-compatible.test",
      protocol: "openai-responses" as const,
      endpointSha256: "c".repeat(64),
      configuredModelId: "gpt-test",
      observationStatus: "not_observed" as const,
      approvedAt: "2026-09-04T11:00:00.000Z",
    };
    const manifest = buildRuntimeReleaseManifest({
      rootDirectory: root,
      buildVersion: "0.1.0-rc.1",
      goNoGoDecisionRef: "decision.phase8.provider-unavailable",
      provider,
      remoteInteractiveEnabled: false,
      shareDecision: {
        release: "v1-rc1",
        status: "retained_release_candidate",
        reason: "Provider 不可用时保留可审计失败证据。",
      },
      artifactPaths: ["artifact.json"],
    });

    assert.equal(manifest.approvedProviders[0]?.actualModelId, undefined);
    assert.equal(manifest.approvedProviders[0]?.observationStatus, "not_observed");
    assert.equal(verifyRuntimeReleaseManifest(manifest, root).providerCount, 1);

    assert.throws(
      () => buildRuntimeReleaseManifest({
        rootDirectory: root,
        buildVersion: "0.1.0-rc.1",
        goNoGoDecisionRef: "decision.phase8.provider-unavailable",
        provider: {
          providerName: provider.providerName,
          protocol: provider.protocol,
          endpointSha256: provider.endpointSha256,
          configuredModelId: provider.configuredModelId,
          approvedAt: provider.approvedAt,
        },
        remoteInteractiveEnabled: false,
        shareDecision: {
          release: "v1-rc1",
          status: "retained_release_candidate",
          reason: "缺少 observationStatus 时必须失败关闭。",
        },
        artifactPaths: ["artifact.json"],
      }),
      /Provider\/model identity is invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
