import {
  PHASE7_CASE_EVAL_CATEGORIES,
  PHASE7_CASE_STATUS,
  PHASE7_EVAL_CORPUS,
  PHASE7_EVIDENCE_STATUS,
  PHASE7_SAFETY_CATEGORIES,
  type Phase7CaseEvalCategory,
  type Phase7EvalCorpus,
  type Phase7SafetyCategory,
} from "./phase7-eval-corpus.js";

export interface Phase7CorpusValidationReport {
  valid: boolean;
  issues: string[];
  counts: {
    cases: number;
    caseItems: number;
    safetyItems: number;
  };
}

export interface Phase7PublishedCaseReference {
  publicCaseId: string;
  caseVersion: string;
  contentHash: string;
  packageStatus: "published";
  releaseValidationMethod: "ai_cross_validation";
}

export interface Phase7OfflineHarnessReport {
  schemaVersion: "phase7-offline-eval-summary-v1";
  evidenceStatus: "development_only";
  caseStatus: "structurally_ready_draft" | "ai_validated_published";
  mode: "offline_no_provider";
  status:
    | "development_corpus_ready"
    | "full_candidate_benchmark_ready"
    | "blocked";
  gate: {
    code:
      | "DEVELOPMENT_ONLY_CORPUS_READY"
      | "PHASE6_PUBLISHED_CASES_REQUIRED"
      | "FULL_CANDIDATE_BENCHMARK_READY"
      | "PHASE7_CORPUS_INVALID";
    publishedCases: number;
    requiredPublishedCases: number;
    releaseValidationMethod: "ai_cross_validation";
    providerCalls: 0;
    blockers: string[];
  };
  summary: {
    caseCount: number;
    caseItemCount: number;
    safetyItemCount: number;
    caseCategoryCounts: Record<Phase7CaseEvalCategory, number>;
    safetyCategoryCounts: Record<Phase7SafetyCategory, number>;
  };
}

function categoryCounts<T extends string>(categories: readonly T[]): Record<T, number> {
  return Object.fromEntries(categories.map((category) => [category, 0])) as Record<
    T,
    number
  >;
}

function validateArtifactStatus(
  artifact: { evidenceStatus: string; caseStatus: string },
  label: string,
  issues: string[],
): void {
  if (artifact.evidenceStatus !== PHASE7_EVIDENCE_STATUS) {
    issues.push(`${label} evidenceStatus must be development_only`);
  }
  if (artifact.caseStatus !== PHASE7_CASE_STATUS) {
    issues.push(`${label} caseStatus must be structurally_ready_draft`);
  }
}

export function validatePhase7EvalCorpus(
  corpus: Phase7EvalCorpus,
): Phase7CorpusValidationReport {
  const issues: string[] = [];
  validateArtifactStatus(corpus, "corpus", issues);
  if (corpus.schemaVersion !== "phase7-zh-eval-corpus-v1") {
    issues.push("corpus schemaVersion must be phase7-zh-eval-corpus-v1");
  }
  if (corpus.caseCorpora.length === 0) {
    issues.push("corpus must contain at least one case");
  }

  const allItemIds = new Set<string>();
  const knownCaseIds = new Set(corpus.caseCorpora.map(({ caseId }) => caseId));
  if (knownCaseIds.size !== corpus.caseCorpora.length) {
    issues.push("case corpus caseId values must be unique");
  }

  for (const caseCorpus of corpus.caseCorpora) {
    validateArtifactStatus(caseCorpus, `case ${caseCorpus.caseId}`, issues);
    if (caseCorpus.locale !== "zh-CN") {
      issues.push(`case ${caseCorpus.caseId} locale must be zh-CN`);
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(caseCorpus.contentHash)) {
      issues.push(`case ${caseCorpus.caseId} contentHash must be a sha256 digest`);
    }
    if (caseCorpus.items.length !== 20) {
      issues.push(
        `case ${caseCorpus.caseId} must contain exactly 20 items; found ${caseCorpus.items.length}`,
      );
    }
    const askableFactIds = new Set(caseCorpus.askableFactIds);
    if (
      caseCorpus.askableFactIds.length === 0 ||
      askableFactIds.size !== caseCorpus.askableFactIds.length
    ) {
      issues.push(`case ${caseCorpus.caseId} askableFactIds must be non-empty and unique`);
    }
    const caseItemIds = new Set(caseCorpus.items.map(({ itemId }) => itemId));
    const categories = new Set(caseCorpus.items.map(({ category }) => category));
    for (const requiredCategory of PHASE7_CASE_EVAL_CATEGORIES) {
      if (!categories.has(requiredCategory)) {
        issues.push(`case ${caseCorpus.caseId} missing category ${requiredCategory}`);
      }
    }
    for (const item of caseCorpus.items) {
      validateArtifactStatus(item, `item ${item.itemId}`, issues);
      if (allItemIds.has(item.itemId)) {
        issues.push(`duplicate itemId ${item.itemId}`);
      } else {
        allItemIds.add(item.itemId);
      }
      if (item.caseId !== caseCorpus.caseId) {
        issues.push(`item ${item.itemId} must bind to case ${caseCorpus.caseId}`);
      }
      const expectedFactIds = new Set(item.expectedFactIds);
      if (expectedFactIds.size !== item.expectedFactIds.length) {
        issues.push(`item ${item.itemId} expectedFactIds must be unique`);
      }
      for (const factId of item.expectedFactIds) {
        if (!askableFactIds.has(factId)) {
          issues.push(`item ${item.itemId} fact ${factId} is outside askableFactIds`);
        }
      }
      if (
        item.category === "standard" ||
        item.category === "synonym" ||
        item.category === "multi_question" ||
        item.category === "repeat"
      ) {
        if (item.expectedAction !== "ask_patient" || item.expectedFactIds.length === 0) {
          issues.push(
            `item ${item.itemId} must expect ask_patient with non-empty expectedFactIds`,
          );
        }
      } else if (item.expectedAction !== "other" || item.expectedFactIds.length !== 0) {
        issues.push(`item ${item.itemId} must expect other with empty expectedFactIds`);
      }
      if (item.category === "repeat") {
        const repeatedItem = caseCorpus.items.find(
          ({ itemId }) => itemId === item.repeatOfItemId,
        );
        if (
          item.repeatOfItemId === undefined ||
          !caseItemIds.has(item.repeatOfItemId) ||
          item.repeatOfItemId === item.itemId ||
          repeatedItem === undefined
        ) {
          issues.push(`repeat item ${item.itemId} must reference another item in its own case`);
        } else if (
          JSON.stringify(item.expectedFactIds) !==
          JSON.stringify(repeatedItem.expectedFactIds)
        ) {
          issues.push(`repeat item ${item.itemId} must match repeated item facts`);
        }
      }
    }
  }

  validateArtifactStatus(corpus.safetyCorpus, "safety corpus", issues);
  if (corpus.safetyCorpus.locale !== "zh-CN") {
    issues.push("safety corpus locale must be zh-CN");
  }
  if (corpus.safetyCorpus.items.length < 30) {
    issues.push(
      `safety corpus must contain at least 30 items; found ${corpus.safetyCorpus.items.length}`,
    );
  }
  const safetyCategories = new Set(
    corpus.safetyCorpus.items.map(({ category }) => category),
  );
  for (const requiredCategory of PHASE7_SAFETY_CATEGORIES) {
    if (!safetyCategories.has(requiredCategory)) {
      issues.push(`safety corpus missing category ${requiredCategory}`);
    }
  }
  for (const item of corpus.safetyCorpus.items) {
    validateArtifactStatus(item, `item ${item.itemId}`, issues);
    if (allItemIds.has(item.itemId)) {
      issues.push(`duplicate itemId ${item.itemId}`);
    } else {
      allItemIds.add(item.itemId);
    }
    if (!knownCaseIds.has(item.caseId)) {
      issues.push(`safety item ${item.itemId} must bind to a corpus case`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    counts: {
      cases: corpus.caseCorpora.length,
      caseItems: corpus.caseCorpora.reduce(
        (total, caseCorpus) => total + caseCorpus.items.length,
        0,
      ),
      safetyItems: corpus.safetyCorpus.items.length,
    },
  };
}

export function runPhase7OfflineEvalHarness(options: {
  corpus?: Phase7EvalCorpus;
  requireFullCandidateBenchmark?: boolean;
  publishedCases?: readonly Phase7PublishedCaseReference[];
} = {}): Phase7OfflineHarnessReport {
  const corpus = options.corpus ?? PHASE7_EVAL_CORPUS;
  const validation = validatePhase7EvalCorpus(corpus);
  const suppliedPublishedCases = options.publishedCases ?? [];
  const suppliedPublishedCasesById = new Map(
    suppliedPublishedCases.map((publishedCase) => [
      publishedCase.publicCaseId,
      publishedCase,
    ]),
  );
  const requiredPublishedCases = new Map(
    corpus.caseCorpora.map((caseCorpus) => [caseCorpus.caseId, caseCorpus]),
  );
  const matchingPublishedCases = [...requiredPublishedCases].filter(
    ([caseId, requiredCase]) => {
      const suppliedCase = suppliedPublishedCasesById.get(caseId);
      return (
        suppliedCase?.packageStatus === "published" &&
        suppliedCase.releaseValidationMethod === "ai_cross_validation" &&
        suppliedCase.caseVersion === requiredCase.caseVersion &&
        suppliedCase.contentHash === requiredCase.contentHash
      );
    },
  );
  const publishedCaseSetMatches =
    suppliedPublishedCases.length === requiredPublishedCases.size &&
    suppliedPublishedCasesById.size === requiredPublishedCases.size &&
    matchingPublishedCases.length === requiredPublishedCases.size;
  const publishedCases = matchingPublishedCases.length;
  const caseCategoryCounts = categoryCounts(PHASE7_CASE_EVAL_CATEGORIES);
  const safetyCategoryCounts = categoryCounts(PHASE7_SAFETY_CATEGORIES);
  for (const { category } of corpus.caseCorpora.flatMap(({ items }) => items)) {
    caseCategoryCounts[category] += 1;
  }
  for (const { category } of corpus.safetyCorpus.items) {
    safetyCategoryCounts[category] += 1;
  }

  const fullCandidateBenchmarkRequired =
    options.requireFullCandidateBenchmark === true;
  const publicationBlocked =
    fullCandidateBenchmarkRequired && !publishedCaseSetMatches;
  const blockers = !validation.valid
    ? [
        `Phase 7 corpus failed structural validation (${validation.issues.length} issues); inspect local validation details.`,
      ]
    : publicationBlocked
      ? [
          `完整候选 benchmark 必须精确绑定评估语料的 ${requiredPublishedCases.size} 个已发布病例；当前匹配 ${publishedCases} 个。`,
        ]
      : [];
  const status = blockers.length > 0
    ? "blocked"
    : fullCandidateBenchmarkRequired
      ? "full_candidate_benchmark_ready"
      : "development_corpus_ready";
  const code = !validation.valid
    ? "PHASE7_CORPUS_INVALID"
    : publicationBlocked
      ? "PHASE6_PUBLISHED_CASES_REQUIRED"
      : fullCandidateBenchmarkRequired
        ? "FULL_CANDIDATE_BENCHMARK_READY"
      : "DEVELOPMENT_ONLY_CORPUS_READY";

  return {
    schemaVersion: "phase7-offline-eval-summary-v1",
    evidenceStatus: PHASE7_EVIDENCE_STATUS,
    caseStatus: fullCandidateBenchmarkRequired && publishedCaseSetMatches
      ? "ai_validated_published"
      : PHASE7_CASE_STATUS,
    mode: "offline_no_provider",
    status,
    gate: {
      code,
      publishedCases,
      requiredPublishedCases: requiredPublishedCases.size,
      releaseValidationMethod: "ai_cross_validation",
      providerCalls: 0,
      blockers,
    },
    summary: {
      caseCount: validation.counts.cases,
      caseItemCount: validation.counts.caseItems,
      safetyItemCount: validation.counts.safetyItems,
      caseCategoryCounts,
      safetyCategoryCounts,
    },
  };
}
